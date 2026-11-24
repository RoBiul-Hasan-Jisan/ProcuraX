import { chain, D, oid } from './helpers';

jest.mock('../src/models/RFQ', () => ({ RFQ: require('./helpers').mockModel('findById', 'find', 'findOneAndUpdate', 'create', 'countDocuments') }));
jest.mock('../src/models/SupplierQuotation', () => ({ SupplierQuotation: require('./helpers').mockModel('find', 'findOne', 'findOneAndUpdate', 'create', 'updateOne', 'updateMany', 'countDocuments', 'aggregate') }));
jest.mock('../src/models/Supplier', () => ({ Supplier: require('./helpers').mockModel('find', 'findById') }));
jest.mock('../src/models/Material', () => ({ Material: require('./helpers').mockModel('find') }));
jest.mock('../src/models/Setting', () => ({ getSetting: jest.fn(async (_k: string, fb: unknown) => fb), putSetting: jest.fn() }));
jest.mock('../src/models/Counter', () => ({ nextNumber: jest.fn(async (p: string) => `${p}-2026-0001`) }));
jest.mock('../src/models/PurchaseRequisition', () => ({ PurchaseRequisition: require('./helpers').mockModel('findById', 'findOne', 'findOneAndUpdate', 'updateOne', 'find', 'countDocuments', 'create') }));
jest.mock('../src/models/ApprovalRequest', () => ({ ApprovalRequest: require('./helpers').mockModel('findOne', 'findOneAndUpdate', 'create', 'countDocuments', 'updateMany', 'find') }));
jest.mock('../src/models/ApprovalHistory', () => ({ ApprovalHistory: require('./helpers').mockModel('create', 'find') }));
jest.mock('../src/models/Department', () => ({ Department: require('./helpers').mockModel('exists') }));
jest.mock('../src/models/User', () => ({ User: require('./helpers').mockModel('findById') }));

import { RFQ } from '../src/models/RFQ';
import { SupplierQuotation } from '../src/models/SupplierQuotation';
import { Supplier } from '../src/models/Supplier';
import { Material } from '../src/models/Material';
import { PurchaseRequisition } from '../src/models/PurchaseRequisition';
import { ApprovalRequest } from '../src/models/ApprovalRequest';
import { ApprovalHistory } from '../src/models/ApprovalHistory';
import * as rfqService from '../src/services/rfqService';
import * as quotationService from '../src/services/quotationService';
import * as comparison from '../src/services/comparisonService';
import * as approvals from '../src/services/approvalService';
import * as requisitions from '../src/services/requisitionService';

const m = (x: unknown) => x as jest.Mock;
const day = 864e5;
const future = (d: number) => new Date(Date.now() + d * day);
const user = (over: Record<string, unknown> = {}): any => ({
  id: oid('u1'), firebaseUid: 'u1', email: 'u@x.co', displayName: 'User One', role: 'procurement_manager',
  status: 'active', departmentId: oid('d1'), supplierId: null, permissions: [], ...over,
});
const supplierUser = (id = 'sup1') => user({ role: 'supplier', supplierId: oid(id), departmentId: null });

const MAT1 = oid('m1');
const rfqDoc = (over: Record<string, unknown> = {}) => ({
  _id: oid('rfq1'), number: 'RFQ-2026-0001', status: 'open', deadline: future(5), requiredDate: future(30), requisition: { _id: oid('r1'), number: 'PR-2026-0001' },
  deliveryLocation: 'Main yard', paymentTerms: 'Net 30', deliveryRequirements: '',
  items: [{ material: MAT1, materialName: 'Steel Billets 150mm', sku: 'BIL-150', quantity: D('100'), unit: 'MT', technicalSpecs: 'IS 2830' }],
  invitedSuppliers: [{ _id: oid('sup1'), companyName: 'Alpha Steel' }, { _id: oid('sup2'), companyName: 'Beta Metals' }],
  createdAt: new Date(), ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const mdl of [RFQ, SupplierQuotation, Supplier, Material, PurchaseRequisition, ApprovalRequest, ApprovalHistory] as any[]) {
    for (const fn of Object.values(mdl)) (fn as jest.Mock).mockReset();
  }
});

describe('supplier isolation (RFQ visibility)', () => {
  it('hides an RFQ from a supplier who was not invited, indistinguishable from "not found"', async () => {
    m(RFQ.findById).mockReturnValue(chain(rfqDoc()));
    await expect(rfqService.getRfq(supplierUser('sup9'), oid('rfq1'))).rejects.toMatchObject({ statusCode: 404 });
  });
  it('shows an invited supplier the RFQ WITHOUT competitors or quotation counts', async () => {
    m(RFQ.findById).mockReturnValue(chain(rfqDoc()));
    const out: any = await rfqService.getRfq(supplierUser('sup1'), oid('rfq1'));
    expect(out.items[0].materialName).toBe('Steel Billets 150mm');
    expect(out).not.toHaveProperty('invitedSuppliers');
    expect(out).not.toHaveProperty('quotationCount');
    expect(out).not.toHaveProperty('award');
    expect(JSON.stringify(out)).not.toMatch(/Beta Metals/);
  });
  it('shows managers the invitees and quotation count', async () => {
    m(RFQ.findById).mockReturnValue(chain(rfqDoc()));
    m(SupplierQuotation.countDocuments).mockResolvedValue(2);
    const out: any = await rfqService.getRfq(user(), oid('rfq1'));
    expect(out.invitedSuppliers).toHaveLength(2);
    expect(out.quotationCount).toBe(2);
  });
  it('lists only RFQs addressed to the supplier (filter is built from the profile)', async () => {
    m(RFQ.find).mockReturnValue(chain([]));
    m(RFQ.countDocuments).mockResolvedValue(0);
    m(SupplierQuotation.find).mockReturnValue(chain([]));
    await rfqService.listRfqs(supplierUser('sup1'), { page: 1, limit: 20 });
    expect(m(RFQ.find).mock.calls[0][0]).toMatchObject({ invitedSuppliers: oid('sup1') });
  });
  it('returns nothing for a supplier account that is not linked to a supplier record', async () => {
    const out = await rfqService.listRfqs(user({ role: 'supplier', supplierId: null }), { page: 1, limit: 20 });
    expect(out).toEqual({ items: [], total: 0 });
    expect(RFQ.find).not.toHaveBeenCalled();
  });
  it('a supplier can only read their own quotation (query is scoped by profile supplier)', async () => {
    m(SupplierQuotation.findOne).mockReturnValue(chain(null));
    await quotationService.getMyQuotation(supplierUser('sup1'), oid('rfq1'));
    expect(m(SupplierQuotation.findOne).mock.calls[0][0]).toEqual({ rfq: oid('rfq1'), supplier: oid('sup1') });
  });
});

describe('quotation submission', () => {
  const body = (over: Record<string, unknown> = {}): any => ({
    lines: [{ materialId: MAT1, unitPrice: '65000.10' }], transportCost: '12000', additionalCharges: '500.55', taxRatePercent: '5',
    deliveryDays: 10, paymentTerms: 'Net 45', paymentTermsDays: 45, validUntil: future(20), notes: '', ...over,
  });
  beforeEach(() => {
    m(RFQ.findById).mockReturnValue(chain({ ...rfqDoc(), invitedSuppliers: [oid('sup1'), oid('sup2')] }));
    m(Supplier.findById).mockReturnValue(chain({ _id: oid('sup1'), status: 'active' }));
    m(SupplierQuotation.findOneAndUpdate).mockResolvedValue(null);
    m(SupplierQuotation.create).mockImplementation(async (d: any) => ({ _id: oid('q1'), ...d }));
  });

  it('stores exact decimal totals computed on the server', async () => {
    const out: any = await quotationService.submitQuotation(supplierUser('sup1'), oid('rfq1'), body());
    const saved = m(SupplierQuotation.create).mock.calls[0][0];
    expect(saved.materialCost.toString()).toBe('6500010');
    expect(saved.taxAmount.toString()).toBe('325000.5');
    expect(saved.totalLandedCost.toString()).toBe('6837511.05');
    expect(out.totalLandedCost).toBe('6837511.05');
  });
  it('takes the supplier id from the profile and quantity from the RFQ, ignoring client values', async () => {
    await quotationService.submitQuotation(supplierUser('sup1'), oid('rfq1'), body({ supplierId: oid('sup2'), quantity: '1' }));
    const saved = m(SupplierQuotation.create).mock.calls[0][0];
    expect(saved.supplier).toBe(oid('sup1'));
    expect(saved.lines[0].quantity.toString()).toBe('100');
  });
  it('refuses a supplier that was not invited', async () => {
    await expect(quotationService.submitQuotation(supplierUser('sup9'), oid('rfq1'), body())).rejects.toMatchObject({ statusCode: 404 });
    expect(SupplierQuotation.create).not.toHaveBeenCalled();
  });
  it('refuses a quotation after the deadline', async () => {
    m(RFQ.findById).mockReturnValue(chain({ ...rfqDoc({ deadline: new Date(Date.now() - 1000) }), invitedSuppliers: [oid('sup1')] }));
    await expect(quotationService.submitQuotation(supplierUser('sup1'), oid('rfq1'), body())).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/deadline/) });
    expect(SupplierQuotation.create).not.toHaveBeenCalled();
  });
  it('refuses once the RFQ is closed or awarded', async () => {
    m(RFQ.findById).mockReturnValue(chain({ ...rfqDoc({ status: 'closed' }), invitedSuppliers: [oid('sup1')] }));
    await expect(quotationService.submitQuotation(supplierUser('sup1'), oid('rfq1'), body())).rejects.toMatchObject({ statusCode: 409 });
  });
  it('requires a price for every RFQ material and rejects unknown materials', async () => {
    await expect(quotationService.submitQuotation(supplierUser('sup1'), oid('rfq1'), body({ lines: [{ materialId: oid('zz'), unitPrice: '1' }] }))).rejects.toMatchObject({ statusCode: 400 });
  });
  it('lets a supplier revise an existing quotation before the deadline (update path, no new document)', async () => {
    m(SupplierQuotation.findOneAndUpdate).mockResolvedValue({ _id: oid('q1'), rfq: oid('rfq1'), supplier: oid('sup1'), status: 'submitted', currency: 'BDT',
      lines: [], materialCost: D('1'), transportCost: D('0'), additionalCharges: D('0'), taxRatePercent: D('0'), taxAmount: D('0'), totalLandedCost: D('1'), deliveryDays: 1, paymentTerms: 'x', paymentTermsDays: 0, validUntil: future(1), notes: '' });
    await quotationService.submitQuotation(supplierUser('sup1'), oid('rfq1'), body());
    expect(SupplierQuotation.create).not.toHaveBeenCalled();
  });
  it('rejects a validity date in the past', async () => {
    await expect(quotationService.submitQuotation(supplierUser('sup1'), oid('rfq1'), body({ validUntil: new Date(Date.now() - day) }))).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('comparison and manual award', () => {
  const quote = (id: string, sup: string, total: string, days: number, over: Record<string, unknown> = {}) => ({
    _id: oid(id), rfq: oid('rfq1'), supplier: oid(sup), status: 'submitted', currency: 'BDT',
    lines: [{ material: MAT1, materialName: 'Steel Billets 150mm', unitPrice: D('60000') }],
    materialCost: D(total), transportCost: D('0'), additionalCharges: D('0'), taxAmount: D('0'), totalLandedCost: D(total),
    deliveryDays: days, paymentTerms: 'Net 30', paymentTermsDays: 30, validUntil: future(10), ...over,
  });
  const proven = { completedOrders: 20, onTimeDeliveries: 19, unitsReceived: 1000, unitsAccepted: 990 };
  const setup = (rfqOver: Record<string, unknown> = {}) => {
    m(RFQ.findById).mockReturnValue(chain(rfqDoc({ status: 'closed', ...rfqOver })));
    const qs = [quote('qa', 'sup1', '6000000', 10), quote('qb', 'sup2', '6600000', 10)];
    m(SupplierQuotation.find).mockReturnValue(chain(qs));
    m(SupplierQuotation.findOne).mockReturnValue(chain(qs[1]));
    m(Supplier.find).mockReturnValue(chain([
      { _id: oid('sup1'), companyName: 'Alpha Steel', verificationStatus: 'verified', history: proven },
      { _id: oid('sup2'), companyName: 'Beta Metals', verificationStatus: 'verified', history: proven },
    ]));
    m(Material.find).mockReturnValue(chain([{ _id: MAT1, averagePurchasePrice: D('50000') }]));
    m(RFQ.findOneAndUpdate).mockResolvedValue({ _id: oid('rfq1') });
    m(SupplierQuotation.updateOne).mockResolvedValue({});
    m(SupplierQuotation.updateMany).mockResolvedValue({});
  };

  it('keeps quotations sealed while the RFQ is open and before the deadline', async () => {
    m(RFQ.findById).mockReturnValue(chain(rfqDoc({ status: 'open', deadline: future(3) })));
    await expect(comparison.getComparison(oid('rfq1'))).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/sealed/) });
    expect(SupplierQuotation.find).not.toHaveBeenCalled();
  });
  it('opens once the deadline has passed', async () => {
    setup({ status: 'open', deadline: new Date(Date.now() - 1000) });
    const out: any = await comparison.getComparison(oid('rfq1'));
    expect(out.rows).toHaveLength(2);
  });
  it('ranks the cheaper equal-quality quotation first and reports cost difference', async () => {
    setup();
    const out: any = await comparison.getComparison(oid('rfq1'));
    expect(out.rows[0].supplierName).toBe('Alpha Steel');
    expect(out.rows[1].evaluation.costDifference).toBe('600000.00');
    expect(out.advisory).toMatch(/manually/);
  });
  it('flags unit prices well above the material average purchase price', async () => {
    setup();
    const out: any = await comparison.getComparison(oid('rfq1'));
    expect(out.rows[0].unitPrices[0]).toMatchObject({ percentVsAverage: 20, flagged: false }); // 60k vs 50k = +20%, threshold is strictly above
    m(Material.find).mockReturnValue(chain([{ _id: MAT1, averagePurchasePrice: D('40000') }]));
    const out2: any = await comparison.getComparison(oid('rfq1'));
    expect(out2.rows[0].unitPrices[0].flagged).toBe(true);
  });
  it('excludes withdrawn quotations from the query', async () => {
    setup();
    await comparison.getComparison(oid('rfq1'));
    expect(m(SupplierQuotation.find).mock.calls[0][0]).toMatchObject({ status: { $ne: 'withdrawn' } });
  });

  it('requires a justification to pick a quotation that is not top-ranked', async () => {
    setup();
    await expect(comparison.awardRfq(user(), oid('rfq1'), oid('qb'), '')).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/justification/) });
    expect(RFQ.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('records an override with its justification', async () => {
    setup();
    await comparison.awardRfq(user(), oid('rfq1'), oid('qb'), 'Beta can deliver to our second yard');
    const update = m(RFQ.findOneAndUpdate).mock.calls[0][1].$set;
    expect(update.status).toBe('awarded');
    expect(update.award).toMatchObject({ overrodeTopRank: true, justification: 'Beta can deliver to our second yard', awardedBy: oid('u1') });
  });
  it('lets a manager pick the top-ranked quotation without justification, and closes out the others', async () => {
    setup();
    m(SupplierQuotation.findOne).mockReturnValue(chain(quote('qa', 'sup1', '6000000', 10)));
    await comparison.awardRfq(user(), oid('rfq1'), oid('qa'), '');
    expect(m(RFQ.findOneAndUpdate).mock.calls[0][1].$set.award.overrodeTopRank).toBe(false);
    expect(m(SupplierQuotation.updateMany).mock.calls[0][1]).toEqual({ $set: { status: 'not_selected' } });
  });
  it('loses cleanly when two managers award at once (atomic gate returns null)', async () => {
    setup();
    m(SupplierQuotation.findOne).mockReturnValue(chain(quote('qa', 'sup1', '6000000', 10)));
    m(RFQ.findOneAndUpdate).mockResolvedValue(null);
    await expect(comparison.awardRfq(user(), oid('rfq1'), oid('qa'), '')).rejects.toMatchObject({ statusCode: 409 });
    expect(SupplierQuotation.updateOne).not.toHaveBeenCalled();
  });
  it('refuses to award an expired quotation, a withdrawn one, or an RFQ that is already awarded', async () => {
    setup();
    m(SupplierQuotation.findOne).mockReturnValue(chain(quote('qa', 'sup1', '1', 1, { validUntil: new Date(Date.now() - 1000) })));
    await expect(comparison.awardRfq(user(), oid('rfq1'), oid('qa'), '')).rejects.toMatchObject({ statusCode: 400 });
    m(SupplierQuotation.findOne).mockReturnValue(chain(quote('qa', 'sup1', '1', 1, { status: 'withdrawn' })));
    await expect(comparison.awardRfq(user(), oid('rfq1'), oid('qa'), '')).rejects.toMatchObject({ statusCode: 409 });
    m(RFQ.findById).mockReturnValue(chain(rfqDoc({ status: 'awarded' })));
    await expect(comparison.awardRfq(user(), oid('rfq1'), oid('qa'), '')).rejects.toMatchObject({ statusCode: 409 });
  });
  it('refuses to award while bids are still sealed', async () => {
    m(RFQ.findById).mockReturnValue(chain(rfqDoc({ status: 'open', deadline: future(3) })));
    await expect(comparison.awardRfq(user(), oid('rfq1'), oid('qa'), '')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('approval decisions', () => {
  const steps = [
    { order: 1, role: 'department_manager', label: 'Department approval', status: 'pending' },
    { order: 2, role: 'procurement_manager', label: 'Procurement review', status: 'pending' },
  ];
  const reqDoc = { _id: oid('r1'), requestedBy: oid('req'), department: oid('d1'), status: 'Submitted' };
  const fullReq = {
    ...reqDoc, number: 'PR-2026-0001', requestedByName: 'Req', priority: 'Medium', items: [], currency: 'BDT', estimatedTotal: D('1000'),
    requiredDate: future(9), reason: 'x', department: { _id: oid('d1'), name: 'Production' }, createdAt: new Date(), updatedAt: new Date(),
  };
  const mgr = user({ id: oid('mgr'), role: 'department_manager', departmentId: oid('d1') });
  beforeEach(() => {
    m(PurchaseRequisition.findById).mockReturnValue(chain(reqDoc));
    m(ApprovalRequest.findOne).mockReturnValue(chain({ _id: oid('a1'), status: 'pending', currentStep: 1, steps }));
    m(PurchaseRequisition.findOne).mockReturnValue(chain(fullReq));
    m(ApprovalHistory.find).mockReturnValue(chain([]));
    m(PurchaseRequisition.updateOne).mockResolvedValue({});
    m(ApprovalHistory.create).mockResolvedValue({});
  });

  it('approves step 1, moves the requisition to Under Review and logs history', async () => {
    m(ApprovalRequest.findOneAndUpdate).mockResolvedValue({ steps: [steps[0], steps[1]] });
    await approvals.decide(mgr, oid('r1'), 'approve', 'ok');
    expect(m(PurchaseRequisition.updateOne).mock.calls[0][1].$set.status).toBe('Under Review');
    expect(m(ApprovalHistory.create).mock.calls[0][0]).toMatchObject({ action: 'approved', actor: oid('mgr'), comment: 'ok' });
    const filter = m(ApprovalRequest.findOneAndUpdate).mock.calls[0][0];
    expect(filter).toMatchObject({ status: 'pending', currentStep: 1, steps: { $elemMatch: { order: 1, status: 'pending' } } });
  });
  it('rejects a second submission of the same step (atomic gate returns null) without side effects', async () => {
    m(ApprovalRequest.findOneAndUpdate).mockResolvedValue(null);
    await expect(approvals.decide(mgr, oid('r1'), 'approve')).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/already decided/) });
    expect(PurchaseRequisition.updateOne).not.toHaveBeenCalled();
    expect(ApprovalHistory.create).not.toHaveBeenCalled();
  });
  it('blocks the wrong role, wrong department and self-approval before touching the database', async () => {
    await expect(approvals.decide(user({ role: 'finance_officer' }), oid('r1'), 'approve')).rejects.toMatchObject({ statusCode: 403 });
    await expect(approvals.decide(user({ ...mgr, departmentId: oid('d2') }), oid('r1'), 'approve')).rejects.toMatchObject({ statusCode: 403 });
    await expect(approvals.decide(user({ ...mgr, id: oid('req') }), oid('r1'), 'approve')).rejects.toMatchObject({ statusCode: 403 });
    expect(ApprovalRequest.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('requires a comment to reject', async () => {
    await expect(approvals.decide(mgr, oid('r1'), 'reject', '')).rejects.toMatchObject({ statusCode: 409 });
    expect(ApprovalRequest.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('a rejection ends the request and marks the requisition Rejected', async () => {
    m(ApprovalRequest.findOneAndUpdate).mockResolvedValue({ steps });
    await approvals.decide(mgr, oid('r1'), 'reject', 'not justified');
    expect(m(PurchaseRequisition.updateOne).mock.calls[0][1].$set.status).toBe('Rejected');
    expect(m(ApprovalRequest.findOneAndUpdate).mock.calls[0][1].$set.status).toBe('rejected');
  });
  it('final approval marks the requisition Approved with a timestamp', async () => {
    m(ApprovalRequest.findOne).mockReturnValue(chain({ _id: oid('a1'), status: 'pending', currentStep: 2, steps: [{ ...steps[0], status: 'approved' }, steps[1]] }));
    m(ApprovalRequest.findOneAndUpdate).mockResolvedValue({ steps });
    await approvals.decide(user({ id: oid('pm'), role: 'procurement_manager' }), oid('r1'), 'approve');
    const set = m(PurchaseRequisition.updateOne).mock.calls[0][1].$set;
    expect(set.status).toBe('Approved');
    expect(set.approvedAt).toBeInstanceOf(Date);
  });
  it('cannot decide a requisition that was never submitted', async () => {
    m(ApprovalRequest.findOne).mockReturnValue(chain(null));
    await expect(approvals.decide(mgr, oid('r1'), 'approve')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('requisition submit and RFQ creation guards', () => {
  const draft = { _id: oid('r1'), requestedBy: oid('u1'), status: 'Draft', estimatedTotal: D('1500000'), department: oid('d1') };
  it('adds the finance step for high-value requisitions and uses the requester role', async () => {
    m(PurchaseRequisition.findOne).mockReturnValue(chain({ ...draft, items: [], currency: 'BDT', requestedByName: 'x', priority: 'Low', requiredDate: future(5), reason: 'r', createdAt: new Date(), updatedAt: new Date() }));
    m(PurchaseRequisition.findOneAndUpdate).mockResolvedValue({ _id: oid('r1') });
    m(ApprovalRequest.countDocuments).mockResolvedValue(0);
    m(ApprovalRequest.create).mockImplementation(async (d: any) => ({ _id: oid('a1'), ...d }));
    m(ApprovalRequest.findOne).mockReturnValue(chain(null));
    m(ApprovalHistory.create).mockResolvedValue({});
    m(ApprovalHistory.find).mockReturnValue(chain([]));
    await requisitions.submitRequisition(user({ role: 'inventory_officer' }), oid('r1'));
    const created = m(ApprovalRequest.create).mock.calls[0][0];
    expect(created.steps.map((s: any) => s.role)).toEqual(['department_manager', 'procurement_manager', 'finance_officer']);
    expect(created.cycle).toBe(1);
  });
  it('rejects a concurrent second submit', async () => {
    m(PurchaseRequisition.findOne).mockReturnValue(chain(draft));
    m(PurchaseRequisition.findOneAndUpdate).mockResolvedValue(null);
    await expect(requisitions.submitRequisition(user(), oid('r1'))).rejects.toMatchObject({ statusCode: 409 });
    expect(ApprovalRequest.create).not.toHaveBeenCalled();
  });
  it('does not allow submitting an already-approved or rejected requisition, or someone else\'s draft', async () => {
    m(PurchaseRequisition.findOne).mockReturnValue(chain({ ...draft, status: 'Rejected' }));
    await expect(requisitions.submitRequisition(user(), oid('r1'))).rejects.toMatchObject({ statusCode: 409 });
    m(PurchaseRequisition.findOne).mockReturnValue(chain({ ...draft, requestedBy: oid('other') }));
    await expect(requisitions.submitRequisition(user(), oid('r1'))).rejects.toMatchObject({ statusCode: 403 });
  });
  it('blocks editing a requisition that is under review', async () => {
    m(PurchaseRequisition.findOne).mockReturnValue(chain({ ...draft, status: 'Under Review' }));
    await expect(requisitions.updateRequisition(user(), oid('r1'), { items: [], requiredDate: future(1), priority: 'Low', reason: 'x' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('blocks cancelling once an RFQ exists', async () => {
    m(PurchaseRequisition.findOne).mockReturnValue(chain({ ...draft, status: 'RFQ Created' }));
    await expect(requisitions.cancelRequisition(user(), oid('r1'), 'changed mind')).rejects.toMatchObject({ statusCode: 409 });
  });

  const rfqInput = { requisitionId: oid('r1'), deliveryLocation: 'Yard', deadline: future(5), paymentTerms: 'Net 30', deliveryRequirements: '', invitedSupplierIds: [oid('sup1')] };
  const verified = { _id: oid('sup1'), companyName: 'Alpha', status: 'active', verificationStatus: 'verified' };
  it('will not create an RFQ from a rejected (or any non-approved) requisition', async () => {
    m(Supplier.find).mockReturnValue(chain([verified]));
    m(PurchaseRequisition.findById).mockReturnValue(chain({ _id: oid('r1'), status: 'Rejected', items: [] }));
    await expect(rfqService.createRfq(user(), rfqInput)).rejects.toMatchObject({ statusCode: 409 });
    expect(PurchaseRequisition.findOneAndUpdate).not.toHaveBeenCalled();
    expect(RFQ.create).not.toHaveBeenCalled();
  });
  it('will not invite unverified or inactive suppliers', async () => {
    m(Supplier.find).mockReturnValue(chain([{ ...verified, verificationStatus: 'pending' }]));
    await expect(rfqService.createRfq(user(), rfqInput)).rejects.toMatchObject({ statusCode: 400 });
  });
  it('refuses a past deadline', async () => {
    await expect(rfqService.createRfq(user(), { ...rfqInput, deadline: new Date(Date.now() - 1000) })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('only one concurrent caller can turn an Approved requisition into RFQ Created', async () => {
    m(Supplier.find).mockReturnValue(chain([verified]));
    m(PurchaseRequisition.findById).mockReturnValue(chain({ _id: oid('r1'), status: 'Approved', requiredDate: future(9), items: [{ material: MAT1, materialName: 'B', sku: 'S', quantity: D('1'), unit: 'MT' }] }));
    m(Material.find).mockReturnValue(chain([]));
    m(PurchaseRequisition.findOneAndUpdate).mockResolvedValue(null);
    await expect(rfqService.createRfq(user(), rfqInput)).rejects.toMatchObject({ statusCode: 409 });
    expect(RFQ.create).not.toHaveBeenCalled();
  });
  it('reverts the requisition to Approved if creating the RFQ fails', async () => {
    m(Supplier.find).mockReturnValue(chain([verified]));
    m(PurchaseRequisition.findById).mockReturnValue(chain({ _id: oid('r1'), status: 'Approved', requiredDate: future(9), items: [{ material: MAT1, materialName: 'B', sku: 'S', quantity: D('1'), unit: 'MT' }] }));
    m(Material.find).mockReturnValue(chain([]));
    m(PurchaseRequisition.findOneAndUpdate).mockResolvedValue({ _id: oid('r1') });
    m(RFQ.create).mockRejectedValue(new Error('db down'));
    m(PurchaseRequisition.updateOne).mockResolvedValue({});
    await expect(rfqService.createRfq(user(), rfqInput)).rejects.toThrow('db down');
    expect(m(PurchaseRequisition.updateOne).mock.calls[0][1]).toEqual({ $set: { status: 'Approved' } });
  });
});
