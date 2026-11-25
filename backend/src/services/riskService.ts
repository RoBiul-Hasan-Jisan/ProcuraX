import { Material } from '../models/Material';
import { StockMovement } from '../models/StockMovement';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { PriceObservation } from '../models/PriceObservation';
import { SupplierQuotation } from '../models/SupplierQuotation';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { Invoice } from '../models/Invoice';
import { GoodsReceipt } from '../models/GoodsReceipt';
import { Supplier } from '../models/Supplier';
import { RiskAlert } from '../models/RiskAlert';
import { User } from '../models/User';
import { Role } from '../models/Role';
import { nextNumber } from '../models/Counter';
import {
  canTransitionRisk, detectAbnormalConsumption, detectDelayedPo, detectDuplicateInvoices, detectDuplicateRequisitions, detectHighQuotation, detectPriceIncrease,
  detectQualityDeterioration, detectRepeatedMismatch, detectSupplierDelivery, detectUnusualAdjustment, NOTE_REQUIRED, SEVERITY_ORDER,
  type RiskCandidate, type RiskStatus,
} from '../domain/risk';
import { weeklyTotals } from '../domain/series';
import { badRequest, conflict, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';

const num = (d: any) => Number(d?.toString() ?? 0);
const ago = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);
const mref = (m: any) => ({ id: String(m._id), name: m.name, sku: m.sku });

/** Runs every detector over recent data and returns candidates. Read-only: raising alerts is a separate step. */
export async function detectAll(now = new Date()): Promise<RiskCandidate[]> {
  const out: RiskCandidate[] = [];
  const materials: any[] = await Material.find({ active: true }).select('name sku averagePurchasePrice').lean() as any;
  const byId = new Map(materials.map((m) => [String(m._id), m]));

  // Consumption (complete weeks only: the week still in progress would always look low)
  const issues: any[] = await StockMovement.find({ type: 'issue', createdAt: { $gte: ago(now, 140), $lte: now } }).select('material delta createdAt').lean() as any;
  const perMat = new Map<string, { date: Date; value: number }[]>();
  for (const i of issues) { const k = String(i.material); (perMat.get(k) ?? perMat.set(k, []).get(k)!).push({ date: new Date(i.createdAt), value: Math.abs(num(i.delta)) }); }
  for (const [id, pts] of perMat) {
    const m = byId.get(id); if (!m) continue;
    const w = weeklyTotals(pts, now);
    const c = detectAbnormalConsumption({ material: mref(m), weeks: w.weeks, lastWeekStart: new Date(new Date(w.start).getTime() + (w.weeks.length - 1) * 7 * 86_400_000).toISOString().slice(0, 10) });
    if (c) out.push(c);
  }

  // Prices
  const obs: any[] = await PriceObservation.find({ observedAt: { $gte: ago(now, 400) } }).sort({ observedAt: 1 }).lean() as any;
  const priceBy = new Map<string, { date: Date; price: number }[]>();
  for (const o of obs) { const k = String(o.material); (priceBy.get(k) ?? priceBy.set(k, []).get(k)!).push({ date: new Date(o.observedAt), price: num(o.unitPrice) }); }
  for (const [id, observations] of priceBy) { const m = byId.get(id); if (!m) continue; const c = detectPriceIncrease({ material: mref(m), observations }); if (c) out.push(c); }

  // Quotations vs the material's average purchase price and vs peers on the same RFQ
  const quotes: any[] = await SupplierQuotation.find({ status: { $in: ['submitted', 'awarded', 'not_selected'] }, submittedAt: { $gte: ago(now, 60) } }).populate('supplier', 'companyName').populate('rfq', 'number').lean() as any;
  for (const q of quotes) {
    for (const l of q.lines) {
      const m = byId.get(String(l.material)); if (!m) continue;
      const peers = quotes.filter((p) => String(p.rfq?._id ?? p.rfq) === String(q.rfq?._id ?? q.rfq) && String(p._id) !== String(q._id)).flatMap((p) => p.lines.filter((x: any) => String(x.material) === String(l.material)).map((x: any) => num(x.unitPrice)));
      const c = detectHighQuotation({ quotationId: String(q._id), rfqNumber: q.rfq?.number, supplier: { id: String(q.supplier?._id), name: q.supplier?.companyName ?? 'Supplier' }, material: mref(m), unitPrice: num(l.unitPrice), averagePrice: m.averagePurchasePrice ? num(m.averagePurchasePrice) : null, peerPrices: peers });
      if (c) out.push(c);
    }
  }

  // Requisitions
  const reqs: any[] = await PurchaseRequisition.find({ createdAt: { $gte: ago(now, 30) } }).select('number department requestedByName createdAt status items').lean() as any;
  out.push(...detectDuplicateRequisitions(reqs.map((r) => ({ id: String(r._id), number: r.number, department: String(r.department), requestedBy: r.requestedByName, createdAt: new Date(r.createdAt), status: r.status, items: r.items.map((i: any) => ({ material: String(i.material), quantity: num(i.quantity) })) }))));

  // Invoices
  const invs: any[] = await Invoice.find({ invoiceDate: { $gte: ago(now, 180) } }).populate('supplier', 'companyName').lean() as any;
  const invLite = invs.map((i) => ({ id: String(i._id), number: i.number, invoiceNumber: i.invoiceNumber, supplier: { id: String(i.supplier?._id), name: i.supplier?.companyName ?? 'Supplier' }, total: num(i.totalAmount), invoiceDate: new Date(i.invoiceDate), status: i.status, matchOk: i.match?.ok ?? null }));
  out.push(...detectDuplicateInvoices(invLite));
  const invBySupplier = new Map<string, typeof invLite>();
  for (const i of invLite) (invBySupplier.get(i.supplier.id) ?? invBySupplier.set(i.supplier.id, []).get(i.supplier.id)!).push(i);
  for (const list of invBySupplier.values()) { const c = detectRepeatedMismatch(list[0].supplier, list, now); if (c) out.push(c); }

  // Stock adjustments
  const adj: any[] = await StockMovement.find({ type: 'adjustment', createdAt: { $gte: ago(now, 30) } }).lean() as any;
  for (const a of adj) {
    const m = byId.get(String(a.material)); if (!m) continue;
    const c = detectUnusualAdjustment({ id: String(a._id), material: mref(m), delta: num(a.delta), balanceAfter: num(a.balanceAfter), at: new Date(a.createdAt), by: a.performedByName ?? '', reason: a.reason ?? '' });
    if (c) out.push(c);
  }

  // Purchase orders
  const pos: any[] = await PurchaseOrder.find({ status: { $in: ['issued', 'partially_received'] } }).populate('supplier', 'companyName').lean() as any;
  for (const p of pos) { const c = detectDelayedPo({ id: String(p._id), number: p.number, status: p.status, expectedDeliveryDate: p.expectedDeliveryDate ? new Date(p.expectedDeliveryDate) : null, supplier: { id: String(p.supplier?._id), name: p.supplier?.companyName ?? 'Supplier' } }, now); if (c) out.push(c); }

  // Suppliers: quality trend from receipts, delivery record from history
  const suppliers: any[] = await Supplier.find({ status: { $ne: 'blocked' } }).select('companyName history').lean() as any;
  const receipts: any[] = await GoodsReceipt.find({ receivedAt: { $gte: ago(now, 365) } }).select('supplier receivedAt lines').lean() as any;
  for (const s of suppliers) {
    const sid = String(s._id); const sup = { id: sid, name: s.companyName };
    const mine = receipts.filter((r) => String(r.supplier) === sid).map((r) => ({ id: String(r._id), at: new Date(r.receivedAt), accepted: r.lines.reduce((t: number, l: any) => t + num(l.acceptedQty), 0), rejected: r.lines.reduce((t: number, l: any) => t + num(l.rejectedQty), 0) }));
    const q = detectQualityDeterioration(sup, mine); if (q) out.push(q);
    const d = detectSupplierDelivery({ ...sup, completedOrders: s.history?.completedOrders ?? 0, onTimeDeliveries: s.history?.onTimeDeliveries ?? 0 }); if (d) out.push(d);
  }
  return out;
}

/** Raises alerts for new conditions only. An alert a reviewer already handled is never reopened by a re-scan. */
export async function scan(now = new Date()) {
  const candidates = await detectAll(now);
  let created = 0;
  for (const c of candidates) {
    if (await RiskAlert.exists({ dedupeKey: c.dedupeKey })) continue;
    try {
      await RiskAlert.create({ ...c, number: await nextNumber('RSK'), detectedAt: now, status: 'open', history: [{ at: now, by: 'System scan', from: '', to: 'open', note: '' }] });
      created++;
    } catch (e: any) { if (e?.code !== 11000) throw e; } // another scan raised it first
  }
  return { detected: candidates.length, created, alreadyKnown: candidates.length - created };
}

export async function listAlerts(q: { page: number; limit: number; status?: string; severity?: string; category?: string; assignedToMe?: boolean }, user: UserContext) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.severity) filter.severity = q.severity;
  if (q.category) filter.category = q.category;
  if (q.assignedToMe) filter.assignedTo = user.id;
  const [items, total, counts]: [any[], number, any[]] = await Promise.all([
    RiskAlert.find(filter).sort({ detectedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean() as any,
    RiskAlert.countDocuments(filter),
    RiskAlert.aggregate([{ $match: { status: { $in: ['open', 'acknowledged', 'investigating'] } } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]) as any,
  ]);
  const unresolved = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, counts.find((c) => c._id === s)?.n ?? 0]));
  // Most severe first within the page
  items.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  return { items, total, unresolved };
}

export async function getAlert(id: string) {
  const a = await RiskAlert.findById(id).lean();
  if (!a) throw notFound('Risk alert not found');
  return a;
}

export async function reviewAlert(user: UserContext, id: string, input: { status?: RiskStatus; assignedTo?: string | null; note?: string }) {
  const alert: any = await RiskAlert.findById(id).lean();
  if (!alert) throw notFound('Risk alert not found');
  const note = (input.note ?? '').trim();
  const set: Record<string, unknown> = {};
  const push: Record<string, unknown> = {};

  if (input.assignedTo !== undefined) {
    if (input.assignedTo === null) { set.assignedTo = null; set.assignedToName = ''; }
    else {
      const assignee: any = await User.findById(input.assignedTo).lean();
      if (!assignee || assignee.status !== 'active' || !assignee.role) throw badRequest('The assignee must be an active user');
      const role: any = await Role.findOne({ name: assignee.role }).lean();
      if (!role?.permissions?.includes('risks:review')) throw badRequest('The assignee does not have permission to review risk alerts');
      set.assignedTo = assignee._id; set.assignedToName = assignee.displayName;
    }
  }
  if (input.status && input.status !== alert.status) {
    if (!canTransitionRisk(alert.status, input.status)) throw badRequest(`An alert that is ${alert.status} cannot move to ${input.status}`);
    if (NOTE_REQUIRED.includes(input.status) && note.length < 5) throw badRequest('Add a note of at least 5 characters explaining the outcome');
    set.status = input.status;
    if (NOTE_REQUIRED.includes(input.status)) set.resolutionNote = note;
    push.history = { at: new Date(), by: user.displayName, from: alert.status, to: input.status, note };
  } else if (note) {
    push.history = { at: new Date(), by: user.displayName, from: alert.status, to: alert.status, note };
  }
  if (!Object.keys(set).length && !Object.keys(push).length) throw badRequest('Nothing to change');

  // The gate on the current status stops two reviewers from both moving the same alert.
  const updated = await RiskAlert.findOneAndUpdate({ _id: id, status: alert.status }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(push).length ? { $push: push } : {}) }, { new: true }).lean();
  if (!updated) throw conflict('This alert was changed by someone else. Reload and try again.');
  return updated;
}
