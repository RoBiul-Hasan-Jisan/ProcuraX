import { Material } from '../models/Material';
import { Supplier } from '../models/Supplier';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { Invoice } from '../models/Invoice';
import { RFQ } from '../models/RFQ';
import { MRPRun } from '../models/MRPRun';
import { MRPResult } from '../models/MRPResult';
import { DemandForecast } from '../models/Forecast';
import { AssistantMessage } from '../models/AssistantMessage';
import { classify, findMaterialMention, type Intent } from '../domain/assistantIntents';
import { MIN_HISTORY_ORDERS } from '../domain/scoring';
import { Decimal, dec } from '../domain/money';
import { reorderAlerts } from './inventoryService';
import { getComparison } from './comparisonService';
import { priceObservations } from './forecastingService';
import type { UserContext } from '../types/express';

export interface AssistantAnswer {
  intent: Intent | 'unknown';
  title: string;
  summary: string;
  /** actual = recorded data; forecast = a prediction; mixed = both; unavailable = the data needed does not exist. */
  kind: 'actual' | 'forecast' | 'mixed' | 'unavailable';
  available: boolean;
  table: { columns: { key: string; label: string }[]; rows: Record<string, string | number | null>[] } | null;
  references: { type: string; id: string; label: string }[];
  calculation: string[];
  caveats: string[];
  asOf: string;
}

const unavailable = (intent: AssistantAnswer['intent'], title: string, summary: string, caveats: string[] = []): Omit<AssistantAnswer, 'asOf'> =>
  ({ intent, title, summary, kind: 'unavailable', available: false, table: null, references: [], calculation: [], caveats });
const money = (d: Decimal) => d.toDecimalPlaces(2).toFixed(2);
const isCurrent = (d: any, now: Date) => d && new Date(d).getUTCFullYear() === now.getUTCFullYear() && new Date(d).getUTCMonth() === now.getUTCMonth();
const clean = (s: string) => s.replace(/^\[DEMO\]\s*/i, '');

type Handler = (ctx: { user: UserContext; question: string; now: Date }) => Promise<Omit<AssistantAnswer, 'asOf'>>;

const handlers: Record<Intent, Handler> = {
  async below_reorder() {
    const rows = await reorderAlerts();
    if (!rows.length) return { intent: 'below_reorder', title: 'Materials at or below reorder level', summary: 'No active material is at or below its reorder point right now.', kind: 'actual', available: true, table: null, references: [], calculation: ['Total stock across warehouses is compared with each material\'s own safety, minimum and reorder levels. A level of 0 means "not set" and is ignored.'], caveats: [] };
    return {
      intent: 'below_reorder', title: 'Materials at or below reorder level', kind: 'actual', available: true,
      summary: `${rows.length} material(s) are at or below a configured level; ${rows.filter((r) => r.status === 'critical').length} are critical.`,
      table: { columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Material' }, { key: 'status', label: 'Status' }, { key: 'total', label: 'In stock' }, { key: 'reorderPoint', label: 'Reorder point' }, { key: 'shortfall', label: 'Shortfall to reorder point' }], rows: rows.map((r) => ({ sku: r.sku, name: clean(r.name), status: r.status, total: r.total, reorderPoint: String(r.reorderPoint ?? ''), shortfall: r.shortfallToReorderPoint })) },
      references: rows.slice(0, 20).map((r) => ({ type: 'Material', id: r.materialId, label: r.sku })),
      calculation: ['Status (most severe first): critical if stock <= safety stock; low if <= minimum; reorder if <= reorder point.'], caveats: [],
    };
  },

  async best_delivery_supplier() {
    const sups: any[] = await Supplier.find({ status: 'active' }).select('supplierCode companyName history').lean() as any;
    const proven = sups.filter((s) => (s.history?.completedOrders ?? 0) >= MIN_HISTORY_ORDERS).map((s) => ({ ...s, rate: (s.history.onTimeDeliveries / s.history.completedOrders) * 100 })).sort((a, b) => b.rate - a.rate);
    const unproven = sups.filter((s) => (s.history?.completedOrders ?? 0) < MIN_HISTORY_ORDERS);
    if (!proven.length) return unavailable('best_delivery_supplier', 'Delivery reliability', `No supplier has at least ${MIN_HISTORY_ORDERS} completed orders yet, so delivery reliability cannot be ranked.`);
    return {
      intent: 'best_delivery_supplier', title: 'Delivery reliability', kind: 'actual', available: true,
      summary: `${proven[0].companyName} has the best on-time record: ${proven[0].rate.toFixed(1)}% of ${proven[0].history.completedOrders} completed orders.`,
      table: { columns: [{ key: 'supplier', label: 'Supplier' }, { key: 'orders', label: 'Completed orders' }, { key: 'onTime', label: 'On time' }, { key: 'rate', label: 'On-time %' }], rows: proven.map((s) => ({ supplier: s.companyName, orders: s.history.completedOrders, onTime: s.history.onTimeDeliveries, rate: Number(s.rate.toFixed(1)) })) },
      references: proven.map((s) => ({ type: 'Supplier', id: String(s._id), label: s.supplierCode })),
      calculation: ['On-time % = orders fully accepted on or before the expected date / completed orders.'],
      caveats: [`Only suppliers with at least ${MIN_HISTORY_ORDERS} completed orders are ranked.`, ...(unproven.length ? [`${unproven.length} active supplier(s) are unproven and excluded: ${unproven.map((s) => s.companyName).join(', ')}.`] : [])],
    };
  },

  async best_quotation() {
    const rfqs: any[] = await RFQ.find({ status: { $in: ['open', 'closed'] } }).sort({ createdAt: -1 }).limit(10).lean() as any;
    const rows: Record<string, string | number | null>[] = []; const refs: AssistantAnswer['references'] = []; const sealed: string[] = [];
    for (const r of rfqs) {
      try {
        const cmp: any = await getComparison(String(r._id));
        const top = cmp.rows?.find((x: any) => x.evaluation.rank === 1);
        if (top) { rows.push({ rfq: r.number, supplier: top.supplierName, score: top.evaluation.overall, landedCost: top.totalLandedCost, unproven: top.evaluation.insufficientHistory ? 'yes' : 'no' }); refs.push({ type: 'RFQ', id: String(r._id), label: r.number }); }
      } catch { sealed.push(r.number); }
    }
    if (!rows.length) return unavailable('best_quotation', 'Best quotation', sealed.length ? 'Quotations are still sealed (their deadlines have not passed), so they cannot be compared yet.' : 'No RFQ has quotations to compare.');
    return {
      intent: 'best_quotation', title: 'Top-ranked quotation per RFQ', kind: 'actual', available: true,
      summary: `Ranked quotations are available for ${rows.length} RFQ(s). Ranking is advisory: awarding remains a manual decision.`,
      table: { columns: [{ key: 'rfq', label: 'RFQ' }, { key: 'supplier', label: 'Top-ranked supplier' }, { key: 'score', label: 'Score' }, { key: 'landedCost', label: 'Landed cost' }, { key: 'unproven', label: 'Unproven supplier' }], rows },
      references: refs, calculation: ['Weighted score of price, delivery, quality, lead time and payment terms, using the current scoring weights.'],
      caveats: [...(sealed.length ? [`Sealed until deadline: ${sealed.join(', ')}.`] : []), 'Suppliers with fewer than 5 completed orders get a neutral history score and are flagged unproven.'],
    };
  },

  async spend_this_month({ user, now }) {
    if (!user.permissions.includes('reports:financial')) return unavailable('spend_this_month', 'Procurement spend', 'Your role cannot view financial figures.');
    const pos: any[] = await PurchaseOrder.find({ status: { $in: ['issued', 'partially_received', 'received', 'closed'] }, issuedAt: { $ne: null } }).select('number totalAmount issuedAt').lean() as any;
    const mine = pos.filter((p) => isCurrent(p.issuedAt, now));
    const total = mine.reduce((a: Decimal, p) => a.plus(dec(p.totalAmount)), new Decimal(0));
    return {
      intent: 'spend_this_month', title: 'Procurement spend this month', kind: 'actual', available: true,
      summary: mine.length ? `${mine.length} purchase order(s) were issued this month, with a committed value of ${money(total)} BDT.` : 'No purchase order has been issued this month.',
      table: mine.length ? { columns: [{ key: 'po', label: 'PO' }, { key: 'total', label: 'Total (BDT)' }], rows: mine.map((p) => ({ po: p.number, total: money(dec(p.totalAmount)) })) } : null,
      references: mine.map((p) => ({ type: 'PurchaseOrder', id: String(p._id), label: p.number })),
      calculation: ['Spend = sum of the totals of purchase orders issued in the current calendar month, excluding drafts and cancelled orders.'],
      caveats: ['This is committed spend (orders issued), not cash paid: payments are not tracked yet.'],
    };
  },

  async delayed_pos({ now }) {
    const pos: any[] = await PurchaseOrder.find({ status: { $in: ['issued', 'partially_received'] }, expectedDeliveryDate: { $lt: now } }).populate('supplier', 'companyName').sort({ expectedDeliveryDate: 1 }).lean() as any;
    if (!pos.length) return { intent: 'delayed_pos', title: 'Delayed purchase orders', summary: 'No issued purchase order is past its expected delivery date.', kind: 'actual', available: true, table: null, references: [], calculation: ['An order is delayed when it is issued or partially received and its expected delivery date has passed.'], caveats: [] };
    return {
      intent: 'delayed_pos', title: 'Delayed purchase orders', kind: 'actual', available: true, summary: `${pos.length} purchase order(s) are past their expected delivery date.`,
      table: { columns: [{ key: 'po', label: 'PO' }, { key: 'supplier', label: 'Supplier' }, { key: 'status', label: 'Status' }, { key: 'expected', label: 'Expected' }, { key: 'late', label: 'Days late' }], rows: pos.map((p) => ({ po: p.number, supplier: p.supplier?.companyName ?? '', status: p.status, expected: new Date(p.expectedDeliveryDate).toISOString().slice(0, 10), late: Math.floor((now.getTime() - new Date(p.expectedDeliveryDate).getTime()) / 86_400_000) })) },
      references: pos.map((p) => ({ type: 'PurchaseOrder', id: String(p._id), label: p.number })), calculation: ['Days late = whole days between the expected delivery date and now.'], caveats: [],
    };
  },

  async next_month_requirements() {
    const rows: any[] = await DemandForecast.aggregate([{ $match: { status: 'ok' } }, { $sort: { createdAt: -1 } }, { $group: { _id: '$material', doc: { $first: '$$ROOT' } } }]) as any;
    if (!rows.length) return unavailable('next_month_requirements', 'Expected material demand', 'No demand forecast has been generated yet. Open Demand Forecasting, choose a material and run a forecast; until then no demand figure can be given.', ['For demand driven by confirmed production plans, run MRP.']);
    const list = rows.map((r) => ({ ...r.doc, h30: r.doc.result.horizons.find((h: any) => h.days === 30) })).filter((r) => r.h30).sort((a, b) => b.h30.total - a.h30.total);
    return {
      intent: 'next_month_requirements', title: 'Forecast demand, next 30 days', kind: 'forecast', available: true,
      summary: `Latest forecasts exist for ${list.length} material(s). These are predictions from past consumption, not actual or planned requirements.`,
      table: { columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Material' }, { key: 'forecast', label: 'Forecast 30 days' }, { key: 'range', label: '80% range' }, { key: 'model', label: 'Model' }, { key: 'asOf', label: 'Forecast date' }], rows: list.map((r) => ({ sku: r.sku, name: clean(r.materialName), forecast: `${r.h30.total.toFixed(1)} ${r.unit}`, range: `${r.h30.low.toFixed(1)} to ${r.h30.high.toFixed(1)}`, model: r.selectedModel, asOf: new Date(r.asOf).toISOString().slice(0, 10) })) },
      references: list.map((r) => ({ type: 'Material', id: String(r.material), label: r.sku })),
      calculation: ['Weekly consumption (stock issued to production) is forecast by the best of several models chosen by backtest error; the 30-day figure sums the weekly forecasts.'],
      caveats: ['FORECAST, not an actual value. Materials without a saved forecast are not listed.', 'Forecasts can be out of date: check the forecast date.'],
    };
  },

  async price_increase_reason({ question }) {
    const mats: any[] = await Material.find({ active: true }).select('name sku').lean() as any;
    const m = findMaterialMention(question, mats);
    if (!m) return unavailable('price_increase_reason', 'Price movement', 'Name the material you mean (for example its SKU) and I can show how its recorded price has moved.');
    const obs = await priceObservations(String(m._id));
    if (obs.length < 2) return unavailable('price_increase_reason', `Price of ${clean(m.name)}`, `Fewer than two price records exist for ${clean(m.name)}, so no price movement can be shown.`);
    const first = obs[0], last = obs[obs.length - 1];
    const change = first.price === 0 ? null : ((last.price - first.price) / first.price) * 100;
    const recent = obs.slice(-8).map((o) => ({ date: o.date.toISOString().slice(0, 10), price: o.price, source: o.source }));
    return {
      intent: 'price_increase_reason', title: `Price of ${clean(m.name)}`, kind: 'actual', available: true,
      summary: `The recorded unit price moved from ${first.price} (${first.date.toISOString().slice(0, 10)}) to ${last.price} (${last.date.toISOString().slice(0, 10)})${change === null ? '' : `, a change of ${change.toFixed(1)}%`}. The system does not record why prices change, so the cause cannot be stated from this data.`,
      table: { columns: [{ key: 'date', label: 'Date' }, { key: 'price', label: 'Unit price' }, { key: 'source', label: 'Source' }], rows: recent },
      references: [{ type: 'Material', id: String(m._id), label: m.sku }],
      calculation: ['Change % = (latest price - earliest price) / earliest price x 100 over all recorded observations.'],
      caveats: ['Market conditions, supplier changes or specification changes are not captured. Ask the supplier or buyer for the cause.'],
    };
  },

  async department_spend({ user, now }) {
    if (!user.permissions.includes('reports:financial')) return unavailable('department_spend', 'Spend by department', 'Your role cannot view financial figures.');
    const pos: any[] = await PurchaseOrder.find({ status: { $in: ['issued', 'partially_received', 'received', 'closed'] }, issuedAt: { $ne: null } }).select('requisition totalAmount').lean() as any;
    const reqs: any[] = await PurchaseRequisition.find({ _id: { $in: pos.map((p) => p.requisition) } }).populate('department', 'name').select('department').lean() as any;
    const dept = new Map(reqs.map((r) => [String(r._id), r.department?.name ?? 'Unknown']));
    const totals = new Map<string, Decimal>();
    for (const p of pos) { const d = dept.get(String(p.requisition)) ?? 'Unknown'; totals.set(d, (totals.get(d) ?? new Decimal(0)).plus(dec(p.totalAmount))); }
    const ranked = [...totals.entries()].sort((a, b) => b[1].comparedTo(a[1]));
    if (!ranked.length) return unavailable('department_spend', 'Spend by department', 'No purchase order has been issued yet, so there is no department spend to compare.');
    return {
      intent: 'department_spend', title: 'Procurement spend by department', kind: 'actual', available: true,
      summary: `${ranked[0][0]} has the highest committed spend: ${money(ranked[0][1])} BDT (all time, issued orders).`,
      table: { columns: [{ key: 'department', label: 'Department' }, { key: 'total', label: 'Committed (BDT)' }], rows: ranked.map(([d, t]) => ({ department: d, total: money(t) })) },
      references: [], calculation: ['Each issued order is attributed to the department of the requisition it came from; totals sum order values.'], caveats: ['Committed spend over all time, not limited to this month.'],
    };
  },

  async invoice_mismatches() {
    const invs: any[] = await Invoice.find({ $or: [{ 'match.ok': false }, { status: 'disputed' }] }).populate('supplier', 'companyName').sort({ invoiceDate: -1 }).limit(50).lean() as any;
    if (!invs.length) return { intent: 'invoice_mismatches', title: 'Invoice mismatches', summary: 'No invoice currently has a three-way-match mismatch or dispute.', kind: 'actual', available: true, table: null, references: [], calculation: ['Three-way match compares the PO, the accepted goods and the invoice.'], caveats: [] };
    return {
      intent: 'invoice_mismatches', title: 'Invoice mismatches', kind: 'actual', available: true, summary: `${invs.length} invoice(s) have a mismatch or a dispute.`,
      table: { columns: [{ key: 'invoice', label: 'Invoice' }, { key: 'supplier', label: 'Supplier' }, { key: 'status', label: 'Status' }, { key: 'issues', label: 'Issues' }], rows: invs.map((i) => ({ invoice: `${i.number} (${i.invoiceNumber})`, supplier: i.supplier?.companyName ?? '', status: i.status, issues: (i.match?.issues ?? []).join('; ') })) },
      references: invs.map((i) => ({ type: 'Invoice', id: String(i._id), label: i.number })), calculation: ['Mismatch rules: material on PO, price equals PO price, quantity <= accepted minus invoiced, charges and tax within the PO.'], caveats: [],
    };
  },

  async urgent_materials() {
    const run: any = await MRPRun.findOne().sort({ createdAt: -1 }).lean();
    const alerts = (await reorderAlerts()).filter((r) => r.status === 'critical');
    const fromRun: any[] = run ? await MRPResult.find({ run: run._id, urgency: { $in: ['critical', 'high'] } }).lean() as any : [];
    if (!run && !alerts.length) return unavailable('urgent_materials', 'Urgent procurement', 'No MRP run exists and no material is at a critical stock level. Run MRP to see plan-driven urgency.');
    const rows = [
      ...fromRun.map((r) => ({ sku: r.sku, name: clean(r.name), why: `MRP ${run.number}: ${r.urgency} urgency, net requirement ${r.netRequirement} ${r.unit}`, source: 'MRP run' })),
      ...alerts.filter((a) => !fromRun.some((r) => r.sku === a.sku)).map((a) => ({ sku: a.sku, name: clean(a.name), why: `Stock ${a.total} is at or below safety stock`, source: 'Stock level' })),
    ];
    return {
      intent: 'urgent_materials', title: 'Materials needing urgent procurement', kind: 'actual', available: true,
      summary: rows.length ? `${rows.length} material(s) need urgent attention.` : 'No material is currently flagged urgent.',
      table: rows.length ? { columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Material' }, { key: 'why', label: 'Why' }, { key: 'source', label: 'Source' }], rows } : null,
      references: [...fromRun.map((r) => ({ type: 'MRPRun', id: String(run._id), label: run.number })).slice(0, 1)],
      calculation: ['Urgent = high or critical urgency in the latest MRP run (need date within 3 days or ordering already late), or stock at or below safety stock.'],
      caveats: run ? [`MRP figures come from run ${run.number} of ${new Date(run.runDate).toISOString().slice(0, 10)}; run MRP again for current data.`] : ['No MRP run exists, so only stock levels were checked.'],
    };
  },
};

export async function ask(user: UserContext, question: string, now = new Date()): Promise<AssistantAnswer> {
  const { intent } = classify(question);
  const base = intent === 'unknown'
    ? unavailable('unknown', 'I cannot answer that from the available data', 'I can only answer questions that map to a defined business query. Try one of the suggested questions. I do not guess figures.')
    : await handlers[intent]({ user, question, now });
  const answer: AssistantAnswer = { ...base, asOf: now.toISOString() };
  await AssistantMessage.create({ user: user.id, question, intent: answer.intent, answer });
  return answer;
}

export async function history(user: UserContext, limit = 30) {
  const rows: any[] = await AssistantMessage.find({ user: user.id }).sort({ createdAt: -1 }).limit(limit).lean() as any;
  return rows.reverse().map((r) => ({ id: String(r._id), question: r.question, answer: r.answer, createdAt: r.createdAt }));
}
