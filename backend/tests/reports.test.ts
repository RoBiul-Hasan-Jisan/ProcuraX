import request from 'supertest';
import { Types } from 'mongoose';
import { oid } from './helpers';
import { rowsFor } from './reportStubs';

jest.mock('../src/config/firebase', () => ({
  verifyIdToken: jest.fn(async (token: string) => {
    if (!token.startsWith('good-')) throw new Error('bad token');
    const uid = token.slice(5);
    return { uid, email: `${uid}@example.com`, name: uid, emailVerified: true };
  }),
}));
const profiles = new Map<string, any>();
jest.mock('../src/repositories/userRepository', () => {
  const { DEFAULT_ROLE_PERMISSIONS } = jest.requireActual('../src/utils/permissions');
  return { userRepository: {
    findByFirebaseUid: jest.fn(async (uid: string) => profiles.get(uid) ?? null),
    permissionsForRole: jest.fn(async (role: string | null) => (role ? DEFAULT_ROLE_PERMISSIONS[role] : [])),
    touchLogin: jest.fn(), create: jest.fn(), list: jest.fn(), update: jest.fn(), findById: jest.fn(),
  } };
});
jest.mock('../src/models/Role', () => ({ ensureDefaultRoles: jest.fn(), Role: {} }));

jest.mock('../src/models/PurchaseOrder', () => ({ PurchaseOrder: require('./reportStubs').stub('PurchaseOrder') }));
jest.mock('../src/models/PurchaseRequisition', () => ({ PurchaseRequisition: require('./reportStubs').stub('PurchaseRequisition') }));
jest.mock('../src/models/Department', () => ({ Department: require('./reportStubs').stub('Department') }));
jest.mock('../src/models/Supplier', () => ({ Supplier: require('./reportStubs').stub('Supplier') }));
jest.mock('../src/models/Material', () => ({ Material: require('./reportStubs').stub('Material') }));
jest.mock('../src/models/MaterialCategory', () => ({ MaterialCategory: require('./reportStubs').stub('MaterialCategory') }));
jest.mock('../src/models/Warehouse', () => ({ Warehouse: require('./reportStubs').stub('Warehouse') }));
jest.mock('../src/models/StockLevel', () => ({ StockLevel: require('./reportStubs').stub('StockLevel') }));
jest.mock('../src/models/StockMovement', () => ({ StockMovement: require('./reportStubs').stub('StockMovement') }));
jest.mock('../src/models/Invoice', () => ({ Invoice: require('./reportStubs').stub('Invoice') }));
jest.mock('../src/models/RFQ', () => ({ RFQ: require('./reportStubs').stub('RFQ') }));
jest.mock('../src/models/SupplierQuotation', () => ({ SupplierQuotation: require('./reportStubs').stub('SupplierQuotation') }));
jest.mock('../src/models/MRPRun', () => ({ MRPRun: require('./reportStubs').stub('MRPRun') }));
jest.mock('../src/models/MRPResult', () => ({ MRPResult: require('./reportStubs').stub('MRPResult') }));
jest.mock('../src/models/Forecast', () => ({ DemandForecast: require('./reportStubs').stub('DemandForecast') }));
jest.mock('../src/services/supplierScoringService', () => ({ supplierScoring: jest.fn() }));

import { createApp } from '../src/app';
import { runReport, availableReports } from '../src/services/reportService';
import { renderExport, exportFileName } from '../src/services/reportExport';
import { csvCell, safeText, sumStr, toCsv, REPORTS } from '../src/domain/reports';
import { supplierScoring } from '../src/services/supplierScoringService';
import { PurchaseOrder } from '../src/models/PurchaseOrder';
import { RFQ } from '../src/models/RFQ';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/utils/permissions';

const app = createApp();
const as = (uid: string) => ({ Authorization: `Bearer good-${uid}` });
const person = (uid: string, role: string) => profiles.set(uid, { id: oid(uid), firebaseUid: uid, email: `${uid}@example.com`, displayName: uid, role, status: 'active', departmentId: null, supplierId: role === 'supplier' ? oid('s') : null });
const user = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS): any => ({ id: oid('u'), displayName: 'U', role, permissions: DEFAULT_ROLE_PERMISSIONS[role] });
const D = (s: string) => Types.Decimal128.fromString(s);
const api = '/api/v1';

beforeEach(() => { profiles.clear(); for (const k of Object.keys(rowsFor)) delete rowsFor[k]; ['buyer:procurement_manager', 'dept:department_manager', 'vendor:supplier', 'fin:finance_officer', 'store:inventory_officer'].forEach((x) => person(x.split(':')[0]!, x.split(':')[1]!)); });

describe('report domain helpers', () => {
  it('neutralises spreadsheet formulas in text', () => {
    for (const s of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx']) expect(safeText(s).startsWith("'")).toBe(true);
    expect(safeText('Plain')).toBe('Plain');
    expect(csvCell('=HYPERLINK("x")', 'text')).toBe('"\'=HYPERLINK(""x"")"');
  });
  it('keeps negative amounts as numbers', () => {
    expect(csvCell('-12.50', 'money')).toBe('-12.50');
    expect(csvCell('=1+1', 'money')).toBe("'=1+1");
  });
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b', 'text')).toBe('"a,b"');
    expect(csvCell('a\nb', 'text')).toBe('"a\nb"');
  });
  it('adds decimals exactly (no float drift)', () => {
    expect(sumStr(['0.1', '0.2'])).toBe('0.30');
    expect(sumStr(['1000000.10', '0.20', null, ''])).toBe('1000000.30');
  });
  it('writes a BOM, header, rows and totals', () => {
    const csv = toCsv({ columns: [{ key: 'a', label: 'A', type: 'text' }, { key: 'b', label: 'B', type: 'money' }], rows: [{ a: 'x', b: '1.00' }], totals: { a: 'Total', b: '1.00' } });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n').filter(Boolean)).toEqual(['﻿A,B', 'x,1.00', 'Total,1.00']);
  });
  it('defines all twelve reports once, each with a filter list', () => {
    expect(REPORTS).toHaveLength(12);
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(12);
    REPORTS.forEach((r) => expect(r.filters.length).toBeGreaterThan(0));
  });
});

describe('report permissions', () => {
  it('hides financial reports from roles without reports:financial', () => {
    const keys = availableReports(user('department_manager')).map((r) => r.key);
    expect(keys).not.toContain('monthly-expenditure');
    expect(keys).toContain('warehouse-stock');
    expect(availableReports(user('procurement_manager'))).toHaveLength(12);
    expect(availableReports(user('supplier'))).toEqual([]);
  });
  it('blocks a financial report at the service even if the route is reached', async () => {
    await expect(runReport(user('department_manager'), 'inventory-valuation', {})).rejects.toMatchObject({ statusCode: 403 });
    await expect(runReport(user('inventory_officer'), 'purchase-orders', {})).rejects.toMatchObject({ statusCode: 403 });
  });
  it('rejects unknown reports', async () => {
    await expect(runReport(user('procurement_manager'), 'nope', {})).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('report content', () => {
  it('monthly expenditure sums exact decimals per month and excludes nothing it should keep', async () => {
    const po = (n: string, d: string, t: string) => ({ number: n, issuedAt: new Date(d), createdAt: new Date(d), requisition: oid('r'), materialCost: D(t), transportCost: D('0'), additionalCharges: D('0'), taxAmount: D('0'), totalAmount: D(t) });
    rowsFor.PurchaseOrder = [po('PO-1', '2026-09-03', '0.10'), po('PO-2', '2026-09-20', '0.20'), po('PO-3', '2026-10-01', '5.00')];
    const r = await runReport(user('finance_officer'), 'monthly-expenditure', {});
    expect(r.rows.map((x) => [x.month, x.orders, x.total])).toEqual([['2026-09', 2, '0.30'], ['2026-10', 1, '5.00']]);
    expect(r.totals!.total).toBe('5.30');
    const q = (PurchaseOrder.find as jest.Mock).mock.calls.at(-1)[0];
    expect(q.status.$in).not.toContain('draft');
    expect(q.status.$in).not.toContain('cancelled');
  });
  it('applies the date range including the whole end day', async () => {
    await runReport(user('finance_officer'), 'purchase-orders', { from: '2026-09-01', to: '2026-09-30' });
    const q = (PurchaseOrder.find as jest.Mock).mock.calls.at(-1)[0];
    expect(q.issuedAt.$gte.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(q.issuedAt.$lte.toISOString()).toBe('2026-09-30T23:59:59.999Z');
  });
  it('ignores filters a report does not support', async () => {
    const r = await runReport(user('finance_officer'), 'monthly-expenditure', { warehouseId: oid('w') });
    expect(r.filters).toEqual({});
  });
  it('quotation comparison only queries opened RFQs (sealed bids stay sealed)', async () => {
    await runReport(user('finance_officer'), 'quotation-comparison', {});
    const q = (RFQ.find as jest.Mock).mock.calls.at(-1)[0];
    expect(q.$or).toEqual([{ status: { $ne: 'open' } }, { deadline: { $lte: expect.any(Date) } }]);
  });
  it('quotation ranking is by landed cost and skips withdrawn bids', async () => {
    rowsFor.RFQ = [{ _id: oid('r1'), number: 'RFQ-1', deadline: new Date('2026-01-01'), award: {} }];
    const x = (id: string, cost: string, status = 'submitted') => ({ _id: oid(id), rfq: oid('r1'), supplier: oid('s' + id), totalLandedCost: D(cost), deliveryDays: 5, paymentTerms: 'Net 30', status });
    rowsFor.SupplierQuotation = [x('a', '200'), x('b', '100', 'withdrawn'), x('c', '150')];
    const r = await runReport(user('finance_officer'), 'quotation-comparison', {});
    expect(r.rows.map((z) => [z.landed, z.rank])).toEqual([['100.00', null], ['150.00', 1], ['200.00', 2]]);
    expect(r.notes.join(' ')).toMatch(/not a recommendation/);
  });
  it('supplier performance never rates an unproven supplier', async () => {
    (supplierScoring as jest.Mock).mockResolvedValue({ minHistoryOrders: 5, weights: {}, rows: [
      { supplierId: '1', code: 'A', name: 'New Co', completedOrders: 2, onTimePercent: 100, qualityPercent: 100, proven: false, historyScore: null },
      { supplierId: '2', code: 'B', name: 'Old Co', completedOrders: 9, onTimePercent: 90, qualityPercent: 80, proven: true, historyScore: 85 },
    ] });
    const r = await runReport(user('department_manager'), 'supplier-performance', {});
    expect(r.rows[0]).toMatchObject({ supplier: 'New Co', score: null, rating: 'Unproven' });
    expect(r.rows[1]).toMatchObject({ score: '85.0', rating: 'Proven' });
  });
  it('delayed deliveries lists late open and late delivered orders only', async () => {
    const day = 86_400_000;
    const po = (n: string, status: string, exp: number, last?: number) => ({ number: n, supplier: oid('s'), status, expectedDeliveryDate: new Date(Date.now() + exp * day), lastReceiptAt: last === undefined ? undefined : new Date(Date.now() + last * day) });
    rowsFor.PurchaseOrder = [po('OPEN-LATE', 'issued', -10), po('OPEN-OK', 'issued', 5), po('DONE-LATE', 'received', -20, -15), po('DONE-OK', 'received', -20, -25)];
    const r = await runReport(user('inventory_officer'), 'delayed-deliveries', {});
    expect(r.rows.map((x) => [x.number, x.daysLate, x.state])).toEqual([['OPEN-LATE', 10, 'Still open'], ['DONE-LATE', 5, 'Delivered late']]);
  });
  it('inventory valuation multiplies exactly and flags unpriced stock', async () => {
    rowsFor.StockLevel = [{ material: oid('m1'), warehouse: oid('w'), quantity: D('3.333') }, { material: oid('m2'), warehouse: oid('w'), quantity: D('1') }];
    rowsFor.Material = [{ _id: oid('m1'), sku: 'A', name: 'A', unit: 't', averagePurchasePrice: D('10.10') }, { _id: oid('m2'), sku: 'B', name: 'B', unit: 't', averagePurchasePrice: null }];
    rowsFor.Warehouse = [{ _id: oid('w'), name: 'Main' }];
    const r = await runReport(user('finance_officer'), 'inventory-valuation', {});
    expect(r.rows[0]!.value).toBe('33.66');
    expect(r.rows[1]!.value).toBeNull();
    expect(r.totals!.value).toBe('33.66');
    expect(r.notes.join(' ')).toMatch(/1 row\(s\) have no average purchase price/);
  });
  it('MRP report says so when no run exists', async () => {
    const r = await runReport(user('procurement_manager'), 'mrp-planning', {});
    expect(r.rows).toEqual([]);
    expect(r.notes[0]).toMatch(/No MRP run/);
  });
  it('forecast performance compares only fully elapsed weeks', async () => {
    const day = 86_400_000;
    const ws = (off: number) => new Date(Date.now() + off * day).toISOString().slice(0, 10);
    rowsFor.DemandForecast = [{ material: oid('m'), sku: 'S', materialName: 'Scrap', selectedModel: 'ses', asOf: new Date(Date.now() - 20 * day), result: { weekly: [{ weekStart: ws(-14), point: 100 }, { weekStart: ws(-7), point: 100 }, { weekStart: ws(0), point: 100 }] } }];
    rowsFor.StockMovement = [{ material: oid('m'), type: 'issue', delta: D('-90'), createdAt: new Date(Date.now() - 10 * day) }, { material: oid('m'), type: 'issue', delta: D('-30'), createdAt: new Date(Date.now() - 2 * day) }];
    const r = await runReport(user('procurement_manager'), 'forecast-performance', {});
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ weeks: 2, forecast: '200.000', actual: '120.000', error: '80.000', errorPct: '66.7' });
    expect(r.totals!.errorPct).toBe('66.7');
  });
  it('forecast performance says there is nothing to compare when no week has elapsed', async () => {
    const r = await runReport(user('procurement_manager'), 'forecast-performance', {});
    expect(r.rows).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/nothing to compare/);
  });
});

describe('exports', () => {
  const sample: any = { key: 'purchase-orders', title: 'PO', generatedAt: '2026-11-25T00:00:00Z', filters: { from: '2026-01-01' }, truncated: false,
    columns: [{ key: 'a', label: 'Name', type: 'text' }, { key: 'b', label: 'Total', type: 'money' }],
    rows: [{ a: '=cmd|calc', b: '1234.50' }, { a: 'Ünïcode, "quoted"', b: '-5.00' }], totals: { a: 'Total', b: '1229.50' }, notes: ['A note'] };
  it('builds a real PDF', async () => { expect((await renderExport(sample, 'pdf')).subarray(0, 5).toString()).toBe('%PDF-'); });
  it('builds a real xlsx (zip) whose text is not a formula and whose amounts are numbers', async () => {
    const buf = await renderExport(sample, 'xlsx');
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0]!;
    const cell = (a: string) => ws.getCell(a).value;
    const rowNo = (() => { let n = 0; ws.eachRow((row, i) => { if (row.getCell(1).value === 'Name') n = i; }); return n; })();
    expect(cell(`A${rowNo + 1}`)).toBe("'=cmd|calc");
    expect(cell(`B${rowNo + 1}`)).toBe(1234.5);
    expect(cell(`B${rowNo + 3}`)).toBe(1229.5);
  });
  it('csv export neutralises formulas', async () => { expect((await renderExport(sample, 'csv')).toString()).toContain("'=cmd|calc"); });
  it('file names carry the report key and date only', () => { expect(exportFileName('purchase-orders', 'pdf', new Date('2026-11-25'))).toBe('purchase-orders-2026-11-25.pdf'); });
});

describe('report routes', () => {
  it('needs authentication', async () => { expect((await request(app).get(`${api}/reports`)).status).toBe(401); });
  it('forbids suppliers', async () => { expect((await request(app).get(`${api}/reports`).set(as('vendor'))).status).toBe(403); });
  it('lists only reports the caller may open', async () => {
    const res = await request(app).get(`${api}/reports`).set(as('dept'));
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: any) => r.key)).not.toContain('purchase-orders');
  });
  it('403s a financial report for a department manager, also for export', async () => {
    expect((await request(app).get(`${api}/reports/purchase-orders`).set(as('dept'))).status).toBe(403);
    expect((await request(app).get(`${api}/reports/purchase-orders/export?format=csv`).set(as('dept'))).status).toBe(403);
  });
  it('validates filters', async () => {
    expect((await request(app).get(`${api}/reports/purchase-orders?from=2026-13-40`).set(as('buyer'))).status).toBe(400);
    expect((await request(app).get(`${api}/reports/purchase-orders?from=2026-10-01&to=2026-09-01`).set(as('buyer'))).status).toBe(400);
    expect((await request(app).get(`${api}/reports/purchase-orders?supplierId=abc`).set(as('buyer'))).status).toBe(400);
    expect((await request(app).get(`${api}/reports/purchase-orders/export?format=exe`).set(as('buyer'))).status).toBe(400);
  });
  it('runs a report and exports it with safe headers', async () => {
    expect((await request(app).get(`${api}/reports/purchase-orders`).set(as('buyer'))).status).toBe(200);
    const res = await request(app).get(`${api}/reports/purchase-orders/export?format=csv`).set(as('buyer'));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="purchase-orders-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  it('404s an unknown report', async () => { expect((await request(app).get(`${api}/reports/nonexistent`).set(as('buyer'))).status).toBe(404); });
});
