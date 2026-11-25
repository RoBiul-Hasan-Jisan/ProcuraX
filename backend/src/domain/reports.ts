import { Decimal, dec } from './money';

export type ColType = 'text' | 'money' | 'qty' | 'pct' | 'date' | 'int';
export interface Column { key: string; label: string; type: ColType }
export type Cell = string | number | null;
export type Row = Record<string, Cell>;
export const FILTERS = ['from', 'to', 'departmentId', 'supplierId', 'materialId', 'categoryId', 'warehouseId', 'poStatus'] as const;
export type FilterKey = (typeof FILTERS)[number];

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  /** Needs `reports:financial` (amounts, prices, valuations). */
  financial: boolean;
  filters: FilterKey[];
}

export const REPORTS: ReportDef[] = [
  { key: 'monthly-expenditure', title: 'Monthly Procurement Expenditure', description: 'Committed spend on issued purchase orders per month (not cash paid). Cancelled and draft orders are excluded.', financial: true, filters: ['from', 'to', 'supplierId', 'departmentId', 'poStatus'] },
  { key: 'department-spending', title: 'Department-wise Spending', description: 'Committed spend on issued purchase orders, grouped by the requesting department.', financial: true, filters: ['from', 'to', 'departmentId', 'supplierId', 'poStatus'] },
  { key: 'supplier-performance', title: 'Supplier Performance', description: 'Recorded on-time delivery and quality per supplier. Suppliers with too few completed orders are shown as unproven, with no rating.', financial: false, filters: ['supplierId'] },
  { key: 'material-consumption', title: 'Material Consumption', description: 'Stock issued to production or other consumers (issue movements), per material.', financial: false, filters: ['from', 'to', 'materialId', 'categoryId', 'warehouseId'] },
  { key: 'inventory-valuation', title: 'Inventory Valuation', description: 'Current on-hand quantity multiplied by the material\'s average purchase price. Materials without a price are listed unvalued.', financial: true, filters: ['materialId', 'categoryId', 'warehouseId'] },
  { key: 'warehouse-stock', title: 'Warehouse Stock', description: 'Current balance per material per warehouse against reorder point and minimum stock.', financial: false, filters: ['materialId', 'categoryId', 'warehouseId'] },
  { key: 'purchase-orders', title: 'Purchase Order Report', description: 'Purchase orders with supplier, status, amount and expected delivery.', financial: true, filters: ['from', 'to', 'supplierId', 'departmentId', 'poStatus'] },
  { key: 'delayed-deliveries', title: 'Delayed Delivery Report', description: 'Open purchase orders past their expected date, and received orders delivered after it.', financial: false, filters: ['from', 'to', 'supplierId', 'materialId', 'poStatus'] },
  { key: 'mrp-planning', title: 'MRP Planning Report', description: 'Net requirements and planned orders from the most recent MRP run.', financial: false, filters: ['materialId', 'categoryId'] },
  { key: 'invoice-discrepancy', title: 'Invoice Discrepancy Report', description: 'Invoices whose three-way match failed or that were disputed.', financial: true, filters: ['from', 'to', 'supplierId'] },
  { key: 'quotation-comparison', title: 'Supplier Quotation Comparison', description: 'Quotations per RFQ. Only RFQs already past their deadline (or closed) are included, so sealed bids are never exposed.', financial: true, filters: ['from', 'to', 'supplierId', 'materialId'] },
  { key: 'forecast-performance', title: 'Forecast Performance', description: 'Past demand forecasts compared with what was actually issued afterwards, over fully elapsed weeks only.', financial: false, filters: ['materialId', 'categoryId'] },
];
export const reportDef = (key: string) => REPORTS.find((r) => r.key === key);

export interface ReportResult {
  key: string; title: string; generatedAt: string;
  filters: Record<string, string>; columns: Column[]; rows: Row[]; totals: Row | null; notes: string[]; truncated: boolean;
}
export const MAX_ROWS = 5000;

/** Exact sum of decimal-like cells, as a fixed string. */
export const sumStr = (vals: Array<string | number | null | undefined>, places = 2) =>
  vals.reduce<Decimal>((a, v) => a.plus(v === null || v === undefined || v === '' ? 0 : dec(v as string)), new Decimal(0)).toFixed(places);

/** YYYY-MM in UTC, for monthly grouping. */
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
export const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * CSV/Excel formula injection guard: a cell that starts with = + - @ tab or CR is treated by spreadsheets as a formula.
 * Text is prefixed with an apostrophe so it displays as typed. Numbers and amounts are written untouched.
 */
export function safeText(v: Cell): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
const NUMERIC = /^-?\d+(\.\d+)?$/;
/** Numeric-looking strings (our exact decimals) are not text, so a leading '-' on a negative amount is kept. */
export const csvCell = (v: Cell, type: ColType): string => {
  const s = type === 'text' ? safeText(v) : v === null ? '' : String(v);
  if (type !== 'text' && s !== '' && !NUMERIC.test(s) && /^[=+\-@\t\r]/.test(s)) return csvQuote(`'${s}`);
  return csvQuote(s);
};
const csvQuote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(result: Pick<ReportResult, 'columns' | 'rows' | 'totals'>): string {
  const head = result.columns.map((c) => csvQuote(safeText(c.label))).join(',');
  const body = result.rows.map((r) => result.columns.map((c) => csvCell(r[c.key] ?? null, c.type)).join(','));
  if (result.totals) body.push(result.columns.map((c) => csvCell(result.totals![c.key] ?? null, c.type)).join(','));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n'; // BOM so Excel reads UTF-8
}
