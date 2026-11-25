import { Invoice } from '../models/Invoice';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { nextNumber } from '../models/Counter';
import { computeQuotationCost, dec, str, toD128 } from '../domain/money';
import { matchInvoice } from '../domain/invoiceMatch';
import { runInTransaction } from '../utils/transaction';
import { badRequest, conflict, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';
import { notify } from './notifier';
import { audit } from './auditService';

export interface InvoiceInput {
  purchaseOrderId: string; invoiceNumber: string; invoiceDate: Date;
  lines: { materialId: string; quantity: string; unitPrice: string }[];
  transportCost: string; additionalCharges: string; taxRatePercent: string;
}

const present = (i: any) => ({
  id: String(i._id), number: i.number, invoiceNumber: i.invoiceNumber, status: i.status, invoiceDate: i.invoiceDate, dueDate: i.dueDate,
  purchaseOrder: { id: String(i.purchaseOrder?._id ?? i.purchaseOrder), number: i.purchaseOrder?.number ?? null },
  supplier: { id: String(i.supplier?._id ?? i.supplier), name: i.supplier?.companyName ?? null },
  lines: i.lines.map((l: any) => ({ materialId: String(l.material), materialName: l.materialName, quantity: str(l.quantity, 3), unitPrice: str(l.unitPrice), lineTotal: str(l.lineTotal) })),
  materialCost: str(i.materialCost), transportCost: str(i.transportCost), additionalCharges: str(i.additionalCharges), taxRatePercent: str(i.taxRatePercent), taxAmount: str(i.taxAmount), totalAmount: str(i.totalAmount),
  match: i.match ? { ok: !!i.match.ok, issues: i.match.issues ?? [], expectedTotal: i.match.expectedTotal, invoiceTotal: i.match.invoiceTotal } : null,
  decision: i.decision?.at ? { byName: i.decision.byName, at: i.decision.at, comment: i.decision.comment } : null,
});

/** Quantity already billed on other live (non-disputed) invoices, per material. */
async function alreadyInvoiced(poId: string, excludeInvoiceId?: string) {
  const query: Record<string, unknown> = { purchaseOrder: poId, status: { $in: ['pending_verification', 'verified'] } };
  if (excludeInvoiceId) query._id = { $ne: excludeInvoiceId };
  const out: Record<string, string> = {};
  for (const inv of await Invoice.find(query).lean()) for (const l of inv.lines as any[]) out[String(l.material)] = dec(out[String(l.material)]).plus(dec(l.quantity)).toFixed();
  return out;
}

const poForMatch = (po: any) => ({
  lines: po.lines.map((l: any) => ({ material: String(l.material), unitPrice: l.unitPrice, acceptedQty: l.acceptedQty })),
  transportCost: po.transportCost, additionalCharges: po.additionalCharges, taxRatePercent: po.taxRatePercent,
});

/** Records a supplier invoice and runs the three-way match. A mismatched invoice is still recorded (so it can be disputed) but cannot be verified. */
export async function recordInvoice(user: UserContext, input: InvoiceInput) {
  const po = await PurchaseOrder.findById(input.purchaseOrderId).lean();
  if (!po) throw notFound('Purchase order not found');
  if (!['partially_received', 'received', 'closed'].includes(po.status)) throw conflict('An invoice can only be recorded against a purchase order that has received goods');
  const byMat = new Map(po.lines.map((l: any) => [String(l.material), l]));
  if (input.lines.some((l) => !byMat.has(l.materialId))) throw badRequest('Invoice bills a material that is not on the purchase order');

  const invoiceLines = input.lines.map((l) => ({ material: l.materialId, quantity: l.quantity, unitPrice: l.unitPrice }));
  const cost = computeQuotationCost({ lines: invoiceLines, transportCost: input.transportCost, additionalCharges: input.additionalCharges, taxRatePercent: input.taxRatePercent });
  const match = matchInvoice(
    { ...poForMatch(po) },
    { lines: invoiceLines, transportCost: input.transportCost, additionalCharges: input.additionalCharges, taxRatePercent: input.taxRatePercent },
    await alreadyInvoiced(input.purchaseOrderId),
  );
  const dueDate = new Date(input.invoiceDate.getTime() + (po.paymentTermsDays ?? 0) * 86_400_000);
  try {
    const inv = await Invoice.create({
      number: await nextNumber('INV'), invoiceNumber: input.invoiceNumber, purchaseOrder: po._id, supplier: po.supplier,
      lines: input.lines.map((l, i) => ({ material: l.materialId, materialName: (byMat.get(l.materialId) as any).materialName, quantity: toD128(l.quantity), unitPrice: toD128(l.unitPrice), lineTotal: toD128(cost.lines[i].lineTotal) })),
      materialCost: toD128(cost.materialCost), transportCost: toD128(cost.transportCost), additionalCharges: toD128(cost.additionalCharges),
      taxRatePercent: toD128(input.taxRatePercent), taxAmount: toD128(cost.taxAmount), totalAmount: toD128(cost.totalLandedCost),
      invoiceDate: input.invoiceDate, dueDate, match: { ...match, checkedAt: new Date() }, recordedBy: user.id,
    });
    await audit(user, { action: 'invoice.recorded', entityType: 'Invoice', entityId: String(inv._id), entityNumber: inv.number ?? '', summary: `Recorded supplier invoice ${input.invoiceNumber}${match.ok ? '' : ' (three-way match failed)'}`, after: { purchaseOrder: String(input.purchaseOrderId), matchOk: match.ok, totalAmount: String(cost.totalLandedCost) } });
    return getInvoice(String(inv._id));
  } catch (e: any) {
    if (e?.code === 11000) throw conflict('This supplier invoice number has already been recorded');
    throw e;
  }
}

export async function listInvoices(q: { page: number; limit: number; status?: string; purchaseOrder?: string }) {
  const query: Record<string, unknown> = {};
  if (q.status) query.status = q.status;
  if (q.purchaseOrder) query.purchaseOrder = q.purchaseOrder;
  const [items, total] = await Promise.all([
    Invoice.find(query).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('purchaseOrder', 'number').populate('supplier', 'companyName').lean(),
    Invoice.countDocuments(query),
  ]);
  return { items: items.map(present), total };
}

export async function getInvoice(id: string) {
  const i = await Invoice.findById(id).populate('purchaseOrder', 'number').populate('supplier', 'companyName').lean();
  if (!i) throw notFound('Invoice not found');
  return present(i);
}

/**
 * Finance decision. Verify re-runs the match against the CURRENT receipts and is refused on any mismatch; a mismatched
 * invoice can only be disputed. Verified quantity is added to the PO's invoicedQty in the same transaction.
 */
export async function decideInvoice(user: UserContext, id: string, action: 'verify' | 'dispute', comment: string) {
  if (action === 'dispute' && comment.trim().length < 3) throw badRequest('A reason is required to dispute an invoice');
  await runInTransaction(async (session) => {
    const inv = await Invoice.findById(id).session(session).lean();
    if (!inv) throw notFound('Invoice not found');
    if (inv.status !== 'pending_verification') throw conflict(`This invoice is already ${inv.status}`);
    const decision = { by: user.id, byName: user.displayName, at: new Date(), comment };

    if (action === 'dispute') {
      const g = await Invoice.updateOne({ _id: id, status: 'pending_verification' }, { $set: { status: 'disputed', decision } }, { session });
      if (!g.modifiedCount) throw conflict('This invoice was already decided');
      return;
    }
    const po = await PurchaseOrder.findById(inv.purchaseOrder).session(session).lean();
    if (!po) throw notFound('Purchase order not found');
    const match = matchInvoice(
      poForMatch(po),
      { lines: (inv.lines as any[]).map((l) => ({ material: String(l.material), quantity: l.quantity, unitPrice: l.unitPrice })), transportCost: inv.transportCost, additionalCharges: inv.additionalCharges, taxRatePercent: inv.taxRatePercent },
      await alreadyInvoiced(String(inv.purchaseOrder), id),
    );
    if (!match.ok) throw conflict(`The invoice does not match the purchase order and receipts: ${match.issues[0]}`);
    const g = await Invoice.updateOne({ _id: id, status: 'pending_verification' }, { $set: { status: 'verified', decision, match: { ...match, checkedAt: new Date() } } }, { session });
    if (!g.modifiedCount) throw conflict('This invoice was already decided');
    for (const l of inv.lines as any[]) {
      await PurchaseOrder.updateOne({ _id: po._id, 'lines.material': l.material }, { $inc: { 'lines.$.invoicedQty': toD128(l.quantity) } }, { session });
    }
  });
  const out = await getInvoice(id);
  await notify.invoiceDecided(out, action);
  await audit(user, { action: action === 'verify' ? 'invoice.verified' : 'invoice.disputed', entityType: 'Invoice', entityId: id, entityNumber: out.number, summary: `${action === 'verify' ? 'Verified' : 'Disputed'} invoice${comment ? `: ${comment}` : ''}`, before: { status: 'pending_verification' }, after: { status: out.status } });
  return out;
}
