import { PurchaseOrder } from '../models/PurchaseOrder';
import { RFQ } from '../models/RFQ';
import { SupplierQuotation } from '../models/SupplierQuotation';
import { Supplier } from '../models/Supplier';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { nextNumber } from '../models/Counter';
import { str } from '../domain/money';
import { canPoTransition } from '../domain/purchaseOrder';
import { canTransition } from '../domain/requisitionStatus';
import { runInTransaction } from '../utils/transaction';
import { conflict, forbidden, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';
import { notify } from './notifier';

export function presentPo(p: any) {
  return {
    id: String(p._id), number: p.number, status: p.status, currency: p.currency,
    rfqId: String(p.rfq?._id ?? p.rfq), rfqNumber: p.rfq?.number ?? null,
    requisitionId: String(p.requisition?._id ?? p.requisition), requisitionNumber: p.requisition?.number ?? null,
    supplier: { id: String(p.supplier?._id ?? p.supplier), name: p.supplier?.companyName ?? null },
    lines: p.lines.map((l: any) => ({
      materialId: String(l.material), materialName: l.materialName, sku: l.sku, unit: l.unit, quantity: str(l.quantity, 3), unitPrice: str(l.unitPrice, 2),
      lineTotal: str(l.lineTotal, 2), acceptedQty: str(l.acceptedQty, 3), rejectedQty: str(l.rejectedQty, 3), invoicedQty: str(l.invoicedQty, 3),
    })),
    materialCost: str(p.materialCost), transportCost: str(p.transportCost), additionalCharges: str(p.additionalCharges),
    taxRatePercent: str(p.taxRatePercent), taxAmount: str(p.taxAmount), totalAmount: str(p.totalAmount),
    paymentTerms: p.paymentTerms, paymentTermsDays: p.paymentTermsDays, deliveryLocation: p.deliveryLocation, deliveryDays: p.deliveryDays,
    expectedDeliveryDate: p.expectedDeliveryDate, issuedAt: p.issuedAt, lastReceiptAt: p.lastReceiptAt, closeReason: p.closeReason ?? null, createdAt: p.createdAt,
  };
}

/** Suppliers only ever see their own POs; a PO of another supplier is reported as not found. */
function scope(user: UserContext): Record<string, unknown> {
  if (user.role === 'supplier') {
    if (!user.supplierId) throw forbidden('Your account is not linked to a supplier record yet');
    return { supplier: user.supplierId, status: { $ne: 'draft' } }; // suppliers never see drafts
  }
  return {};
}

export async function listPurchaseOrders(user: UserContext, q: { page: number; limit: number; status?: string; supplier?: string }) {
  const query: Record<string, unknown> = { ...scope(user) };
  if (q.status) query.status = q.status;
  if (q.supplier && user.role !== 'supplier') query.supplier = q.supplier;
  const [items, total] = await Promise.all([
    PurchaseOrder.find(query).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('supplier', 'companyName').populate('rfq', 'number').populate('requisition', 'number').lean(),
    PurchaseOrder.countDocuments(query),
  ]);
  return { items: items.map(presentPo), total };
}

export async function getPurchaseOrder(user: UserContext, id: string) {
  const p = await PurchaseOrder.findOne({ _id: id, ...scope(user) }).populate('supplier', 'companyName').populate('rfq', 'number').populate('requisition', 'number').lean();
  if (!p) throw notFound('Purchase order not found');
  return presentPo(p);
}

/** Creates a DRAFT purchase order from an RFQ that a person has already awarded. Nothing here picks a supplier. */
export async function createFromRfq(user: UserContext, rfqId: string) {
  const rfq = await RFQ.findById(rfqId).lean();
  if (!rfq) throw notFound('RFQ not found');
  if (rfq.status !== 'awarded' || !rfq.award?.quotation) throw conflict('A purchase order can only be created from an RFQ that has been awarded');
  const quote = await SupplierQuotation.findById(rfq.award.quotation).lean();
  if (!quote || quote.status !== 'awarded') throw conflict('The awarded quotation is no longer in an awarded state');
  const supplier = await Supplier.findById(quote.supplier).lean();
  if (!supplier) throw notFound('Supplier not found');
  if (supplier.status !== 'active') throw conflict(`The awarded supplier is ${supplier.status}. Review the award before ordering.`);

  const skus = new Map(rfq.items.map((i: any) => [String(i.material), i.sku]));
  try {
    const po = await PurchaseOrder.create({
      number: await nextNumber('PO'), rfq: rfq._id, requisition: rfq.requisition, quotation: quote._id, supplier: quote.supplier,
      lines: quote.lines.map((l: any) => ({ material: l.material, materialName: l.materialName, sku: skus.get(String(l.material)), unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
      currency: quote.currency, materialCost: quote.materialCost, transportCost: quote.transportCost, additionalCharges: quote.additionalCharges,
      taxRatePercent: quote.taxRatePercent, taxAmount: quote.taxAmount, totalAmount: quote.totalLandedCost,
      paymentTerms: quote.paymentTerms, paymentTermsDays: quote.paymentTermsDays, deliveryLocation: rfq.deliveryLocation, deliveryDays: quote.deliveryDays,
      createdBy: user.id,
    });
    return getPurchaseOrder(user, String(po._id));
  } catch (e: any) {
    if (e?.code === 11000) throw conflict('A purchase order already exists for this RFQ');
    throw e;
  }
}

/** Issue: draft -> issued, sets the expected delivery date and moves the requisition to Ordered. */
export async function issuePurchaseOrder(user: UserContext, id: string) {
  await runInTransaction(async (session) => {
    const now = new Date();
    const po = await PurchaseOrder.findOneAndUpdate({ _id: id, status: 'draft' }, [{ $set: { status: 'issued', issuedAt: now, expectedDeliveryDate: { $add: [now, { $multiply: ['$deliveryDays', 86_400_000] }] } } }], { new: true, session });
    if (!po) {
      const exists = await PurchaseOrder.findById(id).session(session).lean();
      if (!exists) throw notFound('Purchase order not found');
      throw conflict(`A purchase order in status "${exists.status}" cannot be issued`);
    }
    const req = await PurchaseRequisition.findById(po.requisition).session(session).lean();
    if (req && canTransition(req.status as any, 'Ordered')) {
      await PurchaseRequisition.updateOne({ _id: req._id, status: req.status }, { $set: { status: 'Ordered' } }, { session });
    }
  });
  const po = await getPurchaseOrder(user, id);
  await notify.purchaseOrderIssued(po, po.supplier.id);
  return po;
}

/** Draft -> cancelled, or issued with nothing received yet -> cancelled. Receipts make a PO uncancellable. */
export async function cancelPurchaseOrder(user: UserContext, id: string, reason: string) {
  const p = await PurchaseOrder.findOneAndUpdate({ _id: id, status: { $in: ['draft', 'issued'] }, receiptSeq: 0 }, { $set: { status: 'cancelled', closeReason: reason } }, { new: true });
  if (!p) {
    const exists = await PurchaseOrder.findById(id).lean();
    if (!exists) throw notFound('Purchase order not found');
    throw conflict('Only a purchase order with no receipts can be cancelled. Use short-close for a partially received order.');
  }
  return getPurchaseOrder(user, id);
}

/** Short-close a partially received order: the supplier will deliver no more. Counts against on-time performance. */
export async function closePurchaseOrder(user: UserContext, id: string, reason: string) {
  await runInTransaction(async (session) => {
    const po = await PurchaseOrder.findOneAndUpdate({ _id: id, status: 'partially_received' }, { $set: { status: 'closed', closeReason: reason } }, { new: true, session });
    if (!po) throw conflict('Only a partially received purchase order can be short-closed');
    await recordSupplierPerformance(session, po, false);
    await PurchaseRequisition.updateOne({ _id: po.requisition, status: { $in: ['Ordered', 'Partially Fulfilled'] } }, { $set: { status: 'Completed' } }, { session });
  });
  return getPurchaseOrder(user, id);
}

/**
 * Feeds supplier history (used by scoring) once an order finishes. `complete` = every ordered unit was accepted.
 * On time = finished receiving on or before the expected delivery date AND fully delivered.
 */
export async function recordSupplierPerformance(session: any, po: any, complete: boolean) {
  let received = 0, accepted = 0;
  for (const l of po.lines) { accepted += Number(l.acceptedQty.toString()); received += Number(l.acceptedQty.toString()) + Number(l.rejectedQty.toString()); }
  const onTime = complete && po.lastReceiptAt && po.expectedDeliveryDate && po.lastReceiptAt.getTime() <= po.expectedDeliveryDate.getTime();
  await Supplier.updateOne({ _id: po.supplier }, { $inc: { 'history.completedOrders': 1, 'history.onTimeDeliveries': onTime ? 1 : 0, 'history.unitsReceived': received, 'history.unitsAccepted': accepted } }, { session });
}

