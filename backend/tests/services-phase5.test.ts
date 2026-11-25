import { chain, D, oid } from './helpers';

const mm = (...m: string[]) => require('./helpers').mockModel(...m);
jest.mock('../src/models/Material', () => ({ Material: require('./helpers').mockModel('find', 'findById') }));
jest.mock('../src/models/StockMovement', () => ({ StockMovement: require('./helpers').mockModel('find') }));
jest.mock('../src/models/PurchaseOrder', () => ({ PurchaseOrder: require('./helpers').mockModel('find') }));
jest.mock('../src/models/PriceObservation', () => ({ PriceObservation: require('./helpers').mockModel('find') }));
jest.mock('../src/models/SupplierQuotation', () => ({ SupplierQuotation: require('./helpers').mockModel('find') }));
jest.mock('../src/models/PurchaseRequisition', () => ({ PurchaseRequisition: require('./helpers').mockModel('find') }));
jest.mock('../src/models/Invoice', () => ({ Invoice: require('./helpers').mockModel('find') }));
jest.mock('../src/models/GoodsReceipt', () => ({ GoodsReceipt: require('./helpers').mockModel('find') }));
jest.mock('../src/models/Supplier', () => ({ Supplier: require('./helpers').mockModel('find') }));
jest.mock('../src/models/RiskAlert', () => ({ RiskAlert: require('./helpers').mockModel('find', 'findById', 'findOneAndUpdate', 'exists', 'create', 'countDocuments', 'aggregate') }));
jest.mock('../src/models/User', () => ({ User: require('./helpers').mockModel('findById') }));
jest.mock('../src/models/Role', () => ({ Role: require('./helpers').mockModel('findOne') }));
jest.mock('../src/models/RFQ', () => ({ RFQ: require('./helpers').mockModel('find') }));
jest.mock('../src/models/MRPRun', () => ({ MRPRun: require('./helpers').mockModel('findOne') }));
jest.mock('../src/models/MRPResult', () => ({ MRPResult: require('./helpers').mockModel('find') }));
jest.mock('../src/models/Forecast', () => ({ DemandForecast: require('./helpers').mockModel('create', 'findOne', 'aggregate', 'find', 'countDocuments'), PriceForecast: require('./helpers').mockModel('create', 'findOne', 'find', 'countDocuments') }));
jest.mock('../src/models/AssistantMessage', () => ({ AssistantMessage: require('./helpers').mockModel('create', 'find') }));
jest.mock('../src/models/Counter', () => ({ nextNumber: jest.fn(async (p: string) => `${p}-2026-0001`) }));
jest.mock('../src/services/mlClient', () => {
  class MlUnavailableError extends Error { statusCode = 503; }
  return { MlUnavailableError, requestDemandForecast: jest.fn(), requestPriceForecast: jest.fn() };
});
jest.mock('../src/services/inventoryService', () => ({ reorderAlerts: jest.fn() }));
jest.mock('../src/services/comparisonService', () => ({ getComparison: jest.fn(), getScoringWeights: jest.fn(async () => ({})) }));

import { StockMovement } from '../src/models/StockMovement';
import { Material } from '../src/models/Material';
import { PurchaseOrder } from '../src/models/PurchaseOrder';
import { PriceObservation } from '../src/models/PriceObservation';
import { Supplier } from '../src/models/Supplier';
import { SupplierQuotation } from '../src/models/SupplierQuotation';
import { PurchaseRequisition } from '../src/models/PurchaseRequisition';
import { Invoice } from '../src/models/Invoice';
import { GoodsReceipt } from '../src/models/GoodsReceipt';
import { RiskAlert } from '../src/models/RiskAlert';
import { User } from '../src/models/User';
import { Role } from '../src/models/Role';
import { DemandForecast, PriceForecast } from '../src/models/Forecast';
import { AssistantMessage } from '../src/models/AssistantMessage';
import { MRPRun } from '../src/models/MRPRun';
import { nextNumber } from '../src/models/Counter';
import * as ml from '../src/services/mlClient';
import { reorderAlerts } from '../src/services/inventoryService';
import * as forecasting from '../src/services/forecastingService';
import * as risk from '../src/services/riskService';
import * as assistant from '../src/services/assistantService';
import { supplierScoring } from '../src/services/supplierScoringService';

const m = (x: unknown) => x as jest.Mock;
void mm;
const user: any = { id: oid('u1'), displayName: 'Buyer', email: 'b@x.com', role: 'procurement_manager', permissions: ['intelligence:view', 'reports:financial'] };
const MAT = oid('mat1');
const material = { _id: MAT, sku: 'SCR-HMS', name: '[DEMO] HMS Scrap', unit: 'MT' };
const NOW = new Date('2026-11-25T06:00:00Z');

beforeEach(() => { jest.resetAllMocks(); m(nextNumber).mockImplementation(async (p: string) => `${p}-2026-0001`); m(Material.find).mockReturnValue(chain([material])); m(Material.findById).mockReturnValue(chain(material)); });

describe('forecasting service', () => {
  const issues = [{ delta: D('-10'), createdAt: new Date('2026-11-20T08:00:00Z') }, { delta: D('-5'), createdAt: new Date('2026-11-20T15:00:00Z') }, { delta: D('-7'), createdAt: new Date('2026-11-13T08:00:00Z') }];
  it('sends actual daily consumption (issues only, summed per day, positive) and stores the result marked as a forecast', async () => {
    m(StockMovement.find).mockReturnValue(chain(issues));
    m(ml.requestDemandForecast).mockResolvedValue({ status: 'ok', modelVersion: 'v1', isForecast: true, selectedModel: 'moving_average', horizons: [] });
    m(DemandForecast.create).mockImplementation(async (d: any) => ({ _id: oid('f1'), ...d }));
    const out = await forecasting.runDemandForecast(user, MAT, NOW);
    expect(m(StockMovement.find).mock.calls[0][0]).toMatchObject({ material: MAT, type: 'issue' });
    expect(m(ml.requestDemandForecast).mock.calls[0][0]).toEqual([{ date: '2026-11-13', value: 7 }, { date: '2026-11-20', value: 15 }]);
    expect(m(ml.requestDemandForecast).mock.calls[0][1]).toBe('2026-11-25');
    expect(m(DemandForecast.create).mock.calls[0][0]).toMatchObject({ status: 'ok', selectedModel: 'moving_average', modelVersion: 'v1', generatedBy: user.id });
    expect(out.isForecast).toBe(true);
  });
  it('stores an insufficient-data answer with its reason instead of inventing numbers', async () => {
    m(StockMovement.find).mockReturnValue(chain([]));
    m(ml.requestDemandForecast).mockResolvedValue({ status: 'insufficient_data', modelVersion: 'v1', isForecast: true, reason: 'Need at least 8 weeks of history; found 0.' });
    m(DemandForecast.create).mockImplementation(async (d: any) => ({ _id: oid('f1'), ...d }));
    const out = await forecasting.runDemandForecast(user, MAT, NOW);
    expect(out.status).toBe('insufficient_data'); expect(out.reason).toContain('8 weeks');
  });
  it('saves nothing when the ML service is down, and the error says so', async () => {
    m(StockMovement.find).mockReturnValue(chain(issues));
    m(ml.requestDemandForecast).mockRejectedValue(new (ml as any).MlUnavailableError('down'));
    await expect(forecasting.runDemandForecast(user, MAT, NOW)).rejects.toThrow();
    expect(DemandForecast.create).not.toHaveBeenCalled();
  });
  it('unknown materials are 404 and never reach the ML service', async () => {
    m(Material.findById).mockReturnValue(chain(null));
    await expect(forecasting.runDemandForecast(user, MAT, NOW)).rejects.toMatchObject({ statusCode: 404 });
    expect(ml.requestDemandForecast).not.toHaveBeenCalled();
  });
  it('price forecast uses recorded observations plus issued purchase orders, oldest first', async () => {
    m(PriceObservation.find).mockReturnValue(chain([{ observedAt: new Date('2026-01-01'), unitPrice: D('100'), source: 'demo' }]));
    m(PurchaseOrder.find).mockReturnValue(chain([{ number: 'PO-1', issuedAt: new Date('2026-03-01'), lines: [{ material: MAT, unitPrice: D('110') }, { material: oid('other'), unitPrice: D('9') }] }]));
    m(ml.requestPriceForecast).mockResolvedValue({ status: 'insufficient_data', modelVersion: 'v1', isForecast: true, reason: 'few' });
    m(PriceForecast.create).mockImplementation(async (d: any) => ({ _id: oid('f2'), ...d }));
    await forecasting.runPriceForecast(user, MAT, NOW);
    expect(m(ml.requestPriceForecast).mock.calls[0][0]).toEqual([{ date: '2026-01-01', value: 100 }, { date: '2026-03-01', value: 110 }]);
  });
  it('the view keeps actuals and forecasts in separate, labelled parts', async () => {
    m(StockMovement.find).mockReturnValue(chain(issues));
    m(PriceObservation.find).mockReturnValue(chain([])); m(PurchaseOrder.find).mockReturnValue(chain([]));
    m(DemandForecast.findOne).mockReturnValue(chain(null)); m(PriceForecast.findOne).mockReturnValue(chain(null));
    const v: any = await forecasting.materialForecastView(MAT, NOW);
    expect(v.actualConsumption.kind).toBe('actual'); expect(v.priceHistory.kind).toBe('actual');
    expect(v.demandForecast).toBeNull(); expect(v.priceForecast).toBeNull();
  });
});

describe('risk review workflow', () => {
  const alert = (status = 'open') => ({ _id: oid('al1'), status });
  it('a closing decision needs a written note', async () => {
    m(RiskAlert.findById).mockReturnValue(chain(alert('investigating')));
    await expect(risk.reviewAlert(user, oid('al1'), { status: 'resolved', note: '' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(risk.reviewAlert(user, oid('al1'), { status: 'dismissed', note: 'ok' })).rejects.toMatchObject({ statusCode: 400 });
    expect(RiskAlert.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('refuses transitions that skip the workflow or leave a closed state', async () => {
    m(RiskAlert.findById).mockReturnValue(chain(alert('open')));
    await expect(risk.reviewAlert(user, oid('al1'), { status: 'resolved', note: 'Looked into it, fine.' })).rejects.toMatchObject({ statusCode: 400 });
    m(RiskAlert.findById).mockReturnValue(chain(alert('resolved')));
    await expect(risk.reviewAlert(user, oid('al1'), { status: 'investigating', note: 'reopen' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('gates the update on the status that was read, and reports a conflict if someone else moved it first', async () => {
    m(RiskAlert.findById).mockReturnValue(chain(alert('open')));
    m(RiskAlert.findOneAndUpdate).mockReturnValue(chain(null));
    await expect(risk.reviewAlert(user, oid('al1'), { status: 'acknowledged' })).rejects.toMatchObject({ statusCode: 409 });
    expect(m(RiskAlert.findOneAndUpdate).mock.calls[0][0]).toMatchObject({ status: 'open' });
  });
  it('records who moved the alert, from which state, with the note', async () => {
    m(RiskAlert.findById).mockReturnValue(chain(alert('investigating')));
    m(RiskAlert.findOneAndUpdate).mockReturnValue(chain({ ok: true }));
    await risk.reviewAlert(user, oid('al1'), { status: 'resolved', note: 'Confirmed with the supplier.' });
    const upd = m(RiskAlert.findOneAndUpdate).mock.calls[0][1];
    expect(upd.$set).toMatchObject({ status: 'resolved', resolutionNote: 'Confirmed with the supplier.' });
    expect(upd.$push.history).toMatchObject({ by: 'Buyer', from: 'investigating', to: 'resolved' });
  });
  it('only active users who may review risks can be assigned', async () => {
    m(RiskAlert.findById).mockReturnValue(chain(alert('open')));
    m(User.findById).mockReturnValue(chain({ _id: oid('u2'), status: 'suspended', role: 'procurement_manager', displayName: 'X' }));
    await expect(risk.reviewAlert(user, oid('al1'), { assignedTo: oid('u2') })).rejects.toMatchObject({ statusCode: 400 });
    m(User.findById).mockReturnValue(chain({ _id: oid('u2'), status: 'active', role: 'finance_officer', displayName: 'Fin' }));
    m(Role.findOne).mockReturnValue(chain({ permissions: ['reports:view'] }));
    await expect(risk.reviewAlert(user, oid('al1'), { assignedTo: oid('u2') })).rejects.toThrow(/permission/);
    m(User.findById).mockReturnValue(chain({ _id: oid('u2'), status: 'active', role: 'procurement_manager', displayName: 'Pro' }));
    m(Role.findOne).mockReturnValue(chain({ permissions: ['risks:review'] }));
    m(RiskAlert.findOneAndUpdate).mockReturnValue(chain({ ok: true }));
    await risk.reviewAlert(user, oid('al1'), { assignedTo: oid('u2') });
    expect(m(RiskAlert.findOneAndUpdate).mock.calls[0][1].$set).toMatchObject({ assignedToName: 'Pro' });
  });
  it('an empty review is rejected', async () => {
    m(RiskAlert.findById).mockReturnValue(chain(alert('open')));
    await expect(risk.reviewAlert(user, oid('al1'), {})).rejects.toMatchObject({ statusCode: 400 });
  });
  it('unknown alerts are 404', async () => {
    m(RiskAlert.findById).mockReturnValue(chain(null));
    await expect(risk.reviewAlert(user, oid('al1'), { status: 'acknowledged' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('risk scan', () => {
  const overduePo = { _id: oid('po1'), number: 'PO-1', status: 'issued', expectedDeliveryDate: new Date('2026-11-01'), supplier: { _id: oid('s1'), companyName: 'Alpha' } };
  beforeEach(() => {
    for (const M of [StockMovement, PriceObservation, SupplierQuotation, PurchaseRequisition, Invoice, GoodsReceipt, Supplier]) m((M as any).find).mockReturnValue(chain([]));
    m(PurchaseOrder.find).mockReturnValue(chain([overduePo]));
    m(RiskAlert.create).mockResolvedValue({});
  });
  it('raises a new alert for an overdue PO, with evidence and a not-accusatory step', async () => {
    m(RiskAlert.exists).mockResolvedValue(null);
    const r = await risk.scan(NOW);
    expect(r).toEqual({ detected: 1, created: 1, alreadyKnown: 0 });
    const doc = m(RiskAlert.create).mock.calls[0][0];
    expect(doc).toMatchObject({ category: 'delayed_po', status: 'open', number: 'RSK-2026-0001' });
    expect(doc.evidence.daysLate).toBe(24); expect(doc.history[0].to).toBe('open');
  });
  it('a second scan raises nothing for a condition that already has an alert (including handled ones)', async () => {
    m(RiskAlert.exists).mockResolvedValue({ _id: 'x' });
    const r = await risk.scan(NOW);
    expect(r).toEqual({ detected: 1, created: 0, alreadyKnown: 1 });
    expect(RiskAlert.create).not.toHaveBeenCalled();
  });
  it('a concurrent scan losing the unique-key race is not an error', async () => {
    m(RiskAlert.exists).mockResolvedValue(null);
    m(RiskAlert.create).mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    await expect(risk.scan(NOW)).resolves.toMatchObject({ created: 0 });
  });
});

describe('assistant', () => {
  beforeEach(() => { m(AssistantMessage.create).mockResolvedValue({}); });
  it('an unrelated question is answered as unavailable, never guessed, and still logged', async () => {
    const a = await assistant.ask(user, 'What is the weather in Dhaka?', NOW);
    expect(a.intent).toBe('unknown'); expect(a.available).toBe(false); expect(a.kind).toBe('unavailable'); expect(a.table).toBeNull();
    expect(AssistantMessage.create).toHaveBeenCalledTimes(1);
  });
  it('reorder answer is built from the stock overview, with the rule explained', async () => {
    m(reorderAlerts).mockResolvedValue([{ materialId: MAT, sku: 'SCR-HMS', name: '[DEMO] HMS Scrap', status: 'critical', total: '10.000', reorderPoint: '500', shortfallToReorderPoint: '490.000' }]);
    const a = await assistant.ask(user, 'Which materials are below their reorder points?', NOW);
    expect(a.kind).toBe('actual'); expect(a.table!.rows[0]).toMatchObject({ sku: 'SCR-HMS', name: 'HMS Scrap', shortfall: '490.000' });
    expect(a.references[0]).toMatchObject({ type: 'Material', id: MAT }); expect(a.calculation.join(' ')).toContain('safety stock');
  });
  it('spend is refused without the financial permission and sums exact decimals with it', async () => {
    const noFin = { ...user, permissions: ['intelligence:view'] };
    const denied = await assistant.ask(noFin, 'How much did we spend on procurement this month?', NOW);
    expect(denied.available).toBe(false); expect(PurchaseOrder.find).not.toHaveBeenCalled();
    m(PurchaseOrder.find).mockReturnValue(chain([
      { _id: oid('p1'), number: 'PO-1', totalAmount: D('100000.10'), issuedAt: new Date('2026-11-03') },
      { _id: oid('p2'), number: 'PO-2', totalAmount: D('200000.20'), issuedAt: new Date('2026-11-10') },
      { _id: oid('p3'), number: 'PO-3', totalAmount: D('999999'), issuedAt: new Date('2026-10-30') }, // last month
    ]));
    const ok = await assistant.ask(user, 'How much did we spend on procurement this month?', NOW);
    expect(ok.summary).toContain('300000.30'); expect(ok.table!.rows).toHaveLength(2);
    expect(ok.caveats.join(' ')).toContain('not cash paid');
  });
  it('next-month demand says plainly when no forecast exists, and labels forecasts when they do', async () => {
    m(DemandForecast.aggregate).mockResolvedValue([]);
    const none = await assistant.ask(user, 'What materials will be required next month?', NOW);
    expect(none.available).toBe(false); expect(none.summary).toMatch(/no demand forecast/i);
    m(DemandForecast.aggregate).mockResolvedValue([{ _id: MAT, doc: { material: MAT, sku: 'SCR-HMS', materialName: '[DEMO] HMS Scrap', unit: 'MT', asOf: NOW, selectedModel: 'moving_average', result: { horizons: [{ days: 30, total: 120.5, low: 100, high: 140 }] } } }]);
    const some = await assistant.ask(user, 'What materials will be required next month?', NOW);
    expect(some.kind).toBe('forecast'); expect(some.caveats.join(' ')).toContain('FORECAST'); expect(some.table!.rows[0].forecast).toBe('120.5 MT');
  });
  it('delivery reliability ranks only proven suppliers and names the unproven ones it left out', async () => {
    m(Supplier.find).mockReturnValue(chain([
      { _id: oid('s1'), supplierCode: 'SUP-1', companyName: 'Alpha', history: { completedOrders: 20, onTimeDeliveries: 19 } },
      { _id: oid('s2'), supplierCode: 'SUP-2', companyName: 'Beta', history: { completedOrders: 10, onTimeDeliveries: 6 } },
      { _id: oid('s3'), supplierCode: 'SUP-3', companyName: 'Newco', history: { completedOrders: 2, onTimeDeliveries: 2 } },
    ]));
    const a = await assistant.ask(user, 'Which supplier has the best delivery reliability?', NOW);
    expect(a.summary).toContain('Alpha'); expect(a.summary).toContain('95.0%');
    expect(a.table!.rows.map((r) => r.supplier)).toEqual(['Alpha', 'Beta']);
    expect(a.caveats.join(' ')).toContain('Newco');
  });
  it('delivery reliability is unavailable when nobody is proven', async () => {
    m(Supplier.find).mockReturnValue(chain([{ _id: oid('s3'), supplierCode: 'SUP-3', companyName: 'Newco', history: { completedOrders: 2, onTimeDeliveries: 2 } }]));
    expect((await assistant.ask(user, 'Which supplier has the best delivery reliability?', NOW)).available).toBe(false);
  });
  it('a price question without a material asks which one; with too little data it says so; with data it refuses to invent a cause', async () => {
    expect((await assistant.ask(user, 'Why has the price increased?', NOW)).summary).toMatch(/name the material/i);
    m(PriceObservation.find).mockReturnValue(chain([{ observedAt: new Date('2026-01-01'), unitPrice: D('100'), source: 'demo' }])); m(PurchaseOrder.find).mockReturnValue(chain([]));
    expect((await assistant.ask(user, 'Why has the price of HMS Scrap increased?', NOW)).available).toBe(false);
    m(PriceObservation.find).mockReturnValue(chain([{ observedAt: new Date('2026-01-01'), unitPrice: D('100'), source: 'demo' }, { observedAt: new Date('2026-06-01'), unitPrice: D('130'), source: 'demo' }]));
    const a = await assistant.ask(user, 'Why has the price of HMS Scrap increased?', NOW);
    expect(a.summary).toContain('30.0%'); expect(a.summary).toContain('does not record why'); expect(a.kind).toBe('actual');
  });
  it('urgent materials fall back to stock levels when no MRP run exists and says so', async () => {
    m(MRPRun.findOne).mockReturnValue(chain(null));
    m(reorderAlerts).mockResolvedValue([{ materialId: MAT, sku: 'SCR-HMS', name: 'HMS Scrap', status: 'critical', total: '1' }]);
    const a = await assistant.ask(user, 'Which materials require urgent procurement?', NOW);
    expect(a.table!.rows[0].source).toBe('Stock level'); expect(a.caveats.join(' ')).toContain('No MRP run');
  });
});

describe('supplier scoring', () => {
  it('rates only proven suppliers; unproven ones get a note and no score', async () => {
    m(Supplier.find).mockReturnValue(chain([
      { _id: oid('s1'), supplierCode: 'SUP-1', companyName: 'Alpha', status: 'active', verificationStatus: 'verified', history: { completedOrders: 20, onTimeDeliveries: 18, unitsReceived: 1000, unitsAccepted: 980 } },
      { _id: oid('s2'), supplierCode: 'SUP-2', companyName: 'Newco', status: 'active', verificationStatus: 'verified', history: { completedOrders: 2, onTimeDeliveries: 2, unitsReceived: 100, unitsAccepted: 100 } },
    ]));
    const r = await supplierScoring();
    const alpha = r.rows.find((x) => x.code === 'SUP-1')!, newco = r.rows.find((x) => x.code === 'SUP-2')!;
    expect(alpha).toMatchObject({ proven: true, onTimePercent: 90, qualityPercent: 98, historyScore: 94 });
    expect(newco.proven).toBe(false); expect(newco.historyScore).toBeNull(); expect(newco.note).toContain('at least 5');
    expect(r.rows[0].code).toBe('SUP-1');
  });
});
