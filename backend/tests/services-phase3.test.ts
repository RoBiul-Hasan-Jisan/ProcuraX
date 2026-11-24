import { chain, D, oid } from './helpers';

jest.mock('../src/utils/transaction', () => ({ runInTransaction: jest.fn(async (fn: any) => fn({ fake: 'session' })) }));
jest.mock('../src/models/PurchaseOrder', () => ({ PurchaseOrder: require('./helpers').mockModel('find', 'findById', 'findOne', 'findOneAndUpdate', 'updateOne', 'create', 'countDocuments') }));
jest.mock('../src/models/GoodsReceipt', () => ({ GoodsReceipt: require('./helpers').mockModel('create', 'find', 'findById', 'countDocuments') }));
jest.mock('../src/models/Warehouse', () => ({ Warehouse: require('./helpers').mockModel('findById', 'find', 'create', 'findByIdAndUpdate') }));
jest.mock('../src/models/StockLevel', () => ({ StockLevel: require('./helpers').mockModel('findOneAndUpdate', 'find') }));
jest.mock('../src/models/StockMovement', () => ({ StockMovement: require('./helpers').mockModel('create', 'find', 'countDocuments') }));
jest.mock('../src/models/Material', () => ({ Material: require('./helpers').mockModel('findById', 'find') }));
jest.mock('../src/models/Supplier', () => ({ Supplier: require('./helpers').mockModel('findById', 'updateOne') }));
jest.mock('../src/models/RFQ', () => ({ RFQ: require('./helpers').mockModel('findById') }));
jest.mock('../src/models/SupplierQuotation', () => ({ SupplierQuotation: require('./helpers').mockModel('findById') }));
jest.mock('../src/models/PurchaseRequisition', () => ({ PurchaseRequisition: require('./helpers').mockModel('findById', 'updateOne') }));
jest.mock('../src/models/Invoice', () => ({ Invoice: require('./helpers').mockModel('create', 'find', 'findById', 'updateOne', 'countDocuments') }));
jest.mock('../src/models/Counter', () => ({ nextNumber: jest.fn(async (p: string) => `${p}-2026-0001`) }));

import { PurchaseOrder } from '../src/models/PurchaseOrder';
import { GoodsReceipt } from '../src/models/GoodsReceipt';
import { Warehouse } from '../src/models/Warehouse';
import { StockLevel } from '../src/models/StockLevel';
import { StockMovement } from '../src/models/StockMovement';
import { Material } from '../src/models/Material';
import { Supplier } from '../src/models/Supplier';
import { RFQ } from '../src/models/RFQ';
import { SupplierQuotation } from '../src/models/SupplierQuotation';
import { PurchaseRequisition } from '../src/models/PurchaseRequisition';
import { Invoice } from '../src/models/Invoice';
import * as po from '../src/services/poService';
import * as receipts from '../src/services/receiptService';
import * as inventory from '../src/services/inventoryService';
import * as invoices from '../src/services/invoiceService';

const m = (x: unknown) => x as jest.Mock;
const user = (over: Record<string, unknown> = {}): any => ({ id: oid('u1'), displayName: 'User One', role: 'inventory_officer', supplierId: null, permissions: [], ...over });
const MAT = oid('m1'), WH = oid('w1'), PO = oid('po1'), SUP = oid('sup1');

const line = (over: any = {}) => ({ material: MAT, materialName: 'Billet', sku: 'BIL-150', unit: 'MT', quantity: D('100'), unitPrice: D('100'), lineTotal: D('10000'), acceptedQty: D('0'), rejectedQty: D('0'), invoicedQty: D('0'), toObject() { return { ...this }; }, ...over });
const poDoc = (over: any = {}) => ({
  _id: PO, number: 'PO-2026-0001', status: 'issued', receiptSeq: 0, supplier: SUP, requisition: oid('r1'), lines: [line()],
  transportCost: D('0'), additionalCharges: D('0'), taxRatePercent: D('0'), expectedDeliveryDate: new Date(Date.now() + 864e5), paymentTermsDays: 30, ...over,
});

const mocks = [PurchaseOrder, GoodsReceipt, Warehouse, StockLevel, StockMovement, Material, Supplier, RFQ, SupplierQuotation, PurchaseRequisition, Invoice] as any[];
beforeEach(() => {
  for (const mdl of mocks) for (const fn of Object.values(mdl)) (fn as jest.Mock).mockReset();
  m(Warehouse.findById).mockReturnValue(chain({ _id: WH, active: true }));
  m(Material.findById).mockReturnValue(chain({ _id: MAT }));
});

describe('stock ledger', () => {
  it('refuses an issue that would take stock below zero and writes no ledger row', async () => {
    m(StockLevel.findOneAndUpdate).mockResolvedValue(null); // the conditional `quantity >= amount` gate did not match
    await expect(inventory.issueStock(user(), { materialId: MAT, warehouseId: WH, quantity: '10', reason: 'melt shop' })).rejects.toMatchObject({ statusCode: 409 });
    expect(StockMovement.create).not.toHaveBeenCalled();
    const [filter] = m(StockLevel.findOneAndUpdate).mock.calls[0];
    expect(filter.quantity).toHaveProperty('$gte'); // the check lives in the same atomic update
  });
  it('writes balance and ledger together on success, with the signed delta and new balance', async () => {
    m(StockLevel.findOneAndUpdate).mockResolvedValue({ quantity: D('90') });
    m(StockMovement.create).mockResolvedValue([{}]);
    const out = await inventory.issueStock(user(), { materialId: MAT, warehouseId: WH, quantity: '10', reason: 'melt shop' });
    expect(out.balanceAfter).toBe('90.000');
    const row = m(StockMovement.create).mock.calls[0][0][0];
    expect(row.type).toBe('issue');
    expect(row.delta.toString()).toBe('-10');
    expect(row.balanceAfter.toString()).toBe('90');
    expect(m(StockMovement.create).mock.calls[0][1]).toEqual({ session: { fake: 'session' } }); // same transaction
  });
  it('transfer to the same warehouse is rejected before any write', async () => {
    await expect(inventory.transferStock(user(), { materialId: MAT, fromWarehouseId: WH, toWarehouseId: WH, quantity: '1', reason: 'move' })).rejects.toMatchObject({ statusCode: 400 });
    expect(StockLevel.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('transfer records an out and an in movement', async () => {
    m(Warehouse.findById).mockReturnValue(chain({ _id: WH, active: true }));
    m(StockLevel.findOneAndUpdate).mockResolvedValueOnce({ quantity: D('5') }).mockResolvedValueOnce({ quantity: D('15') });
    m(StockMovement.create).mockResolvedValue([{}]);
    await inventory.transferStock(user(), { materialId: MAT, fromWarehouseId: WH, toWarehouseId: oid('w2'), quantity: '5', reason: 'rebalance' });
    expect(m(StockMovement.create).mock.calls.map((c) => c[0][0].type)).toEqual(['transfer_out', 'transfer_in']);
  });
  it('cannot increase stock in an inactive warehouse', async () => {
    m(Warehouse.findById).mockReturnValue(chain({ _id: WH, active: false }));
    await expect(inventory.adjustStock(user(), { materialId: MAT, warehouseId: WH, direction: 'increase', quantity: '1', reason: 'recount' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('cannot deactivate a warehouse that still holds stock', async () => {
    m(StockLevel.find).mockReturnValue(chain([{ quantity: D('3') }]));
    await expect(inventory.updateWarehouse(WH, { active: false })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('stock overview flags materials with no stock at all', async () => {
    m(Material.find).mockReturnValue(chain([{ _id: MAT, sku: 'BIL-150', name: 'Billet', unit: 'MT', safetyStock: 50, minimumStock: 80, reorderPoint: 200 }]));
    m(StockLevel.find).mockReturnValue(chain([]));
    m(Warehouse.find).mockReturnValue(chain([]));
    const rows = await inventory.stockOverview({});
    expect(rows[0]).toMatchObject({ total: '0.000', status: 'critical', shortfallToReorderPoint: '200.000' });
  });
});

describe('goods receipt', () => {
  const input = (lines: any[]) => ({ purchaseOrderId: PO, warehouseId: WH, deliveryNote: 'DN-1', notes: '', lines });
  it('rejects over-receipt with nothing written', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain(poDoc()));
    await expect(receipts.createReceipt(user(), input([{ materialId: MAT, acceptedQty: '100.5', rejectedQty: '0' }]))).rejects.toMatchObject({ statusCode: 400 });
    expect(PurchaseOrder.findOneAndUpdate).not.toHaveBeenCalled();
    expect(StockMovement.create).not.toHaveBeenCalled();
    expect(GoodsReceipt.create).not.toHaveBeenCalled();
  });
  it('refuses a PO that is not issued', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain(poDoc({ status: 'draft' })));
    await expect(receipts.createReceipt(user(), input([{ materialId: MAT, acceptedQty: '1', rejectedQty: '0' }]))).rejects.toMatchObject({ statusCode: 409 });
  });
  it('gates on receiptSeq FIRST: a lost race writes no receipt and no stock', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain(poDoc({ receiptSeq: 3 })));
    m(PurchaseOrder.findOneAndUpdate).mockResolvedValue(null);
    await expect(receipts.createReceipt(user(), input([{ materialId: MAT, acceptedQty: '10', rejectedQty: '0' }]))).rejects.toMatchObject({ statusCode: 409 });
    expect(m(PurchaseOrder.findOneAndUpdate).mock.calls[0][0]).toMatchObject({ receiptSeq: 3 });
    expect(GoodsReceipt.create).not.toHaveBeenCalled();
    expect(StockMovement.create).not.toHaveBeenCalled();
  });
  it('full receipt: stock in, PO received, requisition completed, supplier history updated', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain(poDoc()));
    m(PurchaseOrder.findOneAndUpdate).mockImplementation(async (_f: any, upd: any) => poDoc({ status: upd.$set.status, lines: upd.$set.lines, lastReceiptAt: new Date() }));
    m(GoodsReceipt.create).mockResolvedValue([{ _id: oid('gr1'), number: 'GR-2026-0001', lines: [], receivedAt: new Date(), purchaseOrder: PO, supplier: SUP, warehouse: WH }]);
    m(StockLevel.findOneAndUpdate).mockResolvedValue({ quantity: D('100') });
    m(StockMovement.create).mockResolvedValue([{}]);
    const out = await receipts.createReceipt(user(), input([{ materialId: MAT, acceptedQty: '100', rejectedQty: '0' }]));
    expect(out.purchaseOrderStatus).toBe('received');
    expect(m(StockMovement.create).mock.calls[0][0][0]).toMatchObject({ type: 'receipt' });
    expect(m(PurchaseRequisition.updateOne).mock.calls[0][1]).toEqual({ $set: { status: 'Completed' } });
    const inc = m(Supplier.updateOne).mock.calls[0][1].$inc;
    expect(inc).toMatchObject({ 'history.completedOrders': 1, 'history.onTimeDeliveries': 1, 'history.unitsAccepted': 100 });
  });
  it('partial receipt keeps the PO open and does not touch supplier history', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain(poDoc()));
    m(PurchaseOrder.findOneAndUpdate).mockImplementation(async (_f: any, upd: any) => poDoc({ status: upd.$set.status, lines: upd.$set.lines }));
    m(GoodsReceipt.create).mockResolvedValue([{ _id: oid('gr1'), number: 'GR-2026-0001', lines: [], receivedAt: new Date(), purchaseOrder: PO, supplier: SUP, warehouse: WH }]);
    m(StockLevel.findOneAndUpdate).mockResolvedValue({ quantity: D('40') });
    m(StockMovement.create).mockResolvedValue([{}]);
    const out = await receipts.createReceipt(user(), input([{ materialId: MAT, acceptedQty: '40', rejectedQty: '0' }]));
    expect(out.purchaseOrderStatus).toBe('partially_received');
    expect(Supplier.updateOne).not.toHaveBeenCalled();
    expect(m(PurchaseRequisition.updateOne).mock.calls[0][1]).toEqual({ $set: { status: 'Partially Fulfilled' } });
  });
  it('rejected goods are recorded but never enter stock', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain(poDoc()));
    m(PurchaseOrder.findOneAndUpdate).mockImplementation(async (_f: any, upd: any) => poDoc({ status: upd.$set.status, lines: upd.$set.lines }));
    m(GoodsReceipt.create).mockResolvedValue([{ _id: oid('gr1'), number: 'GR-2026-0001', lines: [], receivedAt: new Date(), purchaseOrder: PO, supplier: SUP, warehouse: WH }]);
    await receipts.createReceipt(user(), input([{ materialId: MAT, acceptedQty: '0', rejectedQty: '8', rejectionReason: 'wrong grade' }]));
    expect(StockLevel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(StockMovement.create).not.toHaveBeenCalled();
  });
  it('a late full delivery is not counted on time', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain(poDoc()));
    m(PurchaseOrder.findOneAndUpdate).mockImplementation(async (_f: any, upd: any) => poDoc({ status: 'received', lines: upd.$set.lines, lastReceiptAt: new Date(), expectedDeliveryDate: new Date(Date.now() - 864e5) }));
    m(GoodsReceipt.create).mockResolvedValue([{ _id: oid('gr1'), number: 'GR-1', lines: [], receivedAt: new Date(), purchaseOrder: PO, supplier: SUP, warehouse: WH }]);
    m(StockLevel.findOneAndUpdate).mockResolvedValue({ quantity: D('100') });
    m(StockMovement.create).mockResolvedValue([{}]);
    await receipts.createReceipt(user(), input([{ materialId: MAT, acceptedQty: '100', rejectedQty: '0' }]));
    expect(m(Supplier.updateOne).mock.calls[0][1].$inc['history.onTimeDeliveries']).toBe(0);
  });
});

describe('purchase orders', () => {
  it('a supplier is scoped to their own, non-draft POs', async () => {
    m(PurchaseOrder.find).mockReturnValue(chain([]));
    m(PurchaseOrder.countDocuments).mockResolvedValue(0);
    await po.listPurchaseOrders(user({ role: 'supplier', supplierId: SUP }), { page: 1, limit: 20, supplier: oid('other') });
    expect(m(PurchaseOrder.find).mock.calls[0][0]).toMatchObject({ supplier: SUP, status: { $ne: 'draft' } }); // a client-supplied supplier filter cannot override it
  });
  it('an unlinked supplier account is forbidden', async () => {
    await expect(po.listPurchaseOrders(user({ role: 'supplier', supplierId: null }), { page: 1, limit: 20 })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("another supplier's PO is reported as not found", async () => {
    m(PurchaseOrder.findOne).mockReturnValue(chain(null));
    await expect(po.getPurchaseOrder(user({ role: 'supplier', supplierId: SUP }), PO)).rejects.toMatchObject({ statusCode: 404 });
    expect(m(PurchaseOrder.findOne).mock.calls[0][0]).toMatchObject({ _id: PO, supplier: SUP });
  });
  it('can only be created from an awarded RFQ', async () => {
    m(RFQ.findById).mockReturnValue(chain({ _id: oid('rfq1'), status: 'closed' }));
    await expect(po.createFromRfq(user({ role: 'procurement_manager' }), oid('rfq1'))).rejects.toMatchObject({ statusCode: 409 });
    expect(PurchaseOrder.create).not.toHaveBeenCalled();
  });
  it('is not created for a supplier that has since been blocked', async () => {
    m(RFQ.findById).mockReturnValue(chain({ _id: oid('rfq1'), status: 'awarded', award: { quotation: oid('q1') }, items: [] }));
    m(SupplierQuotation.findById).mockReturnValue(chain({ status: 'awarded', supplier: SUP, lines: [] }));
    m(Supplier.findById).mockReturnValue(chain({ status: 'blocked' }));
    await expect(po.createFromRfq(user({ role: 'procurement_manager' }), oid('rfq1'))).rejects.toMatchObject({ statusCode: 409 });
  });
  it('a duplicate PO for the same RFQ becomes a 409', async () => {
    m(RFQ.findById).mockReturnValue(chain({ _id: oid('rfq1'), status: 'awarded', award: { quotation: oid('q1') }, items: [], requisition: oid('r1'), deliveryLocation: 'x' }));
    m(SupplierQuotation.findById).mockReturnValue(chain({ status: 'awarded', supplier: SUP, lines: [], currency: 'BDT' }));
    m(Supplier.findById).mockReturnValue(chain({ status: 'active' }));
    m(PurchaseOrder.create).mockRejectedValue({ code: 11000 });
    await expect(po.createFromRfq(user({ role: 'procurement_manager' }), oid('rfq1'))).rejects.toMatchObject({ statusCode: 409 });
  });
  it('cannot be cancelled once anything was received', async () => {
    m(PurchaseOrder.findOneAndUpdate).mockResolvedValue(null);
    m(PurchaseOrder.findById).mockReturnValue(chain({ status: 'partially_received' }));
    await expect(po.cancelPurchaseOrder(user(), PO, 'changed mind')).rejects.toMatchObject({ statusCode: 409 });
    expect(m(PurchaseOrder.findOneAndUpdate).mock.calls[0][0]).toMatchObject({ receiptSeq: 0 });
  });
  it('short-close records supplier history as not on time', async () => {
    m(PurchaseOrder.findOneAndUpdate).mockResolvedValue(poDoc({ status: 'closed', lastReceiptAt: new Date(), lines: [line({ acceptedQty: D('60'), rejectedQty: D('5') })] }));
    m(PurchaseOrder.findOne).mockReturnValue(chain(null));
    m(PurchaseOrder.findById).mockReturnValue(chain(null)); // getPurchaseOrder afterwards is irrelevant here
    await po.closePurchaseOrder(user(), PO, 'supplier cannot deliver the rest').catch(() => undefined);
    expect(m(Supplier.updateOne).mock.calls[0][1].$inc).toMatchObject({ 'history.completedOrders': 1, 'history.onTimeDeliveries': 0, 'history.unitsReceived': 65, 'history.unitsAccepted': 60 });
  });
});

describe('invoices', () => {
  const poForInvoice = () => poDoc({ status: 'received', lines: [line({ acceptedQty: D('100') })], transportCost: D('0'), additionalCharges: D('0'), taxRatePercent: D('0') });
  const invInput = (over: any = {}) => ({ purchaseOrderId: PO, invoiceNumber: 'SUP-INV-1', invoiceDate: new Date(), lines: [{ materialId: MAT, quantity: '100', unitPrice: '100' }], transportCost: '0', additionalCharges: '0', taxRatePercent: '0', ...over });
  it('computes the total itself and stores the match result', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain(poForInvoice()));
    m(Invoice.find).mockReturnValue(chain([]));
    m(Invoice.create).mockResolvedValue({ _id: oid('i1') });
    m(Invoice.findById).mockReturnValue(chain({ _id: oid('i1'), lines: [], status: 'pending_verification' }));
    await invoices.recordInvoice(user({ role: 'finance_officer' }), invInput());
    const doc = m(Invoice.create).mock.calls[0][0];
    expect(doc.totalAmount.toString()).toBe('10000');
    expect(doc.match.ok).toBe(true);
  });
  it('records a mismatched invoice (so it can be disputed) but flags it', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain(poForInvoice()));
    m(Invoice.find).mockReturnValue(chain([]));
    m(Invoice.create).mockResolvedValue({ _id: oid('i1') });
    m(Invoice.findById).mockReturnValue(chain({ _id: oid('i1'), lines: [], status: 'pending_verification' }));
    await invoices.recordInvoice(user({ role: 'finance_officer' }), invInput({ lines: [{ materialId: MAT, quantity: '100', unitPrice: '120' }] }));
    expect(m(Invoice.create).mock.calls[0][0].match.ok).toBe(false);
  });
  it('refuses an invoice before any goods were received', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain(poDoc({ status: 'issued' })));
    await expect(invoices.recordInvoice(user(), invInput())).rejects.toMatchObject({ statusCode: 409 });
  });
  it('a duplicate supplier invoice number becomes a 409', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain(poForInvoice()));
    m(Invoice.find).mockReturnValue(chain([]));
    m(Invoice.create).mockRejectedValue({ code: 11000 });
    await expect(invoices.recordInvoice(user(), invInput())).rejects.toMatchObject({ statusCode: 409 });
  });
  const stored = (over: any = {}) => ({ _id: oid('i1'), status: 'pending_verification', purchaseOrder: PO, lines: [{ material: MAT, quantity: D('100'), unitPrice: D('100') }], transportCost: D('0'), additionalCharges: D('0'), taxRatePercent: D('0'), ...over });
  it('verify is refused when the match fails, and nothing is updated', async () => {
    m(Invoice.findById).mockReturnValue(chain(stored({ lines: [{ material: MAT, quantity: D('100'), unitPrice: D('150') }] })));
    m(PurchaseOrder.findById).mockReturnValue(chain(poForInvoice()));
    m(Invoice.find).mockReturnValue(chain([]));
    await expect(invoices.decideInvoice(user(), oid('i1'), 'verify', '')).rejects.toMatchObject({ statusCode: 409 });
    expect(Invoice.updateOne).not.toHaveBeenCalled();
    expect(PurchaseOrder.updateOne).not.toHaveBeenCalled();
  });
  it('re-checks against CURRENT receipts: billing more than accepted fails at verification', async () => {
    m(Invoice.findById).mockReturnValue(chain(stored()));
    m(PurchaseOrder.findById).mockReturnValue(chain(poDoc({ status: 'partially_received', lines: [line({ acceptedQty: D('60') })] })));
    m(Invoice.find).mockReturnValue(chain([]));
    await expect(invoices.decideInvoice(user(), oid('i1'), 'verify', '')).rejects.toMatchObject({ statusCode: 409 });
  });
  it('verify succeeds when it matches and bumps invoicedQty', async () => {
    m(Invoice.findById).mockReturnValueOnce(chain(stored())).mockReturnValue(chain({ ...stored({ status: 'verified' }), lines: [], match: null }));
    m(PurchaseOrder.findById).mockReturnValue(chain(poForInvoice()));
    m(Invoice.find).mockReturnValue(chain([]));
    m(Invoice.updateOne).mockResolvedValue({ modifiedCount: 1 });
    await invoices.decideInvoice(user(), oid('i1'), 'verify', '');
    expect(m(Invoice.updateOne).mock.calls[0][1].$set.status).toBe('verified');
    expect(m(PurchaseOrder.updateOne).mock.calls[0][1].$inc['lines.$.invoicedQty'].toString()).toBe('100');
  });
  it('cannot decide an invoice twice', async () => {
    m(Invoice.findById).mockReturnValue(chain(stored({ status: 'verified' })));
    await expect(invoices.decideInvoice(user(), oid('i1'), 'dispute', 'wrong')).rejects.toMatchObject({ statusCode: 409 });
  });
  it('a dispute needs a reason', async () => {
    await expect(invoices.decideInvoice(user(), oid('i1'), 'dispute', ' ')).rejects.toMatchObject({ statusCode: 400 });
  });
});
