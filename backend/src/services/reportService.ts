import { Types } from 'mongoose';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { Department } from '../models/Department';
import { Supplier } from '../models/Supplier';
import { Material } from '../models/Material';
import { MaterialCategory } from '../models/MaterialCategory';
import { Warehouse } from '../models/Warehouse';
import { StockLevel } from '../models/StockLevel';
import { StockMovement } from '../models/StockMovement';
import { Invoice } from '../models/Invoice';
import { RFQ } from '../models/RFQ';
import { SupplierQuotation } from '../models/SupplierQuotation';
import { MRPRun } from '../models/MRPRun';
import { MRPResult } from '../models/MRPResult';
import { DemandForecast } from '../models/Forecast';
import { Decimal, dec, str } from '../domain/money';
import { MAX_ROWS, REPORTS, isoDate, monthKey, reportDef, sumStr, type Column, type FilterKey, type ReportResult, type Row } from '../domain/reports';
import { forbidden, notFound } from '../utils/apiResponse';
import { supplierScoring } from './supplierScoringService';
import type { UserContext } from '../types/express';

export type Filters = Partial<Record<FilterKey, string>>;
type Built = Pick<ReportResult, 'columns' | 'rows' | 'totals' | 'notes'>;
const LIVE_PO = ['issued', 'partially_received', 'received', 'closed'];
const oids = (ids: string[]) => ids.map((i) => new Types.ObjectId(i));
const DAY = 86_400_000;

function dateRange(f: Filters) {
  const r: Record<string, Date> = {};
  if (f.from) r.$gte = new Date(`${f.from}T00:00:00.000Z`);
  if (f.to) r.$lte = new Date(`${f.to}T23:59:59.999Z`); // the end day is included
  return Object.keys(r).length ? r : null;
}
/** Material ids matching the material and/or category filters; null = no restriction. */
async function materialIds(f: Filters): Promise<string[] | null> {
  if (!f.materialId && !f.categoryId) return null;
  const q: any = {};
  if (f.materialId) q._id = f.materialId;
  if (f.categoryId) q.category = f.categoryId;
  return (await Material.find(q).select('_id').lean()).map((m: any) => String(m._id));
}
const nameMap = async (model: any, ids: unknown[], field: string) => {
  const rows: any[] = await model.find({ _id: { $in: [...new Set(ids.map(String))] } }).select(field).lean();
  return new Map(rows.map((r) => [String(r._id), r[field] as string]));
};
const mapOf = <T>(rows: T[], key: (r: T) => string) => new Map(rows.map((r) => [key(r), r]));
const money = (c: string, l: string): Column => ({ key: c, label: l, type: 'money' });

/** Purchase orders after the common filters; department comes from the originating requisition. */
async function filteredPOs(f: Filters) {
  const q: any = { status: { $in: LIVE_PO } };
  if (f.poStatus) q.status = f.poStatus;
  if (f.supplierId) q.supplier = f.supplierId;
  const range = dateRange(f);
  if (range) q.issuedAt = range;
  const pos: any[] = await PurchaseOrder.find(q).sort({ issuedAt: 1 }).limit(MAX_ROWS + 1).lean();
  const reqs = await PurchaseRequisition.find({ _id: { $in: pos.map((p) => p.requisition) } }).select('department').lean() as any[];
  const deptOf = new Map(reqs.map((r) => [String(r._id), String(r.department)]));
  const out = pos.map((p) => ({ ...p, department: deptOf.get(String(p.requisition)) ?? '' }));
  return f.departmentId ? out.filter((p) => p.department === f.departmentId) : out;
}

const builders: Record<string, (f: Filters) => Promise<Built>> = {
  async 'monthly-expenditure'(f) {
    const by = new Map<string, any[]>();
    for (const p of await filteredPOs(f)) { const k = monthKey(p.issuedAt ?? p.createdAt); by.set(k, [...(by.get(k) ?? []), p]); }
    const rows: Row[] = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, ps]) => ({
      month, orders: ps.length, materialCost: sumStr(ps.map((p) => p.materialCost?.toString())), transport: sumStr(ps.map((p) => p.transportCost?.toString())),
      charges: sumStr(ps.map((p) => p.additionalCharges?.toString())), tax: sumStr(ps.map((p) => p.taxAmount?.toString())), total: sumStr(ps.map((p) => p.totalAmount?.toString())),
    }));
    return {
      columns: [{ key: 'month', label: 'Month', type: 'text' }, { key: 'orders', label: 'Orders', type: 'int' }, money('materialCost', 'Material cost'), money('transport', 'Transport'), money('charges', 'Other charges'), money('tax', 'Tax'), money('total', 'Total committed')],
      rows, totals: { month: 'Total', orders: rows.reduce((a, r) => a + (r.orders as number), 0), materialCost: sumStr(rows.map((r) => r.materialCost as string)), transport: sumStr(rows.map((r) => r.transport as string)), charges: sumStr(rows.map((r) => r.charges as string)), tax: sumStr(rows.map((r) => r.tax as string)), total: sumStr(rows.map((r) => r.total as string)) },
      notes: ['Committed spend = value of purchase orders by the month they were issued. It is not cash paid.', 'Draft and cancelled orders are excluded. Amounts are in the purchase order currency (BDT in the demo).'],
    };
  },

  async 'department-spending'(f) {
    const pos = await filteredPOs(f);
    const names = await nameMap(Department, pos.map((p) => p.department), 'name');
    const by = new Map<string, any[]>();
    for (const p of pos) by.set(p.department, [...(by.get(p.department) ?? []), p]);
    const grand = new Decimal(sumStr(pos.map((p) => p.totalAmount?.toString())));
    const rows: Row[] = [...by.entries()].map(([d, ps]) => {
      const total = new Decimal(sumStr(ps.map((p) => p.totalAmount?.toString())));
      return { department: names.get(d) ?? 'Unknown department', orders: ps.length, total: total.toFixed(2), share: grand.isZero() ? '0.0' : total.div(grand).mul(100).toFixed(1) };
    }).sort((a, b) => dec(b.total as string).cmp(dec(a.total as string)));
    return {
      columns: [{ key: 'department', label: 'Department', type: 'text' }, { key: 'orders', label: 'Orders', type: 'int' }, money('total', 'Total committed'), { key: 'share', label: 'Share of spend %', type: 'pct' }],
      rows, totals: { department: 'Total', orders: pos.length, total: grand.toFixed(2), share: rows.length ? '100.0' : '0.0' },
      notes: ['Department is taken from the requisition that led to each purchase order. Committed spend, not cash paid.'],
    };
  },

  async 'supplier-performance'(f) {
    const s = await supplierScoring();
    const rows: Row[] = s.rows.filter((r) => !f.supplierId || r.supplierId === f.supplierId).map((r) => ({
      code: r.code, supplier: r.name, orders: r.completedOrders, onTime: r.onTimePercent === null ? null : r.onTimePercent.toFixed(1), quality: r.qualityPercent === null ? null : r.qualityPercent.toFixed(1),
      score: r.historyScore === null ? null : r.historyScore.toFixed(1), rating: r.proven ? 'Proven' : 'Unproven',
    }));
    return {
      columns: [{ key: 'code', label: 'Code', type: 'text' }, { key: 'supplier', label: 'Supplier', type: 'text' }, { key: 'orders', label: 'Completed orders', type: 'int' }, { key: 'onTime', label: 'On-time %', type: 'pct' }, { key: 'quality', label: 'Quality %', type: 'pct' }, { key: 'score', label: 'History score', type: 'pct' }, { key: 'rating', label: 'Reliability', type: 'text' }],
      rows, totals: null,
      notes: [`History score = mean of on-time % and quality %. Shown only after ${s.minHistoryOrders} completed orders; suppliers below that are Unproven and are never rated as reliable.`],
    };
  },

  async 'material-consumption'(f) {
    const q: any = { type: 'issue' };
    const range = dateRange(f);
    if (range) q.createdAt = range;
    if (f.warehouseId) q.warehouse = f.warehouseId;
    const ids = await materialIds(f);
    if (ids) q.material = { $in: oids(ids) };
    const moves: any[] = await StockMovement.find(q).limit(MAX_ROWS * 4).lean();
    const by = new Map<string, any[]>();
    for (const m of moves) by.set(String(m.material), [...(by.get(String(m.material)) ?? []), m]);
    const mats = mapOf(await Material.find({ _id: { $in: oids([...by.keys()]) } }).select('sku name unit').lean() as any[], (m) => String(m._id));
    const rows: Row[] = [...by.entries()].map(([id, ms]) => {
      const qty = ms.reduce((a, m) => a.plus(dec(m.delta?.toString()).abs()), new Decimal(0));
      const mat: any = mats.get(id);
      return { sku: mat?.sku ?? '', material: mat?.name ?? 'Unknown', unit: mat?.unit ?? '', issues: ms.length, quantity: qty.toFixed(3) };
    }).sort((a, b) => dec(b.quantity as string).cmp(dec(a.quantity as string)));
    return {
      columns: [{ key: 'sku', label: 'SKU', type: 'text' }, { key: 'material', label: 'Material', type: 'text' }, { key: 'unit', label: 'Unit', type: 'text' }, { key: 'issues', label: 'Issue count', type: 'int' }, { key: 'quantity', label: 'Quantity issued', type: 'qty' }],
      rows, totals: null, notes: ['Consumption = stock issue movements. Transfers between warehouses and adjustments are not consumption.'],
    };
  },

  async 'inventory-valuation'(f) {
    const { levels, mats, whs } = await stockView(f);
    let valued = new Decimal(0); let unvalued = 0;
    const rows: Row[] = levels.map((l) => {
      const m: any = mats.get(String(l.material));
      const price = m?.averagePurchasePrice ? dec(m.averagePurchasePrice.toString()) : null;
      const qty = dec(l.quantity.toString());
      const value = price ? qty.mul(price) : null;
      if (value) valued = valued.plus(value); else unvalued++;
      return { sku: m?.sku ?? '', material: m?.name ?? 'Unknown', warehouse: whs.get(String(l.warehouse))?.name ?? '', quantity: qty.toFixed(3), unit: m?.unit ?? '', unitPrice: price ? price.toFixed(2) : null, value: value ? value.toFixed(2) : null };
    });
    return {
      columns: [{ key: 'sku', label: 'SKU', type: 'text' }, { key: 'material', label: 'Material', type: 'text' }, { key: 'warehouse', label: 'Warehouse', type: 'text' }, { key: 'quantity', label: 'On hand', type: 'qty' }, { key: 'unit', label: 'Unit', type: 'text' }, money('unitPrice', 'Avg purchase price'), money('value', 'Value')],
      rows, totals: { sku: 'Total', value: valued.toFixed(2) },
      notes: ['Value = on-hand quantity × average purchase price. It is an estimate, not an accounting valuation (no FIFO/LIFO layers).', ...(unvalued ? [`${unvalued} row(s) have no average purchase price and are left out of the total.`] : [])],
    };
  },

  async 'warehouse-stock'(f) {
    const { levels, mats, whs } = await stockView(f);
    const rows: Row[] = levels.map((l) => {
      const m: any = mats.get(String(l.material));
      const qty = dec(l.quantity.toString());
      const status = m && qty.lte(m.minimumStock ?? 0) && (m.minimumStock ?? 0) > 0 ? 'Below minimum' : m && (m.reorderPoint ?? 0) > 0 && qty.lte(m.reorderPoint) ? 'At or below reorder point' : 'OK';
      return { sku: m?.sku ?? '', material: m?.name ?? 'Unknown', warehouse: whs.get(String(l.warehouse))?.name ?? '', quantity: qty.toFixed(3), unit: m?.unit ?? '', reorderPoint: m ? String(m.reorderPoint ?? 0) : null, minimum: m ? String(m.minimumStock ?? 0) : null, status };
    });
    return {
      columns: [{ key: 'sku', label: 'SKU', type: 'text' }, { key: 'material', label: 'Material', type: 'text' }, { key: 'warehouse', label: 'Warehouse', type: 'text' }, { key: 'quantity', label: 'On hand', type: 'qty' }, { key: 'unit', label: 'Unit', type: 'text' }, { key: 'reorderPoint', label: 'Reorder point', type: 'qty' }, { key: 'minimum', label: 'Minimum stock', type: 'qty' }, { key: 'status', label: 'Status', type: 'text' }],
      rows, totals: null, notes: ['Reorder point and minimum stock are per material (not per warehouse); the balance shown is per warehouse.'],
    };
  },

  async 'purchase-orders'(f) {
    const pos = await filteredPOs(f);
    const sups = await nameMap(Supplier, pos.map((p) => p.supplier), 'companyName');
    const rows: Row[] = pos.map((p) => ({ number: p.number, issued: isoDate(p.issuedAt), supplier: sups.get(String(p.supplier)) ?? '', status: p.status, expected: isoDate(p.expectedDeliveryDate), total: str(p.totalAmount) }));
    return {
      columns: [{ key: 'number', label: 'PO number', type: 'text' }, { key: 'issued', label: 'Issued', type: 'date' }, { key: 'supplier', label: 'Supplier', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'expected', label: 'Expected delivery', type: 'date' }, money('total', 'Total')],
      rows, totals: { number: 'Total', total: sumStr(rows.map((r) => r.total as string)) }, notes: ['Defaults to issued, partially received, received and closed orders. Pick a status to narrow or to see another one.'],
    };
  },

  async 'delayed-deliveries'(f) {
    const q: any = { status: f.poStatus ? f.poStatus : { $in: ['issued', 'partially_received', 'received', 'closed'] }, expectedDeliveryDate: { $ne: null } };
    if (f.supplierId) q.supplier = f.supplierId;
    const range = dateRange(f);
    if (range) q.expectedDeliveryDate = range;
    if (f.materialId) q['lines.material'] = f.materialId;
    const pos: any[] = await PurchaseOrder.find(q).limit(MAX_ROWS + 1).lean();
    const sups = await nameMap(Supplier, pos.map((p) => p.supplier), 'companyName');
    const now = Date.now();
    const rows: Row[] = [];
    for (const p of pos) {
      const open = ['issued', 'partially_received'].includes(p.status);
      const ref = open ? now : p.lastReceiptAt ? new Date(p.lastReceiptAt).getTime() : null;
      if (ref === null) continue;
      const late = Math.floor((ref - new Date(p.expectedDeliveryDate).getTime()) / DAY);
      if (late <= 0) continue;
      rows.push({ number: p.number, supplier: sups.get(String(p.supplier)) ?? '', status: p.status, expected: isoDate(p.expectedDeliveryDate), actual: open ? null : isoDate(new Date(ref)), daysLate: late, state: open ? 'Still open' : 'Delivered late' });
    }
    rows.sort((a, b) => (b.daysLate as number) - (a.daysLate as number));
    return {
      columns: [{ key: 'number', label: 'PO number', type: 'text' }, { key: 'supplier', label: 'Supplier', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'expected', label: 'Expected', type: 'date' }, { key: 'actual', label: 'Last receipt', type: 'date' }, { key: 'daysLate', label: 'Days late', type: 'int' }, { key: 'state', label: 'State', type: 'text' }],
      rows, totals: null, notes: ['Open orders are measured against today. Received orders are measured against their last receipt date.'],
    };
  },

  async 'mrp-planning'(f) {
    const run: any = await MRPRun.findOne().sort({ createdAt: -1 }).lean();
    if (!run) return { columns: [], rows: [], totals: null, notes: ['No MRP run has been made yet.'] };
    const ids = await materialIds(f);
    const results: any[] = await MRPResult.find({ run: run._id, ...(ids ? { material: { $in: oids(ids) } } : {}) }).lean();
    const order = { critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
    const rows: Row[] = results.map((r) => ({
      sku: r.sku, material: r.name, unit: r.unit, onHand: r.onHand, available: r.available, gross: r.grossRequirement, net: r.netRequirement,
      urgency: r.urgency ?? '', firstNeed: isoDate(r.firstNeedDate), orders: (r.plannedOrders ?? []).length, supplier: r.preferredSupplier?.name ?? '', leadTime: r.leadTimeAssumed ? `${r.leadTimeDays} (assumed)` : String(r.leadTimeDays ?? ''),
    })).sort((a, b) => (order[a.urgency as string] ?? 9) - (order[b.urgency as string] ?? 9));
    return {
      columns: [{ key: 'sku', label: 'SKU', type: 'text' }, { key: 'material', label: 'Material', type: 'text' }, { key: 'unit', label: 'Unit', type: 'text' }, { key: 'onHand', label: 'On hand', type: 'qty' }, { key: 'available', label: 'Available', type: 'qty' }, { key: 'gross', label: 'Gross requirement', type: 'qty' }, { key: 'net', label: 'Net requirement', type: 'qty' }, { key: 'urgency', label: 'Urgency', type: 'text' }, { key: 'firstNeed', label: 'First need', type: 'date' }, { key: 'orders', label: 'Planned orders', type: 'int' }, { key: 'supplier', label: 'Preferred supplier', type: 'text' }, { key: 'leadTime', label: 'Lead time (days)', type: 'text' }],
      rows, totals: null, notes: [`From MRP run ${run.number} (${isoDate(run.runDate)}, ${run.horizonDays}-day horizon). Re-run MRP to refresh. Plans are suggestions; nothing is ordered automatically.`],
    };
  },

  async 'invoice-discrepancy'(f) {
    const q: any = { $or: [{ status: 'disputed' }, { 'match.ok': false }] };
    const range = dateRange(f);
    if (range) q.invoiceDate = range;
    if (f.supplierId) q.supplier = f.supplierId;
    const inv: any[] = await Invoice.find(q).sort({ invoiceDate: -1 }).limit(MAX_ROWS + 1).lean();
    const [sups, pos] = await Promise.all([nameMap(Supplier, inv.map((i) => i.supplier), 'companyName'), nameMap(PurchaseOrder, inv.map((i) => i.purchaseOrder), 'number')]);
    const rows: Row[] = inv.map((i) => ({
      number: i.number, supplierInvoice: i.invoiceNumber, supplier: sups.get(String(i.supplier)) ?? '', po: pos.get(String(i.purchaseOrder)) ?? '', date: isoDate(i.invoiceDate), status: i.status,
      invoiceTotal: str(i.totalAmount), expectedTotal: i.match?.expectedTotal ?? null, issues: (i.match?.issues ?? []).join('; '),
    }));
    return {
      columns: [{ key: 'number', label: 'Reference', type: 'text' }, { key: 'supplierInvoice', label: 'Supplier invoice', type: 'text' }, { key: 'supplier', label: 'Supplier', type: 'text' }, { key: 'po', label: 'PO', type: 'text' }, { key: 'date', label: 'Invoice date', type: 'date' }, { key: 'status', label: 'Status', type: 'text' }, money('invoiceTotal', 'Invoice total'), money('expectedTotal', 'Expected total'), { key: 'issues', label: 'Issues', type: 'text' }],
      rows, totals: null, notes: ['Expected total comes from the three-way match (PO price × accepted quantity). Shown as recorded at the time of matching.'],
    };
  },

  async 'quotation-comparison'(f) {
    const now = new Date();
    const q: any = { status: { $ne: 'cancelled' }, $or: [{ status: { $ne: 'open' } }, { deadline: { $lte: now } }] }; // sealed until opened
    const range = dateRange(f);
    if (range) q.deadline = range;
    if (f.materialId) q['items.material'] = f.materialId;
    const rfqs: any[] = await RFQ.find(q).sort({ deadline: -1 }).limit(200).lean();
    const quotes: any[] = await SupplierQuotation.find({ rfq: { $in: rfqs.map((r) => r._id) }, ...(f.supplierId ? { supplier: f.supplierId } : {}) }).lean();
    const sups = await nameMap(Supplier, quotes.map((x) => x.supplier), 'companyName');
    const rows: Row[] = [];
    for (const r of rfqs) {
      const qs = quotes.filter((x) => String(x.rfq) === String(r._id)).sort((a, b) => dec(a.totalLandedCost.toString()).cmp(dec(b.totalLandedCost.toString())));
      let rank = 0;
      for (const x of qs) {
        const live = x.status !== 'withdrawn';
        if (live) rank++;
        rows.push({ rfq: r.number, deadline: isoDate(r.deadline), supplier: sups.get(String(x.supplier)) ?? '', landed: str(x.totalLandedCost), days: x.deliveryDays, terms: x.paymentTerms, status: x.status, rank: live ? rank : null, awarded: String(r.award?.quotation ?? '') === String(x._id) ? 'Yes' : '' });
      }
    }
    return {
      columns: [{ key: 'rfq', label: 'RFQ', type: 'text' }, { key: 'deadline', label: 'Deadline', type: 'date' }, { key: 'supplier', label: 'Supplier', type: 'text' }, money('landed', 'Total landed cost'), { key: 'days', label: 'Delivery days', type: 'int' }, { key: 'terms', label: 'Payment terms', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'rank', label: 'Price rank', type: 'int' }, { key: 'awarded', label: 'Awarded', type: 'text' }],
      rows, totals: null, notes: ['Price rank orders quotations by total landed cost only. It is not a recommendation: the award is a manual decision that also weighs delivery, terms and supplier history.', 'RFQs still open before their deadline are excluded so that sealed bids stay sealed.'],
    };
  },

  async 'forecast-performance'(f) {
    const ids = await materialIds(f);
    const fcs: any[] = await DemandForecast.find({ status: 'ok', ...(ids ? { material: { $in: oids(ids) } } : {}) }).sort({ createdAt: -1 }).limit(200).lean();
    const now = Date.now();
    const usable = fcs.map((fc) => {
      const weekly: any[] = fc.result?.weekly ?? [];
      const elapsed = weekly.filter((w) => new Date(w.weekStart).getTime() + 7 * DAY <= now);
      return { fc, elapsed };
    }).filter((x) => x.elapsed.length > 0);
    const rows: Row[] = [];
    if (usable.length) {
      const since = new Date(Math.min(...usable.map((x) => new Date(x.elapsed[0].weekStart).getTime())));
      const moves: any[] = await StockMovement.find({ type: 'issue', createdAt: { $gte: since }, material: { $in: [...new Set(usable.map((x) => x.fc.material))] } }).lean();
      for (const { fc, elapsed } of usable) {
        const start = new Date(elapsed[0].weekStart).getTime();
        const end = new Date(elapsed[elapsed.length - 1].weekStart).getTime() + 7 * DAY;
        const forecast = elapsed.reduce((a: Decimal, w: any) => a.plus(w.point), new Decimal(0));
        const actual = moves.filter((m) => String(m.material) === String(fc.material) && m.createdAt.getTime() >= start && m.createdAt.getTime() < end).reduce((a, m) => a.plus(dec(m.delta.toString()).abs()), new Decimal(0));
        const err = forecast.minus(actual);
        rows.push({ sku: fc.sku, material: fc.materialName, model: fc.selectedModel, forecastDate: isoDate(fc.asOf), weeks: elapsed.length, forecast: forecast.toFixed(3), actual: actual.toFixed(3), error: err.toFixed(3), errorPct: actual.gt(0) ? err.abs().div(actual).mul(100).toFixed(1) : null });
      }
    }
    const absErr = rows.reduce((a, r) => a.plus(dec(r.error as string).abs()), new Decimal(0));
    const act = rows.reduce((a, r) => a.plus(dec(r.actual as string)), new Decimal(0));
    return {
      columns: [{ key: 'sku', label: 'SKU', type: 'text' }, { key: 'material', label: 'Material', type: 'text' }, { key: 'model', label: 'Model', type: 'text' }, { key: 'forecastDate', label: 'Forecast date', type: 'date' }, { key: 'weeks', label: 'Weeks compared', type: 'int' }, { key: 'forecast', label: 'Forecast', type: 'qty' }, { key: 'actual', label: 'Actual issued', type: 'qty' }, { key: 'error', label: 'Error (forecast − actual)', type: 'qty' }, { key: 'errorPct', label: 'Absolute error %', type: 'pct' }],
      rows, totals: rows.length && act.gt(0) ? { sku: 'Weighted error', errorPct: absErr.div(act).mul(100).toFixed(1) } : null,
      notes: ['Compares only weeks that have fully elapsed since the forecast was made; forecasts are predictions, actuals are issue movements.', 'Weighted error = sum of absolute errors ÷ sum of actuals. Absolute error % is blank when nothing was issued.', ...(rows.length ? [] : ['No stored forecast has a fully elapsed week yet, so there is nothing to compare.'])],
    };
  },
};

async function stockView(f: Filters) {
  const ids = await materialIds(f);
  const q: any = {};
  if (f.warehouseId) q.warehouse = f.warehouseId;
  if (ids) q.material = { $in: oids(ids) };
  const levels: any[] = await StockLevel.find(q).limit(MAX_ROWS + 1).lean();
  const [mats, whs] = await Promise.all([
    Material.find({ _id: { $in: levels.map((l) => l.material) } }).lean().then((r: any[]) => mapOf(r, (m) => String(m._id))),
    Warehouse.find({ _id: { $in: levels.map((l) => l.warehouse) } }).lean().then((r: any[]) => mapOf(r, (m) => String(m._id))),
  ]);
  levels.sort((a, b) => ((mats.get(String(a.material)) as any)?.name ?? '').localeCompare((mats.get(String(b.material)) as any)?.name ?? ''));
  return { levels, mats, whs: whs as Map<string, any> };
}

export async function runReport(user: UserContext, key: string, filters: Filters): Promise<ReportResult> {
  const def = reportDef(key);
  if (!def) throw notFound('Unknown report');
  const perms = user.permissions as string[];
  if (!perms.includes('reports:view') || (def.financial && !perms.includes('reports:financial'))) throw forbidden('You do not have access to this report');
  const applied = Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && (def.filters as string[]).includes(k))) as Filters;
  const built = await builders[key]!(applied);
  const truncated = built.rows.length > MAX_ROWS;
  const rows = truncated ? built.rows.slice(0, MAX_ROWS) : built.rows;
  return { key, title: def.title, generatedAt: new Date().toISOString(), filters: applied as Record<string, string>, columns: built.columns, rows, totals: built.totals, notes: truncated ? [...built.notes, `Showing the first ${MAX_ROWS} rows. Narrow the filters to see the rest.`] : built.notes, truncated };
}

/** Catalogue visible to this user (financial reports are hidden, not just blocked). */
export function availableReports(user: UserContext) {
  const perms = user.permissions as string[];
  if (!perms.includes('reports:view')) return [];
  return REPORTS.filter((d) => !d.financial || perms.includes('reports:financial'));
}

/** Options for the filter drop-downs. */
export async function filterOptions() {
  const [departments, suppliers, materials, categories, warehouses] = await Promise.all([
    Department.find().select('name').sort({ name: 1 }).lean(), Supplier.find().select('companyName supplierCode').sort({ companyName: 1 }).lean(),
    Material.find({ active: true }).select('sku name').sort({ name: 1 }).lean(), MaterialCategory.find().select('name').sort({ name: 1 }).lean(), Warehouse.find().select('name code').sort({ name: 1 }).lean(),
  ]) as any[][];
  return {
    departments: departments.map((d) => ({ id: String(d._id), name: d.name })), suppliers: suppliers.map((s) => ({ id: String(s._id), name: `${s.supplierCode} · ${s.companyName}` })),
    materials: materials.map((m) => ({ id: String(m._id), name: `${m.sku} · ${m.name}` })), categories: categories.map((c) => ({ id: String(c._id), name: c.name })), warehouses: warehouses.map((w) => ({ id: String(w._id), name: w.name })),
    poStatuses: ['draft', 'issued', 'partially_received', 'received', 'closed', 'cancelled'],
  };
}
