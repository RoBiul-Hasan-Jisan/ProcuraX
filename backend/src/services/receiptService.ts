import { PurchaseOrder } from '../models/PurchaseOrder';
import { GoodsReceipt } from '../models/GoodsReceipt';
import { Warehouse } from '../models/Warehouse';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { nextNumber } from '../models/Counter';
import { dec, str, toD128 } from '../domain/money';
import { canReceiveAgainst, statusAfterReceipt, validateReceipt } from '../domain/purchaseOrder';
import { runInTransaction } from '../utils/transaction';
import { badRequest, conflict, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';
import { applyMovement } from './inventoryService';
import { recordSupplierPerformance } from './poService';
import { notify } from './notifier';
import { audit } from './auditService';

export interface ReceiptInput {
  purchaseOrderId: string; warehouseId: string; deliveryNote: string; notes: string;
  lines: { materialId: string; acceptedQty: string; rejectedQty: string; rejectionReason?: string }[];
}

const present = (r: any) => ({
  id: String(r._id), number: r.number, receivedAt: r.receivedAt, receivedByName: r.receivedByName, deliveryNote: r.deliveryNote, notes: r.notes,
  purchaseOrder: { id: String(r.purchaseOrder?._id ?? r.purchaseOrder), number: r.purchaseOrder?.number ?? null },
  supplier: { id: String(r.supplier?._id ?? r.supplier), name: r.supplier?.companyName ?? null },
  warehouse: { id: String(r.warehouse?._id ?? r.warehouse), code: r.warehouse?.code ?? null },
  lines: r.lines.map((l: any) => ({ materialId: String(l.material), materialName: l.materialName, unit: l.unit, acceptedQty: str(l.acceptedQty, 3), rejectedQty: str(l.rejectedQty, 3), rejectionReason: l.rejectionReason })),
});

/**
 * Records a goods receipt. In ONE transaction it: gates the PO (optimistic receiptSeq), writes the receipt, adds the ACCEPTED
 * quantity to the warehouse ledger, updates the PO line totals and status, moves the requisition forward and, when the order
 * is complete, records supplier performance. If any step fails everything rolls back.
 */
export async function createReceipt(user: UserContext, input: ReceiptInput) {
  const wh = await Warehouse.findById(input.warehouseId).lean();
  if (!wh) throw notFound('Warehouse not found');
  if (!wh.active) throw badRequest('This warehouse is inactive');

  const result = await runInTransaction(async (session) => {
    const po = await PurchaseOrder.findById(input.purchaseOrderId).session(session);
    if (!po) throw notFound('Purchase order not found');
    if (!canReceiveAgainst(po.status as any)) throw conflict(`Goods cannot be received against a purchase order in status "${po.status}"`);

    const problems = validateReceipt(
      po.lines.map((l: any) => ({ material: String(l.material), quantity: l.quantity, acceptedQty: l.acceptedQty })),
      input.lines.map((l) => ({ material: l.materialId, acceptedQty: l.acceptedQty, rejectedQty: l.rejectedQty, rejectionReason: l.rejectionReason })),
    );
    if (problems.length) throw badRequest(problems[0], problems);

    const byMat = new Map(po.lines.map((l: any) => [String(l.material), l]));
    const number = await nextNumber('GR', session);
    const now = new Date();
    const receiptLines = input.lines.filter((l) => dec(l.acceptedQty).gt(0) || dec(l.rejectedQty).gt(0));

    // Gate first: only one concurrent receipt can advance this PO from the state we validated.
    const newLines = po.lines.map((l: any) => {
      const r = receiptLines.find((x) => x.materialId === String(l.material));
      return r ? { ...l.toObject(), acceptedQty: toD128(dec(l.acceptedQty).plus(dec(r.acceptedQty))), rejectedQty: toD128(dec(l.rejectedQty).plus(dec(r.rejectedQty))) } : l.toObject();
    });
    const nextStatus = statusAfterReceipt(newLines.map((l: any) => ({ material: String(l.material), quantity: l.quantity, acceptedQty: l.acceptedQty })));
    const gated = await PurchaseOrder.findOneAndUpdate(
      { _id: po._id, receiptSeq: po.receiptSeq, status: { $in: ['issued', 'partially_received'] } },
      { $set: { lines: newLines, status: nextStatus, lastReceiptAt: now }, $inc: { receiptSeq: 1 } }, { new: true, session },
    );
    if (!gated) throw conflict('This purchase order was changed by someone else. Reload and try again.');

    const [receipt] = await GoodsReceipt.create([{
      number, purchaseOrder: po._id, supplier: po.supplier, warehouse: input.warehouseId, deliveryNote: input.deliveryNote, notes: input.notes,
      receivedBy: user.id, receivedByName: user.displayName, receivedAt: now,
      lines: receiptLines.map((l) => ({ material: l.materialId, materialName: (byMat.get(l.materialId) as any).materialName, unit: (byMat.get(l.materialId) as any).unit, acceptedQty: toD128(l.acceptedQty), rejectedQty: toD128(l.rejectedQty), rejectionReason: l.rejectionReason ?? '' })),
    }], { session });

    for (const l of receiptLines) {
      if (dec(l.acceptedQty).gt(0)) {
        await applyMovement(session, { material: l.materialId, warehouse: input.warehouseId, type: 'receipt', quantity: l.acceptedQty, reason: `Goods receipt ${number}`, reference: { kind: 'GoodsReceipt', id: String(receipt._id), number }, user });
      }
    }

    const reqStatus = nextStatus === 'received' ? 'Completed' : 'Partially Fulfilled';
    await PurchaseRequisition.updateOne({ _id: po.requisition, status: { $in: ['Ordered', 'Partially Fulfilled'] } }, { $set: { status: reqStatus } }, { session });
    if (nextStatus === 'received') await recordSupplierPerformance(session, gated, true);
    return { receipt, poStatus: nextStatus, poNumber: po.number };
  });
  await notify.goodsReceived(result);
  await audit(user, { action: 'goods_receipt.recorded', entityType: 'GoodsReceipt', entityId: String(result.receipt._id), entityNumber: result.receipt.number ?? '', summary: `Recorded goods against ${result.poNumber}; order is now ${result.poStatus}`, after: { purchaseOrder: String(result.receipt.purchaseOrder), poStatus: result.poStatus } });
  return { ...present(result.receipt), purchaseOrderStatus: result.poStatus };
}

export async function listReceipts(q: { page: number; limit: number; purchaseOrder?: string }) {
  const query: Record<string, unknown> = {};
  if (q.purchaseOrder) query.purchaseOrder = q.purchaseOrder;
  const [items, total] = await Promise.all([
    GoodsReceipt.find(query).sort({ receivedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('purchaseOrder', 'number').populate('supplier', 'companyName').populate('warehouse', 'code').lean(),
    GoodsReceipt.countDocuments(query),
  ]);
  return { items: items.map(present), total };
}

export async function getReceipt(id: string) {
  const r = await GoodsReceipt.findById(id).populate('purchaseOrder', 'number').populate('supplier', 'companyName').populate('warehouse', 'code').lean();
  if (!r) throw notFound('Goods receipt not found');
  return present(r);
}
