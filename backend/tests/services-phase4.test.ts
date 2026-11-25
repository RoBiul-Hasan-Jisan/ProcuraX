import { chain, D, oid } from './helpers';

jest.mock('../src/models/ProductionPlan', () => ({ ProductionPlan: require('./helpers').mockModel('find', 'findById', 'findOneAndUpdate', 'create', 'countDocuments', 'exists') }));
jest.mock('../src/models/BillOfMaterials', () => ({ BillOfMaterials: require('./helpers').mockModel('find', 'findById', 'findOne', 'findOneAndUpdate', 'create') }));
jest.mock('../src/models/FinishedProduct', () => ({ FinishedProduct: require('./helpers').mockModel('find', 'findById') }));
jest.mock('../src/models/Material', () => ({ Material: require('./helpers').mockModel('find', 'findById') }));
jest.mock('../src/models/StockLevel', () => ({ StockLevel: require('./helpers').mockModel('find') }));
jest.mock('../src/models/StockMovement', () => ({ StockMovement: require('./helpers').mockModel('aggregate') }));
jest.mock('../src/models/StockReservation', () => ({ StockReservation: require('./helpers').mockModel('find', 'create', 'findOneAndUpdate') }));
jest.mock('../src/models/PurchaseOrder', () => ({ PurchaseOrder: require('./helpers').mockModel('find') }));
jest.mock('../src/models/MRPRun', () => ({ MRPRun: require('./helpers').mockModel('create', 'findById', 'find', 'deleteOne', 'countDocuments') }));
jest.mock('../src/models/MRPResult', () => ({ MRPResult: require('./helpers').mockModel('insertMany', 'find') }));
jest.mock('../src/models/Setting', () => ({ getSetting: jest.fn(async (_k: string, fb: unknown) => fb), putSetting: jest.fn() }));
jest.mock('../src/models/Counter', () => ({ nextNumber: jest.fn(async (p: string) => `${p}-2026-0001`) }));

import { ProductionPlan } from '../src/models/ProductionPlan';
import { BillOfMaterials } from '../src/models/BillOfMaterials';
import { FinishedProduct } from '../src/models/FinishedProduct';
import { Material } from '../src/models/Material';
import { StockLevel } from '../src/models/StockLevel';
import { StockMovement } from '../src/models/StockMovement';
import { StockReservation } from '../src/models/StockReservation';
import { PurchaseOrder } from '../src/models/PurchaseOrder';
import { MRPRun } from '../src/models/MRPRun';
import { MRPResult } from '../src/models/MRPResult';
import * as planning from '../src/services/planningService';
import * as mrp from '../src/services/mrpService';

const m = (x: unknown) => x as jest.Mock;
const user: any = { id: oid('u1'), displayName: 'Planner', role: 'procurement_manager', permissions: [] };
const day = 864e5;
const today = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); };
const inDays = (n: number) => new Date(today().getTime() + n * day);

const PROD = oid('prod1'), MAT_B = oid('matb'), MAT_F = oid('matf');
const product = { _id: PROD, code: 'TMT12', name: 'TMT Bar 12mm', unit: 'MT', active: true };
const plan = (over: any = {}) => ({ _id: oid('plan1'), number: 'PP-2026-0001', status: 'confirmed', quantity: D('100'), unit: 'MT', startDate: inDays(30), endDate: inDays(35), product, ...over });
const bom = (over: any = {}) => ({
  _id: oid('bom1'), number: 'BOM-2026-0001', product: PROD, version: 1, status: 'active', effectiveFrom: inDays(-100),
  items: [{ material: MAT_B, quantity: D('1.02'), wastagePercent: D('5') }, { material: MAT_F, quantity: D('0.01'), wastagePercent: D('0') }], ...over,
});
const mat = (id: string, sku: string, over: any = {}) => ({ _id: id, sku, name: sku, unit: 'MT', category: { name: 'Cat' }, safetyStock: 0, leadTimeDays: 10, supplierCapacity: null, averagePurchasePrice: D('1000'), preferredSuppliers: [{ _id: oid('sup1'), companyName: 'Alpha', status: 'active', verificationStatus: 'verified' }], ...over });

let savedResults: any[] = [];
beforeEach(() => {
  for (const mdl of [ProductionPlan, BillOfMaterials, FinishedProduct, Material, StockLevel, StockMovement, StockReservation, PurchaseOrder, MRPRun, MRPResult] as any[]) for (const fn of Object.values(mdl)) (fn as jest.Mock).mockReset();
  savedResults = [];
  m(FinishedProduct.find).mockReturnValue(chain([product]));
  m(BillOfMaterials.find).mockReturnValue(chain([bom()]));
  m(Material.find).mockReturnValue(chain([mat(MAT_B, 'BIL'), mat(MAT_F, 'FER')]));
  m(StockLevel.find).mockReturnValue(chain([]));
  m(StockReservation.find).mockReturnValue(chain([]));
  m(PurchaseOrder.find).mockReturnValue(chain([]));
  m(MRPRun.create).mockImplementation(async (doc: any) => ({ _id: oid('run1'), ...doc }));
  m(MRPResult.insertMany).mockImplementation(async (rows: any[]) => { savedResults = rows; return rows; });
  m(MRPRun.findById).mockImplementation(() => chain({ _id: oid('run1'), number: 'MRP-2026-0001', runDate: new Date(), horizonDays: 60, status: 'completed', summary: {}, issues: [], inputs: { plans: [] } }));
  m(MRPResult.find).mockImplementation(() => chain(savedResults.map((r, i) => ({ ...r, _id: String(i) }))));
});

const run = (planIds = [oid('plan1')], horizonDays = 60) => mrp.runMrp(user, { planIds, horizonDays });
const row = (sku: string) => savedResults.find((r) => r.sku === sku);

describe('MRP run: calculation from real records', () => {
  it('gross, wastage and net come from plan x BOM minus stock', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan()]));
    m(StockLevel.find).mockReturnValue(chain([{ material: MAT_B, quantity: D('40') }]));
    await run();
    const b = row('BIL');
    expect(b.grossRequirement).toBe('102'); // 100 x 1.02
    expect(b.adjustedRequirement).toBe('107.1'); // x 1.05
    expect(b.onHand).toBe('40');
    expect(b.netRequirement).toBe('67.1');
    expect(row('FER').netRequirement).toBe('1'); // no stock, 100 x 0.01
  });
  it('saves the run with its inputs and one result per material', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan()]));
    await run();
    const saved = m(MRPRun.create).mock.calls[0][0];
    expect(saved.inputs.plans[0]).toMatchObject({ number: 'PP-2026-0001', quantity: '100.000' });
    expect(saved.inputs.bomsUsed[0]).toMatchObject({ number: 'BOM-2026-0001', version: 1 });
    expect(saved.inputs.settings).toHaveProperty('defaultLeadTimeDays');
    expect(savedResults).toHaveLength(2);
    expect(savedResults.every((r) => r.explanation.length > 0)).toBe(true);
  });
  it('subtracts reservations for OTHER purposes but not those held for plans in this run', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan()]));
    m(StockLevel.find).mockReturnValue(chain([{ material: MAT_B, quantity: D('150') }]));
    m(StockReservation.find).mockReturnValue(chain([
      { material: MAT_B, quantity: D('30'), productionPlan: null }, // other purpose: not available
      { material: MAT_B, quantity: D('50'), productionPlan: oid('plan1') }, // this plan's own claim: same demand, not subtracted
    ]));
    await run();
    const b = row('BIL');
    expect(b.reservedOther).toBe('30');
    expect(b.reservedForPlans).toBe('50');
    expect(b.available).toBe('120');
    expect(b.netRequirement).toBe('0'); // 107.1 < 120
  });
  it('counts open purchase-order quantity once and ignores what was already accepted or rejected', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan()]));
    m(PurchaseOrder.find).mockReturnValue(chain([{ number: 'PO-1', expectedDeliveryDate: inDays(5), lines: [{ material: MAT_B, quantity: D('100'), acceptedQty: D('60'), rejectedQty: D('20') }] }]));
    await run();
    const b = row('BIL');
    expect(b.scheduledReceiptsTotal).toBe('40'); // 100 ordered - 60 accepted; the 20 rejected do not reduce what is still due
    expect(b.netRequirement).toBe('67.1'); // 107.1 - 40
    expect(b.receipts).toEqual([{ reference: 'PO-1', date: expect.any(Date), quantity: '40' }]);
  });
  it('a purchase order arriving after the need date does not reduce the requirement', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan()]));
    m(PurchaseOrder.find).mockReturnValue(chain([{ number: 'PO-LATE', expectedDeliveryDate: inDays(45), lines: [{ material: MAT_B, quantity: D('500'), acceptedQty: D('0') }] }]));
    await run();
    expect(row('BIL').netRequirement).toBe('107.1');
    expect(row('BIL').lateReceipts[0].reference).toBe('PO-LATE');
  });
  it('shares stock across multiple plans instead of counting it per plan', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan(), plan({ _id: oid('plan2'), number: 'PP-2026-0002', startDate: inDays(40) })]));
    m(StockLevel.find).mockReturnValue(chain([{ material: MAT_B, quantity: D('150') }]));
    await run([oid('plan1'), oid('plan2')]);
    expect(row('BIL').adjustedRequirement).toBe('214.2');
    expect(row('BIL').netRequirement).toBe('64.2'); // 214.2 - 150, not 2 x max(0, 107.1 - 150)
    expect(row('BIL').demands).toHaveLength(2);
  });
  it('uses the material lead time, and flags an assumed default when none is set', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan()]));
    m(Material.find).mockReturnValue(chain([mat(MAT_B, 'BIL', { leadTimeDays: 0 }), mat(MAT_F, 'FER', { leadTimeDays: 7 })]));
    await run();
    expect(row('BIL')).toMatchObject({ leadTimeDays: 14, leadTimeAssumed: true });
    expect(row('FER')).toMatchObject({ leadTimeDays: 7, leadTimeAssumed: false });
    expect(row('BIL').explanation.join(' ')).toMatch(/default of 14 days was assumed/);
  });
  it('marks an order critical when the lead time cannot meet the plan start', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan({ startDate: inDays(3) })]));
    await run();
    expect(row('BIL').urgency).toBe('critical');
    expect(row('BIL').plannedOrders[0].late).toBe(true);
  });
  it('picks only an active, verified preferred supplier and says when there is none', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan()]));
    m(Material.find).mockReturnValue(chain([
      mat(MAT_B, 'BIL', { preferredSuppliers: [{ _id: oid('s9'), companyName: 'Blocked Co', status: 'blocked', verificationStatus: 'verified' }] }),
      mat(MAT_F, 'FER', { preferredSuppliers: [] }),
    ]));
    await run();
    expect(row('BIL').preferredSupplier).toBeNull();
    expect(row('BIL').supplierNote).toMatch(/active and verified/);
    expect(row('FER').supplierNote).toMatch(/No preferred supplier is set/);
    expect(m(MRPRun.create).mock.calls[0][0].summary.noEligibleSupplier).toBe(2);
  });
  it('flags a planned order above the supplier single-order capacity', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan()]));
    m(Material.find).mockReturnValue(chain([mat(MAT_B, 'BIL', { supplierCapacity: D('50') }), mat(MAT_F, 'FER')]));
    await run();
    expect(row('BIL')).toMatchObject({ exceedsSupplierCapacity: true, ordersNeededForCapacity: 3 });
  });
  it('estimates cost only where an average price exists, and labels it an estimate', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan()]));
    m(Material.find).mockReturnValue(chain([mat(MAT_B, 'BIL', { averagePurchasePrice: D('1000') }), mat(MAT_F, 'FER', { averagePurchasePrice: null })]));
    await run();
    expect(row('BIL').estimatedCost).toBe('107100.00');
    expect(row('FER').estimatedCost).toBeNull();
    expect(m(MRPRun.create).mock.calls[0][0].summary.estimatedCost).toBe('107100.00');
  });
});

describe('MRP run: problems are reported, never hidden', () => {
  it('a plan with no active BOM produces an issue and the run is marked completed_with_issues', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan(), plan({ _id: oid('plan2'), number: 'PP-2026-0002', product: { ...product, _id: oid('other'), name: 'No BOM Product' } })]));
    await run([oid('plan1'), oid('plan2')]);
    const saved = m(MRPRun.create).mock.calls[0][0];
    expect(saved.status).toBe('completed_with_issues');
    expect(saved.issues).toEqual([{ plan: 'PP-2026-0002', message: expect.stringMatching(/No active BOM/) }]);
    expect(savedResults).toHaveLength(2); // the plan with a BOM is still calculated
  });
  it('uses only the BOM that is effective on the plan start date', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan()]));
    m(BillOfMaterials.find).mockReturnValue(chain([bom({ effectiveFrom: inDays(60) })])); // not yet effective at day 30
    await run();
    expect(m(MRPRun.create).mock.calls[0][0].status).toBe('completed_with_issues');
    expect(savedResults).toHaveLength(0);
  });
  it('excludes plans that start beyond the planning horizon and says so', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan(), plan({ _id: oid('plan2'), number: 'PP-2026-0002', startDate: inDays(200) })]));
    await run([oid('plan1'), oid('plan2')], 60);
    expect(m(MRPRun.create).mock.calls[0][0].inputs.excludedPlans).toEqual([{ plan: 'PP-2026-0002', reason: expect.stringMatching(/after the 60-day/) }]);
    expect(m(MRPRun.create).mock.calls[0][0].plans).toHaveLength(1);
  });
  it('refuses when nothing falls inside the horizon', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan({ startDate: inDays(200) })]));
    await expect(run([oid('plan1')], 60)).rejects.toMatchObject({ statusCode: 400 });
    expect(MRPRun.create).not.toHaveBeenCalled();
  });
  it('refuses completed or cancelled plans', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan({ status: 'completed' })]));
    await expect(run()).rejects.toMatchObject({ statusCode: 400 });
  });
  it('refuses unknown plan ids', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([]));
    await expect(run()).rejects.toMatchObject({ statusCode: 400 });
  });
  it('deletes the run if its results cannot be saved', async () => {
    m(ProductionPlan.find).mockReturnValue(chain([plan()]));
    m(MRPResult.insertMany).mockRejectedValue(new Error('disk full'));
    await expect(run()).rejects.toThrow('disk full');
    expect(m(MRPRun.deleteOne)).toHaveBeenCalledWith({ _id: oid('run1') });
  });
  it('zero production quantity never reaches the engine (service-level guard on plans)', async () => {
    await expect(planning.createPlan(user, { productId: PROD, quantity: '0', startDate: inDays(1), endDate: inDays(2), notes: '' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('BOM rules', () => {
  const item = (over: any = {}) => ({ materialId: MAT_B, quantity: '1', wastagePercent: '0', ...over });
  beforeEach(() => {
    m(FinishedProduct.findById).mockReturnValue(chain(product));
    m(Material.findById).mockReturnValue(chain(mat(MAT_B, 'BIL')));
    m(BillOfMaterials.findOne).mockReturnValue(chain(null));
    m(BillOfMaterials.create).mockResolvedValue({ _id: oid('bom1') });
    m(BillOfMaterials.findById).mockReturnValue(chain({ ...bom(), product, status: 'draft' }));
  });
  const input = (items: any[]) => ({ productId: PROD, effectiveFrom: new Date(), notes: '', items });
  it('rejects a component that is both a material and a sub-product, or neither', async () => {
    await expect(planning.createBom(user, input([item({ subProductId: oid('x') })]))).rejects.toMatchObject({ statusCode: 400 });
    await expect(planning.createBom(user, input([{ quantity: '1', wastagePercent: '0' }]))).rejects.toMatchObject({ statusCode: 400 });
  });
  it('rejects duplicate components, zero quantity, wastage over 100 and a product inside itself', async () => {
    await expect(planning.createBom(user, input([item(), item()]))).rejects.toMatchObject({ statusCode: 400 });
    await expect(planning.createBom(user, input([item({ quantity: '0' })]))).rejects.toMatchObject({ statusCode: 400 });
    await expect(planning.createBom(user, input([item({ wastagePercent: '101' })]))).rejects.toMatchObject({ statusCode: 400 });
    await expect(planning.createBom(user, input([item({ materialId: null, subProductId: PROD })]))).rejects.toMatchObject({ statusCode: 400 });
  });
  it('takes the unit from the catalogue and creates version 1 as a draft', async () => {
    await planning.createBom(user, input([item({ quantity: '0.0008' })]));
    const doc = m(BillOfMaterials.create).mock.calls[0][0];
    expect(doc).toMatchObject({ version: 1, status: 'draft' });
    expect(doc.items[0].unit).toBe('MT');
    expect(doc.items[0].quantity.toString()).toBe('0.0008');
  });
  it('increments the version per product', async () => {
    m(BillOfMaterials.findOne).mockReturnValue(chain({ version: 4 }));
    await planning.createBom(user, input([item()]));
    expect(m(BillOfMaterials.create).mock.calls[0][0].version).toBe(5);
  });
  it('an active BOM cannot be edited (create a new version instead)', async () => {
    m(BillOfMaterials.findById).mockReturnValue(chain({ ...bom(), status: 'active' }));
    await expect(planning.updateBom(oid('bom1'), input([item()]))).rejects.toMatchObject({ statusCode: 409 });
    expect(BillOfMaterials.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('refuses to activate a circular multi-level BOM', async () => {
    const A = oid('pa'), B = oid('pb');
    const mk = (id: string, product: string, sub: string, status: string) => ({ _id: id, number: `BOM-${id.slice(-2)}`, product, version: 1, status, effectiveFrom: inDays(-10), items: [{ subProduct: sub, quantity: D('1'), wastagePercent: D('0') }] });
    m(BillOfMaterials.findById).mockReturnValue(chain(mk(oid('b1'), A, B, 'draft')));
    m(BillOfMaterials.find).mockReturnValue(chain([mk(oid('b2'), B, A, 'active')]));
    await expect(planning.activateBom(oid('b1'))).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Circular/) });
    expect(BillOfMaterials.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('activates a valid draft with an atomic gate on status', async () => {
    m(BillOfMaterials.findById).mockReturnValue(chain({ ...bom(), status: 'draft' }));
    m(BillOfMaterials.find).mockReturnValue(chain([]));
    m(BillOfMaterials.findOneAndUpdate).mockResolvedValue({});
    await planning.activateBom(oid('bom1'));
    expect(m(BillOfMaterials.findOneAndUpdate).mock.calls[0][0]).toMatchObject({ status: 'draft' });
  });
  it('only an active BOM can be made obsolete', async () => {
    m(BillOfMaterials.findOneAndUpdate).mockResolvedValue(null);
    await expect(planning.obsoleteBom(oid('bom1'))).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('production plan rules', () => {
  it('completion date cannot precede the start date', async () => {
    await expect(planning.createPlan(user, { productId: PROD, quantity: '10', startDate: inDays(5), endDate: inDays(2), notes: '' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('an inactive product cannot be planned', async () => {
    m(FinishedProduct.findById).mockReturnValue(chain({ ...product, active: false }));
    await expect(planning.createPlan(user, { productId: PROD, quantity: '10', startDate: inDays(1), endDate: inDays(2), notes: '' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('illegal status jumps are refused', async () => {
    m(ProductionPlan.findById).mockReturnValue(chain(plan({ status: 'planned' })));
    await expect(planning.setPlanStatus(oid('plan1'), 'completed')).rejects.toMatchObject({ statusCode: 409 });
    expect(ProductionPlan.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('terminal plans cannot be edited or restarted', async () => {
    m(ProductionPlan.findById).mockReturnValue(chain(plan({ status: 'completed' })));
    await expect(planning.setPlanStatus(oid('plan1'), 'in_progress')).rejects.toMatchObject({ statusCode: 409 });
    await expect(planning.updatePlan(oid('plan1'), { productId: PROD, quantity: '10', startDate: inDays(1), endDate: inDays(2), notes: '' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('a legal transition is gated on the status that was read', async () => {
    m(ProductionPlan.findById).mockReturnValue(chain(plan({ status: 'planned' })));
    m(ProductionPlan.findOneAndUpdate).mockResolvedValue({});
    await planning.setPlanStatus(oid('plan1'), 'confirmed');
    expect(m(ProductionPlan.findOneAndUpdate).mock.calls[0][0]).toMatchObject({ status: 'planned' });
  });
});

describe('reservations', () => {
  it('cannot reserve more than the unreserved stock', async () => {
    m(Material.findById).mockReturnValue(chain(mat(MAT_B, 'BIL')));
    m(StockLevel.find).mockReturnValue(chain([{ quantity: D('100') }]));
    m(StockReservation.find).mockReturnValue(chain([{ quantity: D('70') }]));
    await expect(planning.createReservation(user, { materialId: MAT_B, quantity: '40', reason: 'Heat 11' })).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/Only 30 MT/) });
    expect(StockReservation.create).not.toHaveBeenCalled();
  });
  it('reserves within the unreserved stock', async () => {
    m(Material.findById).mockReturnValue(chain(mat(MAT_B, 'BIL')));
    m(StockLevel.find).mockReturnValue(chain([{ quantity: D('100') }]));
    m(StockReservation.find).mockReturnValue(chain([{ quantity: D('70') }]));
    m(StockReservation.create).mockResolvedValue({ toObject: () => ({ _id: oid('r1'), material: MAT_B, quantity: D('30'), reason: 'x', status: 'active' }) });
    const r = await planning.createReservation(user, { materialId: MAT_B, quantity: '30', reason: 'Heat 11' });
    expect(r.quantity).toBe('30.000');
  });
});

describe('reorder recommendations', () => {
  const setup = (consumed: string | null, onHand: string, extra: any = {}) => {
    m(Material.find).mockReturnValue(chain([mat(MAT_B, 'BIL', { safetyStock: 50, reorderPoint: 300, ...extra })]));
    m(StockLevel.find).mockReturnValue(chain([{ material: MAT_B, quantity: D(onHand) }]));
    m(StockReservation.find).mockReturnValue(chain([]));
    m(PurchaseOrder.find).mockReturnValue(chain([]));
    m(StockMovement.aggregate).mockResolvedValue(consumed === null ? [] : [{ _id: MAT_B, total: D(`-${consumed}`) }]);
  };
  it('derives the reorder point from real issue history', async () => {
    setup('900', '100'); // 10/day over 90 days, lead time 10 days
    const [r] = await mrp.reorderRecommendations(false);
    expect(r).toMatchObject({ averageDailyConsumption: '10', leadTimeDemand: '100', reorderPoint: '150', basis: 'consumption', reorderNow: true, suggestedQuantity: '350' });
  });
  it('queries only issue movements inside the lookback window', async () => {
    setup('900', '100');
    await mrp.reorderRecommendations(false);
    const [pipeline] = m(StockMovement.aggregate).mock.calls[0];
    expect(pipeline[0].$match).toMatchObject({ type: 'issue' });
    expect(pipeline[0].$match.createdAt.$gte).toBeInstanceOf(Date);
  });
  it('falls back to the configured level and says so without history', async () => {
    setup(null, '100');
    const [r] = await mrp.reorderRecommendations(false);
    expect(r.basis).toBe('configured');
    expect(r.suggestedQuantity).toBe('200');
  });
  it('can return only materials that need ordering', async () => {
    setup('900', '5000');
    expect(await mrp.reorderRecommendations(true)).toHaveLength(0);
    expect(await mrp.reorderRecommendations(false)).toHaveLength(1);
  });
  it('counts open purchase orders in the position', async () => {
    setup('900', '100');
    m(PurchaseOrder.find).mockReturnValue(chain([{ lines: [{ material: MAT_B, quantity: D('500'), acceptedQty: D('0') }] }]));
    const [r] = await mrp.reorderRecommendations(false);
    expect(r.onOrder).toBe('500');
    expect(r.reorderNow).toBe(false);
  });
});
