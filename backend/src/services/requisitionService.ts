import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { ApprovalRequest } from '../models/ApprovalRequest';
import { ApprovalHistory } from '../models/ApprovalHistory';
import { Material } from '../models/Material';
import { Department } from '../models/Department';
import { User } from '../models/User';
import { nextNumber } from '../models/Counter';
import { getSetting } from '../models/Setting';
import { dec, str, toD128, Decimal } from '../domain/money';
import { buildApprovalSteps, DEFAULT_APPROVAL_CONFIG, type ApprovalConfig } from '../domain/approval';
import { canTransition, isCancellable, isEditable, type RequisitionStatus } from '../domain/requisitionStatus';
import { badRequest, conflict, forbidden, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';
import { requisitionScope } from './scope';
import { notify } from './notifier';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface RequisitionInput {
  items: { materialId: string; quantity: string; estimatedUnitPrice: string }[];
  requiredDate: Date;
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  reason: string;
}

export function presentRequisition(r: any, extra: Record<string, unknown> = {}) {
  return {
    id: String(r._id), number: r.number, status: r.status, priority: r.priority,
    requestedBy: { id: String(r.requestedBy?._id ?? r.requestedBy), name: r.requestedByName },
    department: r.department?._id ? { id: String(r.department._id), name: r.department.name } : { id: String(r.department), name: null },
    items: r.items.map((i: any) => ({
      id: String(i._id), materialId: String(i.material), materialName: i.materialName, sku: i.sku, category: i.category,
      quantity: str(i.quantity, 3), unit: i.unit, estimatedUnitPrice: str(i.estimatedUnitPrice), lineTotal: str(i.lineTotal),
    })),
    currency: r.currency, estimatedTotal: str(r.estimatedTotal), requiredDate: r.requiredDate, reason: r.reason,
    submittedAt: r.submittedAt ?? null, approvedAt: r.approvedAt ?? null, rfqId: r.rfq ? String(r.rfq) : null,
    createdAt: r.createdAt, updatedAt: r.updatedAt, ...extra,
  };
}

/** Builds line items from the catalogue (never trusts client-supplied names/units) with exact decimal totals. */
async function buildItems(input: RequisitionInput['items']) {
  const ids = input.map((i) => i.materialId);
  if (new Set(ids).size !== ids.length) throw badRequest('A material can appear only once per requisition');
  const materials = await Material.find({ _id: { $in: ids } }).populate('category', 'name').lean();
  const byId = new Map(materials.map((m) => [String(m._id), m]));
  let total = new Decimal(0);
  const items = input.map((i) => {
    const m = byId.get(i.materialId);
    if (!m) throw badRequest('One or more materials do not exist');
    if (!m.active) throw badRequest(`Material ${m.sku} is inactive`);
    const qty = dec(i.quantity);
    const price = dec(i.estimatedUnitPrice);
    if (qty.lte(0)) throw badRequest('Quantity must be greater than zero');
    if (price.lt(0)) throw badRequest('Unit price cannot be negative');
    const line = qty.mul(price).toDecimalPlaces(2);
    total = total.plus(line);
    return {
      material: m._id, materialName: m.name, sku: m.sku, category: (m.category as any)?.name ?? '',
      quantity: toD128(qty), unit: m.unit, estimatedUnitPrice: toD128(price), lineTotal: toD128(line),
    };
  });
  return { items, total };
}

export async function createRequisition(user: UserContext, input: RequisitionInput) {
  if (!user.departmentId) throw badRequest('Your account has no department. Ask an administrator to assign one.');
  const { items, total } = await buildItems(input.items);
  const doc = await PurchaseRequisition.create({
    number: await nextNumber('PR'),
    requestedBy: user.id, requestedByName: user.displayName, department: user.departmentId,
    items, estimatedTotal: toD128(total), requiredDate: input.requiredDate, priority: input.priority, reason: input.reason,
    status: 'Draft',
  });
  return getRequisition(user, String(doc._id));
}

async function loadScoped(user: UserContext, id: string) {
  const r = await PurchaseRequisition.findOne({ _id: id, ...requisitionScope(user) });
  if (!r) throw notFound('Requisition not found');
  return r;
}

export async function updateRequisition(user: UserContext, id: string, input: RequisitionInput) {
  const r = await loadScoped(user, id);
  if (String(r.requestedBy) !== user.id) throw forbidden('Only the requester can edit this requisition');
  if (!isEditable(r.status as RequisitionStatus)) throw conflict(`A requisition in status "${r.status}" cannot be edited`);
  const { items, total } = await buildItems(input.items);
  // The status guard makes the edit lose cleanly if a submit/cancel raced it.
  const updated = await PurchaseRequisition.findOneAndUpdate(
    { _id: id, status: { $in: ['Draft', 'Modification Requested'] } },
    { $set: { items, estimatedTotal: toD128(total), requiredDate: input.requiredDate, priority: input.priority, reason: input.reason } },
    { new: true },
  );
  if (!updated) throw conflict('The requisition changed while you were editing it');
  return getRequisition(user, id);
}

/** Submit a draft, or resubmit after modification was requested (new approval cycle). */
export async function submitRequisition(user: UserContext, id: string) {
  const r = await loadScoped(user, id);
  if (String(r.requestedBy) !== user.id) throw forbidden('Only the requester can submit this requisition');
  const from = r.status as RequisitionStatus;
  if (!canTransition(from, 'Submitted')) throw conflict(`A requisition in status "${from}" cannot be submitted`);

  const config = await getSetting<ApprovalConfig>('approval', DEFAULT_APPROVAL_CONFIG);
  const steps = buildApprovalSteps({ requesterRole: user.role, estimatedTotal: r.estimatedTotal as any, config });

  // Atomic gate: only one concurrent submit can move the requisition out of its current status.
  const gate = await PurchaseRequisition.findOneAndUpdate(
    { _id: id, status: from }, { $set: { status: 'Submitted', submittedAt: new Date() } }, { new: true },
  );
  if (!gate) throw conflict('This requisition was already submitted');

  const cycle = (await ApprovalRequest.countDocuments({ requisition: id })) + 1;
  const request = await ApprovalRequest.create({ requisition: id, cycle, steps, currentStep: 1, status: 'pending' });
  await ApprovalHistory.create({
    requisition: id, approvalRequest: request._id, action: cycle > 1 ? 'resubmitted' : 'submitted',
    actor: user.id, actorName: user.displayName, actorRole: user.role,
  });
  await notify.approvalNeeded(r, steps[0].role);
  return getRequisition(user, id);
}

export async function cancelRequisition(user: UserContext, id: string, reason: string) {
  const r = await loadScoped(user, id);
  const isOwner = String(r.requestedBy) === user.id;
  const privileged = user.role === 'system_admin' || user.role === 'procurement_manager';
  if (!isOwner && !privileged) throw forbidden('Only the requester or procurement can cancel this requisition');
  const from = r.status as RequisitionStatus;
  if (!isCancellable(from)) throw conflict(`A requisition in status "${from}" cannot be cancelled`);
  const gate = await PurchaseRequisition.findOneAndUpdate({ _id: id, status: from }, { $set: { status: 'Cancelled' } }, { new: true });
  if (!gate) throw conflict('The requisition changed, please reload');
  await ApprovalRequest.updateMany({ requisition: id, status: 'pending' }, { $set: { status: 'cancelled' } });
  await ApprovalHistory.create({
    requisition: id, action: 'cancelled', actor: user.id, actorName: user.displayName, actorRole: user.role, comment: reason,
  });
  return getRequisition(user, id);
}

export async function listRequisitions(user: UserContext, q: { page: number; limit: number; status?: string; search?: string; department?: string; mine?: boolean }) {
  const filter: Record<string, unknown> = { ...requisitionScope(user) };
  const and: Record<string, unknown>[] = [];
  if (q.status) filter.status = q.status;
  if (q.department) filter.department = q.department;
  if (q.mine) filter.requestedBy = user.id;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    and.push({ $or: [{ number: rx }, { requestedByName: rx }, { 'items.materialName': rx }] });
  }
  const finalFilter = and.length ? { $and: [filter, ...and] } : filter;
  const [items, total] = await Promise.all([
    PurchaseRequisition.find(finalFilter).populate('department', 'name').sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    PurchaseRequisition.countDocuments(finalFilter),
  ]);
  return { items: items.map((r) => presentRequisition(r)), total };
}

export async function getRequisition(user: UserContext, id: string) {
  const r = await PurchaseRequisition.findOne({ _id: id, ...requisitionScope(user) }).populate('department', 'name').lean();
  if (!r) throw notFound('Requisition not found');
  const [approval, history] = await Promise.all([
    ApprovalRequest.findOne({ requisition: id }).sort({ cycle: -1 }).lean(),
    ApprovalHistory.find({ requisition: id }).sort({ at: 1 }).lean(),
  ]);
  return presentRequisition(r, {
    approval: approval && {
      id: String(approval._id), status: approval.status, currentStep: approval.currentStep, cycle: approval.cycle,
      steps: approval.steps.map((s: any) => ({
        order: s.order, role: s.role, label: s.label, status: s.status,
        decidedByName: s.decidedByName || null, decidedAt: s.decidedAt, comment: s.comment || null,
      })),
    },
    history: history.map((h) => ({
      action: h.action, stepLabel: h.stepLabel ?? null, actorName: h.actorName, actorRole: h.actorRole, comment: h.comment || null, at: h.at,
    })),
  });
}

/** Departments helper for validating assignments */
export async function departmentExists(id: string) { return !!(await Department.exists({ _id: id })); }
export async function userDepartment(id: string) { return (await User.findById(id).lean())?.department ?? null; }
