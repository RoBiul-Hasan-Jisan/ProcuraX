const ex = (v: any, _msg?: string) => expect(v);
import { Types } from 'mongoose';
import Decimal from 'decimal.js';

jest.mock('../src/models/ApprovalHistory', () => ({ ApprovalHistory: require('./fakeDb').createFakeModel('ApprovalHistory') }));
jest.mock('../src/models/ApprovalRequest', () => ({ ApprovalRequest: require('./fakeDb').createFakeModel('ApprovalRequest') }));
jest.mock('../src/models/Department', () => ({ Department: require('./fakeDb').createFakeModel('Department') }));
jest.mock('../src/models/GoodsReceipt', () => ({ GoodsReceipt: require('./fakeDb').createFakeModel('GoodsReceipt') }));
jest.mock('../src/models/Invoice', () => ({ Invoice: require('./fakeDb').createFakeModel('Invoice') }));
jest.mock('../src/models/Material', () => ({ Material: require('./fakeDb').createFakeModel('Material') }));
jest.mock('../src/models/MRPRun', () => ({ MRPRun: require('./fakeDb').createFakeModel('MRPRun') }));
jest.mock('../src/models/Notification', () => ({ Notification: require('./fakeDb').createFakeModel('Notification') }));
jest.mock('../src/models/ProductionPlan', () => ({ ProductionPlan: require('./fakeDb').createFakeModel('ProductionPlan') }));
jest.mock('../src/models/PurchaseOrder', () => ({ PurchaseOrder: require('./fakeDb').createFakeModel('PurchaseOrder') }));
jest.mock('../src/models/PurchaseRequisition', () => ({ PurchaseRequisition: require('./fakeDb').createFakeModel('PurchaseRequisition') }));
jest.mock('../src/models/RFQ', () => ({ RFQ: require('./fakeDb').createFakeModel('RFQ') }));
jest.mock('../src/models/StockLevel', () => ({ StockLevel: require('./fakeDb').createFakeModel('StockLevel') }));
jest.mock('../src/models/StockMovement', () => ({ StockMovement: require('./fakeDb').createFakeModel('StockMovement') }));
jest.mock('../src/models/Supplier', () => ({ Supplier: require('./fakeDb').createFakeModel('Supplier') }));
jest.mock('../src/models/SupplierQuotation', () => ({ SupplierQuotation: require('./fakeDb').createFakeModel('SupplierQuotation') }));
jest.mock('../src/models/User', () => ({ User: require('./fakeDb').createFakeModel('User') }));
jest.mock('../src/models/Warehouse', () => ({ Warehouse: require('./fakeDb').createFakeModel('Warehouse') }));
jest.mock('../src/models/Forecast', () => ({ DemandForecast: require('./fakeDb').createFakeModel('DemandForecast') }));
jest.mock('../src/models/Counter', () => { const seq: Record<string, number> = {}; return { nextNumber: jest.fn(async (p: string) => `${p}-2026-${String((seq[p] = (seq[p] ?? 0) + 1)).padStart(4, '0')}`) }; });
jest.mock('../src/services/mrpService', () => ({ runMrp: jest.fn(async () => ({})) }));
jest.mock('../src/services/riskService', () => ({ scan: jest.fn(async () => ({})) }));
jest.mock('../src/services/forecastingService', () => ({ runDemandForecast: jest.fn(async () => ({})), runPriceForecast: jest.fn(async () => ({})) }));

import { Department } from '../src/models/Department';
import { GoodsReceipt } from '../src/models/GoodsReceipt';
import { Invoice } from '../src/models/Invoice';
import { Material } from '../src/models/Material';
import { Notification } from '../src/models/Notification';
import { ProductionPlan } from '../src/models/ProductionPlan';
import { PurchaseOrder } from '../src/models/PurchaseOrder';
import { PurchaseRequisition } from '../src/models/PurchaseRequisition';
import { RFQ } from '../src/models/RFQ';
import { StockLevel } from '../src/models/StockLevel';
import { StockMovement } from '../src/models/StockMovement';
import { Supplier } from '../src/models/Supplier';
import { SupplierQuotation } from '../src/models/SupplierQuotation';
import { ApprovalRequest } from '../src/models/ApprovalRequest';
import { ApprovalHistory } from '../src/models/ApprovalHistory';
import { User } from '../src/models/User';
import { Warehouse } from '../src/models/Warehouse';
import { MRPRun } from '../src/models/MRPRun';
import { statusAfterReceipt } from '../src/domain/purchaseOrder';
import { dec, toD128 } from '../src/domain/money';
import { DEMO_EMAILS, DEMO_MATERIALS, DEMO_SUPPLIERS, DEMO_SUPPLIER_USER_LINKS, DEMO_WAREHOUSES } from '../scripts/demoData';
import { DEMO_REQUISITIONS } from '../scripts/demoWorkflow';
import { seedDerived, seedWorkflow } from '../scripts/seedWorkflow';
import { runMrp } from '../src/services/mrpService';
import { scan } from '../src/services/riskService';

const M = (m: any) => m.docs as any[];
const sid = (v: any) => String(v);

function seedMasters(opts: { users?: boolean } = { users: true }) {
  M(Department).push({ _id: new Types.ObjectId(), code: 'PROD', name: 'Production' });
  for (const m of DEMO_MATERIALS) M(Material).push({ _id: new Types.ObjectId(), sku: m.sku, name: m.name, isDemoData: true });
  for (const s of DEMO_SUPPLIERS) M(Supplier).push({ _id: new Types.ObjectId(), supplierCode: s.code, companyName: s.name, paymentTerms: s.terms, paymentTermsDays: s.days, isDemoData: true });
  for (const w of DEMO_WAREHOUSES) M(Warehouse).push({ _id: new Types.ObjectId(), code: w.code, name: w.name, isDemoData: true });
  // opening stock: 1000 of every material in its first warehouse, mirroring the main seed's StockLevel rows
  for (const w of M(Warehouse)) for (const m of M(Material)) M(StockLevel).push({ _id: new Types.ObjectId(), material: m._id, warehouse: w._id, quantity: toD128('1000') });
  M(ProductionPlan).push({ _id: new Types.ObjectId(), isDemoData: true, status: 'planned' });
  if (opts.users === false) return;
  for (const [role, email] of Object.entries(DEMO_EMAILS)) {
    if (role === 'supplier') continue;
    M(User).push({ _id: new Types.ObjectId(), email, role, displayName: `[DEMO] ${role}`, firebaseUid: `uid-${role}`, status: 'active' });
  }
  for (const l of DEMO_SUPPLIER_USER_LINKS) M(User).push({ _id: new Types.ObjectId(), email: l.email, role: 'supplier', displayName: `[DEMO] ${l.supplierCode}`, supplier: M(Supplier).find((s) => s.supplierCode === l.supplierCode)._id, firebaseUid: `uid-${l.supplierCode}`, status: 'active' });
}
const all = () => [ApprovalHistory, ApprovalRequest, Department, GoodsReceipt, Invoice, Material, Notification, ProductionPlan, PurchaseOrder, PurchaseRequisition, RFQ, StockLevel, StockMovement, Supplier, SupplierQuotation, User, Warehouse, MRPRun];
beforeEach(() => { all().forEach((m: any) => { m.docs.length = 0; }); jest.clearAllMocks(); jest.spyOn(console, 'log').mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());

const stockOf = (sku: string, wh: string) => {
  const m = M(Material).find((x) => x.sku === sku), w = M(Warehouse).find((x) => x.code === wh);
  return dec(M(StockLevel).find((l) => sid(l.material) === sid(m._id) && sid(l.warehouse) === sid(w._id)).quantity);
};
const reqByRef = (ref: string) => M(PurchaseRequisition).find((r) => r.externalRef === ref);
const poOfRef = (ref: string) => M(PurchaseOrder).find((p) => sid(p.requisition) === sid(reqByRef(ref)._id));

describe('workflow seed: what it creates', () => {
  it('creates a requisition for every scenario, with the right statuses', async () => {
    seedMasters();
    const out = await seedWorkflow();
    ex(out.skipped).toBeNull();
    ex(out.requisitions).toBe(DEMO_REQUISITIONS.length);
    const status = (ref: string) => reqByRef(ref).status;
    ex([status('DEMO-R01'), status('DEMO-R02'), status('DEMO-R03'), status('DEMO-R04'), status('DEMO-R05'), status('DEMO-R06')]).toEqual(['Draft', 'Submitted', 'Under Review', 'Under Review', 'Modification Requested', 'Rejected']);
    ex([status('DEMO-R07'), status('DEMO-R08')]).toEqual(['Approved', 'Approved']); // the "Create RFQ" list is not empty
    ex([status('DEMO-R09'), status('DEMO-R13'), status('DEMO-R14'), status('DEMO-R16'), status('DEMO-R17')]).toEqual(['RFQ Created', 'RFQ Created', 'Ordered', 'Partially Fulfilled', 'Completed']);
  });
  it('gives the approvals pages pending work for each approver', async () => {
    seedMasters();
    await seedWorkflow();
    const pending = (ref: string) => M(ApprovalRequest).find((a) => sid(a.requisition) === sid(reqByRef(ref)._id));
    ex(pending('DEMO-R02').steps.find((s: any) => s.status === 'pending').role).toBe('department_manager');
    ex(pending('DEMO-R03').steps.find((s: any) => s.status === 'pending').role).toBe('procurement_manager');
    ex(pending('DEMO-R04').steps.find((s: any) => s.status === 'pending').role).toBe('finance_officer');
    ex(pending('DEMO-R05').status).toBe('modification_requested');
    ex(pending('DEMO-R06').status).toBe('rejected');
    ex(M(ApprovalRequest).some((a) => sid(a.requisition) === sid(reqByRef('DEMO-R01')._id))).toBe(false); // a draft has no approval request yet
    // every decided step names who decided it
    for (const a of M(ApprovalRequest)) for (const s of a.steps) if (s.status !== 'pending') ex(s.decidedByName).toBeTruthy();
    ex(M(ApprovalHistory).length).toBeGreaterThan(M(ApprovalRequest).length);
  });
  it('seals open RFQs and opens closed ones', async () => {
    seedMasters();
    await seedWorkflow();
    const rfqOf = (ref: string) => M(RFQ).find((r) => sid(r.requisition) === sid(reqByRef(ref)._id));
    ex(rfqOf('DEMO-R09').status).toBe('open');
    ex(rfqOf('DEMO-R09').deadline.getTime()).toBeGreaterThan(Date.now());
    ex(rfqOf('DEMO-R11').status).toBe('closed');
    ex(rfqOf('DEMO-R11').deadline.getTime()).toBeLessThan(Date.now());
    ex(rfqOf('DEMO-R12').status).toBe('awarded');
    const q = M(SupplierQuotation).filter((x) => sid(x.rfq) === sid(rfqOf('DEMO-R11')._id));
    ex(q).toHaveLength(3);
    ex(q.every((x) => x.status === 'submitted')).toBe(true); // nothing is awarded until a person decides
    ex(rfqOf('DEMO-R11').award).toBeUndefined();
  });
  it('records awards as a person would: one awarded quotation, the rest not selected, with a justification', async () => {
    seedMasters();
    await seedWorkflow();
    const rfq = M(RFQ).find((r) => sid(r.requisition) === sid(reqByRef('DEMO-R12')._id));
    const qs = M(SupplierQuotation).filter((x) => sid(x.rfq) === sid(rfq._id));
    ex(qs.map((x) => x.status).sort()).toEqual(['awarded', 'not_selected']);
    ex(sid(rfq.award.quotation)).toBe(sid(qs.find((x) => x.status === 'awarded')._id));
    ex(rfq.award.justification).toMatch(/\w{10}/);
    ex(rfq.award.awardedByName).toBeTruthy();
    ex(rfq.award.overrodeTopRank).toBe(false); // SUP-0002 was the cheapest
  });
  it('quotation totals follow the landed-cost formula exactly', async () => {
    seedMasters();
    await seedWorkflow();
    for (const q of M(SupplierQuotation)) {
      const total = dec(q.materialCost).plus(dec(q.transportCost)).plus(dec(q.additionalCharges)).plus(dec(q.taxAmount));
      ex(dec(q.totalLandedCost).eq(total)).toBe(true);
      ex(dec(q.taxAmount).eq(dec(q.materialCost).mul(5).div(100).toDecimalPlaces(2))).toBe(true);
      ex(q.validUntil.getTime()).toBeGreaterThan(Date.now());
    }
  });
  it('creates purchase orders in every state and keeps status consistent with receipts', async () => {
    seedMasters();
    const out = await seedWorkflow();
    ex(out.purchaseOrders).toBe(7);
    ex(['DEMO-R13', 'DEMO-R14', 'DEMO-R15', 'DEMO-R16', 'DEMO-R17'].map((r) => poOfRef(r).status)).toEqual(['draft', 'issued', 'issued', 'partially_received', 'received']);
    ex(M(PurchaseOrder).some((p) => sid(p.requisition) === sid(reqByRef('DEMO-R12')._id))).toBe(false); // awarded, PO not created yet
    for (const p of M(PurchaseOrder).filter((x) => x.receiptSeq > 0)) ex(statusAfterReceipt(p.lines.map((l: any) => ({ material: sid(l.material), quantity: l.quantity, acceptedQty: l.acceptedQty })))).toBe(p.status);
    const late = poOfRef('DEMO-R15');
    ex(late.expectedDeliveryDate.getTime()).toBeLessThan(Date.now()); // appears in the Delayed Delivery report
    ex(poOfRef('DEMO-R14').expectedDeliveryDate.getTime()).toBeGreaterThan(Date.now());
    ex(poOfRef('DEMO-R14').issuedAt).toBeInstanceOf(Date);
    ex(poOfRef('DEMO-R13').issuedAt).toBeUndefined();
  });
  it('puts open purchase orders in front of the receive-goods dialog', async () => {
    seedMasters();
    await seedWorkflow();
    const receivable = M(PurchaseOrder).filter((p) => ['issued', 'partially_received'].includes(p.status));
    ex(receivable.length).toBeGreaterThanOrEqual(3);
  });
});

describe('workflow seed: stock and receipts', () => {
  it('adds accepted quantity to stock once, with a matching ledger entry', async () => {
    seedMasters();
    const before = stockOf('SCR-HMS', 'WH-MAIN');
    await seedWorkflow();
    const accepted = new Decimal(1000).mul(55).div(100); // R16: 55% of 1000 MT accepted, 20 MT rejected
    ex(stockOf('SCR-HMS', 'WH-MAIN').minus(before).eq(accepted)).toBe(true);
    const moves = M(StockMovement).filter((m) => m.type === 'receipt');
    ex(moves.length).toBe(1 + 2 + 1 + 1); // R16 (1 line), R17 (2), R18 (1), R19 (1)
    const m = moves.find((x) => x.reason.startsWith('Goods receipt') && dec(x.delta).eq(accepted))!;
    ex(dec(m.balanceAfter).eq(stockOf('SCR-HMS', 'WH-MAIN'))).toBe(true); // the ledger agrees with the balance
    ex(m.reference.kind).toBe('GoodsReceipt');
    ex(moves.every((x) => x.createdAt.getTime() <= Date.now())).toBe(true);
  });
  it('does not stock rejected quantity', async () => {
    seedMasters();
    await seedWorkflow();
    const r = M(GoodsReceipt).find((x) => x.deliveryNote === 'DEMO-DN-1001');
    ex(dec(r.lines[0].rejectedQty).eq(20)).toBe(true);
    ex(r.lines[0].rejectionReason).toMatch(/Oversize/);
    const po = poOfRef('DEMO-R16');
    ex(dec(po.lines[0].acceptedQty).eq(550)).toBe(true);
    ex(dec(po.lines[0].rejectedQty).eq(20)).toBe(true);
  });
  it('repairs a missing ledger entry without duplicating the receipt', async () => {
    seedMasters();
    await seedWorkflow();
    const receipts = M(GoodsReceipt).length;
    const gone = M(StockMovement).findIndex((m) => m.type === 'receipt'); // simulate a crash between the receipt and its stock update
    M(StockMovement).splice(gone, 1);
    await seedWorkflow();
    ex(M(GoodsReceipt).length).toBe(receipts);
    ex(M(StockMovement).filter((m) => m.type === 'receipt').length).toBe(5);
  });
});

describe('workflow seed: invoices', () => {
  it('covers pending, verified and disputed, and the three-way match explains the dispute', async () => {
    seedMasters();
    const out = await seedWorkflow();
    ex(out.invoices).toBe(3);
    const inv = (n: string) => M(Invoice).find((i) => i.invoiceNumber === n);
    ex(inv('DEMO-SUP-INV-5001')).toMatchObject({ status: 'pending_verification' });
    ex(inv('DEMO-SUP-INV-5001').match.ok).toBe(true); // can be verified in the UI
    ex(inv('DEMO-SUP-INV-5002')).toMatchObject({ status: 'verified' });
    ex(inv('DEMO-SUP-INV-5002').decision.byName).toBeTruthy();
    ex(inv('DEMO-SUP-INV-5003')).toMatchObject({ status: 'disputed' });
    ex(inv('DEMO-SUP-INV-5003').match.ok).toBe(false);
    ex(inv('DEMO-SUP-INV-5003').match.issues.join(' ')).toMatch(/Unit price/);
  });
  it('verified invoice bills the accepted quantity and updates the PO invoiced quantity', async () => {
    seedMasters();
    await seedWorkflow();
    const po = poOfRef('DEMO-R18');
    ex(dec(po.lines[0].invoicedQty).eq(dec(po.lines[0].acceptedQty))).toBe(true);
    ex(dec(poOfRef('DEMO-R17').lines[0].invoicedQty).eq(0)).toBe(true); // pending: nothing counted yet
    const i = M(Invoice).find((x) => x.invoiceNumber === 'DEMO-SUP-INV-5002');
    const total = dec(i.materialCost).plus(dec(i.transportCost)).plus(dec(i.additionalCharges)).plus(dec(i.taxAmount));
    ex(dec(i.totalAmount).eq(total)).toBe(true);
  });
});

describe('workflow seed: notifications', () => {
  it('gives each role something in the bell, with a mix of read and unread and only in-app links', async () => {
    seedMasters();
    const out = await seedWorkflow();
    ex(out.notifications).toBeGreaterThan(10);
    const recipients = new Set(M(Notification).map((n) => sid(n.recipient)));
    for (const role of ['department_manager', 'procurement_manager', 'finance_officer', 'inventory_officer', 'system_admin']) ex(recipients.has(sid(M(User).find((u) => u.role === role)._id)), role).toBe(true);
    ex(M(Notification).some((n) => n.readAt)).toBe(true);
    ex(M(Notification).some((n) => !n.readAt)).toBe(true);
    for (const n of M(Notification)) { ex(n.link).toMatch(/^\/[^/]/); ex(n.link).not.toMatch(/undefined|null/); ex(n.isDemoData).toBe(true); }
  });
  it('never tells staff which supplier quoted or what they quoted', async () => {
    seedMasters();
    await seedWorkflow();
    for (const n of M(Notification).filter((x) => x.type === 'quotation_submitted')) { ex(n.title + n.body).not.toMatch(/SUP-|Ltd|BDT/); }
  });
});

describe('workflow seed: idempotency and safety', () => {
  it('a second run creates nothing and changes no stock', async () => {
    seedMasters();
    await seedWorkflow();
    const counts = all().map((m: any) => m.docs.length);
    const stock = M(StockLevel).map((l) => String(l.quantity));
    const out2 = await seedWorkflow();
    ex(out2).toMatchObject({ requisitions: 0, rfqs: 0, quotations: 0, purchaseOrders: 0, receipts: 0, invoices: 0, notifications: 0 });
    ex(all().map((m: any) => m.docs.length)).toEqual(counts);
    ex(M(StockLevel).map((l) => String(l.quantity))).toEqual(stock);
  });
  it('marks every record as demo data', async () => {
    seedMasters();
    await seedWorkflow();
    for (const m of [PurchaseRequisition, RFQ, SupplierQuotation, PurchaseOrder, GoodsReceipt, Invoice, ApprovalRequest, Notification]) for (const d of M(m)) ex(d.isDemoData, (m as any).modelName).toBe(true);
    for (const mv of M(StockMovement).filter((x) => x.type === 'receipt')) ex(mv.isDemoData).toBe(true);
  });
  it('skips cleanly, writing nothing, when the demo users do not exist yet', async () => {
    seedMasters({ users: false });
    const out = await seedWorkflow();
    ex(out.skipped).toMatch(/demo users missing/);
    ex(M(PurchaseRequisition)).toHaveLength(0);
    ex(M(StockMovement)).toHaveLength(0);
  });
  it('skips when master data is missing', async () => {
    for (const [role, email] of Object.entries(DEMO_EMAILS)) if (role !== 'supplier') M(User).push({ _id: new Types.ObjectId(), email, role, displayName: role });
    ex((await seedWorkflow()).skipped).toBe('master data missing');
  });
});

describe('derived demo data (MRP, risks, forecasts)', () => {
  it('runs MRP once, scans risks, and a failure in one step does not stop the others', async () => {
    seedMasters();
    await seedDerived();
    ex(runMrp).toHaveBeenCalledTimes(1);
    ex(scan).toHaveBeenCalledTimes(1);
    (scan as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const { runDemandForecast } = jest.requireMock('../src/services/forecastingService');
    await seedDerived();
    ex(runMrp).toHaveBeenCalledTimes(2); // no MRP run was stored by the mock, so it runs again; real runs are guarded by a count
    ex(runDemandForecast).toHaveBeenCalled();
  });
  it('does not run MRP again when a run already exists', async () => {
    seedMasters();
    M(MRPRun).push({ _id: new Types.ObjectId() });
    await seedDerived();
    ex(runMrp).not.toHaveBeenCalled();
  });
});
