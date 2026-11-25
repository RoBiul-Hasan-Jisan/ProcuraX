import { RFQ } from '../models/RFQ';
import { SupplierQuotation } from '../models/SupplierQuotation';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { Supplier } from '../models/Supplier';
import { Material } from '../models/Material';
import { nextNumber } from '../models/Counter';
import { ApprovalHistory } from '../models/ApprovalHistory';
import { str } from '../domain/money';
import { badRequest, conflict, forbidden, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';
import { notify } from './notifier';
import { audit } from './auditService';

export interface RfqInput {
  requisitionId: string;
  deliveryLocation: string;
  deadline: Date;
  paymentTerms: string;
  deliveryRequirements: string;
  invitedSupplierIds: string[];
}

const isSupplierUser = (u: UserContext) => u.role === 'supplier';

/** Manager view: full RFQ incl. invitees. Supplier view: only what a bidder needs, never competitors. */
function present(r: any, view: 'manager' | 'supplier', extra: Record<string, unknown> = {}) {
  const base = {
    id: String(r._id), number: r.number, status: r.status, deadline: r.deadline, requiredDate: r.requiredDate,
    deliveryLocation: r.deliveryLocation, paymentTerms: r.paymentTerms, deliveryRequirements: r.deliveryRequirements,
    items: r.items.map((i: any) => ({
      materialId: String(i.material), materialName: i.materialName, sku: i.sku, quantity: str(i.quantity, 3), unit: i.unit, technicalSpecs: i.technicalSpecs,
    })),
    createdAt: r.createdAt,
  };
  if (view === 'supplier') return { ...base, ...extra };
  return {
    ...base, requisitionId: String(r.requisition?._id ?? r.requisition), requisitionNumber: r.requisition?.number ?? null,
    invitedSuppliers: (r.invitedSuppliers ?? []).map((s: any) => (s?._id ? { id: String(s._id), name: s.companyName } : { id: String(s) })),
    award: r.award?.quotation ? {
      quotationId: String(r.award.quotation), supplierId: String(r.award.supplier), awardedByName: r.award.awardedByName,
      awardedAt: r.award.awardedAt, justification: r.award.justification ?? null, overrodeTopRank: !!r.award.overrodeTopRank,
    } : null,
    ...extra,
  };
}

export async function createRfq(user: UserContext, input: RfqInput) {
  if (input.deadline.getTime() <= Date.now()) throw badRequest('The submission deadline must be in the future');
  const ids = [...new Set(input.invitedSupplierIds)];
  const suppliers = await Supplier.find({ _id: { $in: ids } }).lean();
  if (suppliers.length !== ids.length) throw badRequest('One or more invited suppliers do not exist');
  const ineligible = suppliers.filter((s) => s.status !== 'active' || s.verificationStatus !== 'verified');
  if (ineligible.length) throw badRequest(`Only active, verified suppliers can be invited (not eligible: ${ineligible.map((s) => s.companyName).join(', ')})`);

  const requisition = await PurchaseRequisition.findById(input.requisitionId).lean();
  if (!requisition) throw notFound('Requisition not found');
  if (requisition.status !== 'Approved') throw conflict(`An RFQ can only be created from an Approved requisition (current status: ${requisition.status})`);

  const materials = await Material.find({ _id: { $in: requisition.items.map((i: any) => i.material) } }).lean();
  const specs = new Map(materials.map((m) => [String(m._id), m.technicalSpecs ?? '']));

  // Atomic gate: only one caller can move Approved -> RFQ Created.
  const gate = await PurchaseRequisition.findOneAndUpdate({ _id: input.requisitionId, status: 'Approved' }, { $set: { status: 'RFQ Created' } });
  if (!gate) throw conflict('An RFQ was already created for this requisition');
  try {
    const rfq = await RFQ.create({
      number: await nextNumber('RFQ'), requisition: requisition._id,
      items: requisition.items.map((i: any) => ({
        material: i.material, materialName: i.materialName, sku: i.sku, quantity: i.quantity, unit: i.unit, technicalSpecs: specs.get(String(i.material)) ?? '',
      })),
      deliveryLocation: input.deliveryLocation, deadline: input.deadline, paymentTerms: input.paymentTerms,
      deliveryRequirements: input.deliveryRequirements, requiredDate: requisition.requiredDate,
      invitedSuppliers: ids, createdBy: user.id, status: 'open',
    });
    await PurchaseRequisition.updateOne({ _id: requisition._id }, { $set: { rfq: rfq._id } });
    await notify.rfqPublished(rfq, ids);
    await audit(user, { action: 'rfq.created', entityType: 'RFQ', entityId: String(rfq._id), entityNumber: rfq.number, summary: `Created RFQ and invited ${ids.length} supplier(s)`, after: { requisition: String(requisition._id), invitedSuppliers: ids.map(String), deadline: input.deadline } });
    return getRfq(user, String(rfq._id));
  } catch (e) {
    await PurchaseRequisition.updateOne({ _id: input.requisitionId, status: 'RFQ Created' }, { $set: { status: 'Approved' } });
    throw e;
  }
}

export async function listRfqs(user: UserContext, q: { page: number; limit: number; status?: string }) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (isSupplierUser(user)) {
    if (!user.supplierId) return { items: [], total: 0 };
    filter.invitedSuppliers = user.supplierId; // a supplier only ever lists RFQs addressed to them
  }
  const [rows, total] = await Promise.all([
    RFQ.find(filter).populate('requisition', 'number').populate('invitedSuppliers', 'companyName')
      .sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    RFQ.countDocuments(filter),
  ]);
  if (isSupplierUser(user)) {
    const mine = await SupplierQuotation.find({ rfq: { $in: rows.map((r) => r._id) }, supplier: user.supplierId }).lean();
    const byRfq = new Map(mine.map((m) => [String(m.rfq), m]));
    return { items: rows.map((r) => present(r, 'supplier', { myQuotationStatus: byRfq.get(String(r._id))?.status ?? null })), total };
  }
  const counts = await SupplierQuotation.aggregate([
    { $match: { rfq: { $in: rows.map((r) => r._id) }, status: { $ne: 'withdrawn' } } },
    { $group: { _id: '$rfq', n: { $sum: 1 } } },
  ]);
  const cmap = new Map(counts.map((c) => [String(c._id), c.n as number]));
  return { items: rows.map((r) => present(r, 'manager', { quotationCount: cmap.get(String(r._id)) ?? 0 })), total };
}

export async function getRfq(user: UserContext, id: string) {
  const r = await RFQ.findById(id).populate('requisition', 'number').populate('invitedSuppliers', 'companyName').lean();
  if (!r) throw notFound('RFQ not found');
  if (isSupplierUser(user)) {
    const invited = (r.invitedSuppliers as any[]).some((s) => String(s._id) === user.supplierId);
    if (!user.supplierId || !invited) throw notFound('RFQ not found'); // do not reveal existence
    return present(r, 'supplier');
  }
  const quotationCount = await SupplierQuotation.countDocuments({ rfq: id, status: { $ne: 'withdrawn' } });
  return present(r, 'manager', { quotationCount });
}

/** Close bidding early (e.g. all suppliers have quoted). Opens the sealed quotations for comparison. */
export async function closeRfq(user: UserContext, id: string) {
  const r = await RFQ.findOneAndUpdate({ _id: id, status: 'open' }, { $set: { status: 'closed' } }, { new: true });
  if (!r) throw conflict('Only an open RFQ can be closed');
  await audit(user, { action: 'rfq.closed', entityType: 'RFQ', entityId: id, entityNumber: r.number, summary: 'Closed bidding early', before: { status: 'open' }, after: { status: 'closed' } });
  return getRfq(user, id);
}

export async function cancelRfq(user: UserContext, id: string, reason: string) {
  const r = await RFQ.findOneAndUpdate({ _id: id, status: { $in: ['open', 'closed'] } }, { $set: { status: 'cancelled' } }, { new: true });
  if (!r) throw conflict('Only an open or closed RFQ (not yet awarded) can be cancelled');
  // The requisition returns to Approved so a new RFQ can be raised.
  await PurchaseRequisition.updateOne({ _id: r.requisition, status: 'RFQ Created' }, { $set: { status: 'Approved', rfq: null } });
  await ApprovalHistory.create({
    requisition: r.requisition, action: 'cancelled', stepLabel: `RFQ ${r.number} cancelled`, actor: user.id,
    actorName: user.displayName, actorRole: user.role, comment: reason,
  });
  await audit(user, { action: 'rfq.cancelled', entityType: 'RFQ', entityId: id, entityNumber: r.number, summary: `Cancelled: ${reason}`, after: { status: 'cancelled' } });
  return getRfq(user, id);
}

export const assertManager = (user: UserContext) => {
  if (isSupplierUser(user)) throw forbidden();
};
