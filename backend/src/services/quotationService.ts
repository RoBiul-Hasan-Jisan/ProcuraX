import { RFQ } from '../models/RFQ';
import { Supplier } from '../models/Supplier';
import { SupplierQuotation } from '../models/SupplierQuotation';
import { computeQuotationCost, str, toD128, dec } from '../domain/money';
import { validateQuotationWindow } from '../domain/quotationRules';
import { badRequest, conflict, forbidden, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';
import { notify } from './notifier';
import { audit } from './auditService';

export interface QuotationInput {
  lines: { materialId: string; unitPrice: string }[];
  transportCost: string;
  additionalCharges: string;
  taxRatePercent: string;
  deliveryDays: number;
  paymentTerms: string;
  paymentTermsDays: number;
  validUntil: Date;
  notes: string;
}

export function presentQuotation(q: any) {
  return {
    id: String(q._id), rfqId: String(q.rfq), supplierId: String(q.supplier?._id ?? q.supplier), status: q.status, currency: q.currency,
    lines: q.lines.map((l: any) => ({
      materialId: String(l.material), materialName: l.materialName, quantity: str(l.quantity, 3), unit: l.unit,
      unitPrice: str(l.unitPrice), lineTotal: str(l.lineTotal),
    })),
    materialCost: str(q.materialCost), transportCost: str(q.transportCost), additionalCharges: str(q.additionalCharges),
    taxRatePercent: str(q.taxRatePercent), taxAmount: str(q.taxAmount), totalLandedCost: str(q.totalLandedCost),
    deliveryDays: q.deliveryDays, paymentTerms: q.paymentTerms, paymentTermsDays: q.paymentTermsDays,
    validUntil: q.validUntil, notes: q.notes, submittedAt: q.submittedAt, updatedAt: q.updatedAt,
  };
}

/**
 * Supplier submits or revises THEIR quotation. The supplier id always comes from the authenticated
 * profile, never from the request, and quantities always come from the RFQ (suppliers only set prices).
 */
export async function submitQuotation(user: UserContext, rfqId: string, input: QuotationInput) {
  const rfq = await RFQ.findById(rfqId).lean();
  if (!rfq) throw notFound('RFQ not found');
  const supplierId = user.supplierId;
  const isInvited = !!supplierId && (rfq.invitedSuppliers as any[]).some((s) => String(s) === supplierId);
  if (!supplierId || !isInvited) throw notFound('RFQ not found'); // same response for "does not exist" and "not yours"
  const windowError = validateQuotationWindow(
    { status: rfq.status as any, deadline: rfq.deadline, invitedSuppliers: (rfq.invitedSuppliers as any[]).map(String) }, supplierId,
  );
  if (windowError) throw conflict(windowError);
  if (input.validUntil.getTime() <= Date.now()) throw badRequest('The quotation validity date must be in the future');

  const supplier = await Supplier.findById(supplierId).lean();
  if (!supplier || supplier.status !== 'active') throw forbidden('Your supplier account is not active');

  const priceByMaterial = new Map(input.lines.map((l) => [l.materialId, l.unitPrice]));
  if (priceByMaterial.size !== input.lines.length) throw badRequest('Each material can be priced only once');
  const rfqIds = new Set(rfq.items.map((i: any) => String(i.material)));
  if (input.lines.some((l) => !rfqIds.has(l.materialId)) || rfqIds.size !== priceByMaterial.size) {
    throw badRequest('A price is required for every material in the RFQ, and only for those materials');
  }

  let cost;
  try {
    cost = computeQuotationCost({
      lines: rfq.items.map((i: any) => ({ quantity: i.quantity, unitPrice: priceByMaterial.get(String(i.material)) })),
      transportCost: input.transportCost, additionalCharges: input.additionalCharges, taxRatePercent: input.taxRatePercent,
    });
  } catch (e: any) {
    throw badRequest(e.message);
  }
  if (dec(input.taxRatePercent).gt(100) || dec(input.taxRatePercent).lt(0)) throw badRequest('Tax rate must be between 0 and 100');

  const fields = {
    lines: rfq.items.map((i: any, idx: number) => ({
      material: i.material, materialName: i.materialName, quantity: i.quantity, unit: i.unit,
      unitPrice: toD128(cost.lines[idx].unitPrice), lineTotal: toD128(cost.lines[idx].lineTotal),
    })),
    materialCost: toD128(cost.materialCost), transportCost: toD128(cost.transportCost), additionalCharges: toD128(cost.additionalCharges),
    taxRatePercent: toD128(input.taxRatePercent), taxAmount: toD128(cost.taxAmount), totalLandedCost: toD128(cost.totalLandedCost),
    deliveryDays: input.deliveryDays, paymentTerms: input.paymentTerms, paymentTermsDays: input.paymentTermsDays,
    validUntil: input.validUntil, notes: input.notes, status: 'submitted' as const, submittedAt: new Date(),
  };

  // Upsert keyed on (rfq, supplier). The unique index makes concurrent first submissions safe.
  const existing = await SupplierQuotation.findOneAndUpdate({ rfq: rfqId, supplier: supplierId, status: { $in: ['submitted', 'withdrawn'] } }, { $set: fields }, { returnDocument: 'after' });
  if (existing) {
    await audit(user, { action: 'quotation.submitted', entityType: 'SupplierQuotation', entityId: String(existing._id), entityNumber: rfq.number, summary: 'Revised quotation before the deadline', after: { rfq: String(rfqId), supplier: String(supplierId) } });
    return presentQuotation(existing);
  }
  try {
    const created = await SupplierQuotation.create({ rfq: rfqId, supplier: supplierId, ...fields });
    await notify.quotationSubmitted(rfq, supplierId);
    await audit(user, { action: 'quotation.submitted', entityType: 'SupplierQuotation', entityId: String(created._id), entityNumber: rfq.number, summary: 'Submitted quotation', after: { rfq: String(rfqId), supplier: String(supplierId) } });
    return presentQuotation(created);
  } catch (e: any) {
    if (e?.code === 11000) throw conflict('A quotation already exists for this RFQ and can no longer be changed');
    throw e;
  }
}

/** A supplier can only read their own quotation. There is deliberately no supplier-facing list of others. */
export async function getMyQuotation(user: UserContext, rfqId: string) {
  if (!user.supplierId) throw forbidden('Your account is not linked to a supplier record');
  const q = await SupplierQuotation.findOne({ rfq: rfqId, supplier: user.supplierId }).lean();
  return q ? presentQuotation(q) : null;
}

export async function withdrawQuotation(user: UserContext, rfqId: string) {
  const rfq = await RFQ.findById(rfqId).lean();
  if (!rfq || !user.supplierId) throw notFound('Quotation not found');
  if (rfq.status !== 'open' || rfq.deadline.getTime() < Date.now()) throw conflict('Quotations can only be withdrawn while the RFQ is open');
  const q = await SupplierQuotation.findOneAndUpdate({ rfq: rfqId, supplier: user.supplierId, status: 'submitted' }, { $set: { status: 'withdrawn' } }, { returnDocument: 'after' });
  if (!q) throw notFound('No active quotation to withdraw');
  return presentQuotation(q);
}
