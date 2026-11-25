import { dec, Decimal, type DecimalInput } from './money';

const DAY = 86_400_000;
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export type Urgency = 'critical' | 'high' | 'medium' | 'low';
export interface UrgencyConfig { highDays: number; mediumDays: number }
export const DEFAULT_URGENCY: UrgencyConfig = { highDays: 3, mediumDays: 10 };

export interface Demand { date: Date; gross: DecimalInput; adjusted: DecimalInput; source: string; path: string[] }
export interface Receipt { date: Date; quantity: DecimalInput; reference: string }

export interface MaterialInput {
  demands: Demand[];
  onHand: DecimalInput;
  /** Active reservations that are NOT for a plan in this run. Reservations for plans in this run ARE the demand and must not be subtracted twice. */
  reservedOther: DecimalInput;
  safetyStock: DecimalInput;
  receipts: Receipt[];
  leadTimeDays: number;
  today: Date;
  /** Largest quantity the preferred supplier can deliver on one order, if known. */
  supplierCapacity?: DecimalInput | null;
  urgency?: UrgencyConfig;
}

export interface PlannedOrder {
  needDate: Date; quantity: string; releaseDate: Date; expectedArrival: Date;
  /** true when even ordering today cannot arrive by the need date */
  late: boolean; daysLate: number; urgency: Urgency;
}
export interface MaterialPlan {
  grossRequirement: string; adjustedRequirement: string;
  onHand: string; reservedOther: string; available: string; safetyStock: string;
  scheduledReceiptsTotal: string; scheduledReceiptsUsed: string;
  netRequirement: string; plannedOrders: PlannedOrder[];
  firstNeedDate: Date | null; urgency: Urgency | null;
  exceedsSupplierCapacity: boolean; ordersNeededForCapacity: number | null;
  /** Receipts arriving after the first need date (they cannot cover it, only later demand). */
  lateReceipts: { reference: string; date: Date; quantity: string }[];
  explanation: string[];
}

const ceil3 = (d: Decimal) => d.toDecimalPlaces(3, Decimal.ROUND_UP);
const fmt = (d: Decimal) => d.toDecimalPlaces(3).toFixed();
const day = (d: Date) => d.toISOString().slice(0, 10);

export function urgencyFor(order: { late: boolean; releaseDate: Date }, today: Date, cfg: UrgencyConfig = DEFAULT_URGENCY): Urgency {
  if (order.late) return 'critical';
  const days = Math.round((startOfDay(order.releaseDate).getTime() - startOfDay(today).getTime()) / DAY);
  if (days <= cfg.highDays) return 'high';
  if (days <= cfg.mediumDays) return 'medium';
  return 'low';
}
const RANK: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Time-phased net requirement for ONE material (lot-for-lot).
 *
 *   available = max(0, on hand - reserved for other purposes)          (reserved stock is never counted twice)
 *   For each need date d, in date order:
 *     supply(d)  = available + scheduled receipts arriving on or before d + planned orders already raised for earlier dates
 *     order(d)   = max(0, safety stock + cumulative adjusted demand(d) - supply(d))
 *   Net requirement = sum of order(d)
 *
 * With a single need date and all receipts arriving in time this reduces exactly to the textbook formula
 *   Net = Adjusted gross + Safety stock - Available - Scheduled receipts   (floored at 0).
 * Receipts that arrive after a need date do not cover it. Rejected goods never appear here because only accepted goods are in stock.
 * A material with no demand in the run produces no requirement (safety-stock top-up is the job of reorder planning).
 */
export function planMaterial(input: MaterialInput): MaterialPlan {
  const cfg = input.urgency ?? DEFAULT_URGENCY;
  const onHand = Decimal.max(0, dec(input.onHand));
  const reserved = Decimal.max(0, dec(input.reservedOther));
  const available = Decimal.max(0, onHand.minus(reserved));
  const safety = Decimal.max(0, dec(input.safetyStock));
  const demands = [...input.demands].sort((a, b) => a.date.getTime() - b.date.getTime());
  const receipts = [...input.receipts].sort((a, b) => a.date.getTime() - b.date.getTime());

  const gross = demands.reduce((a, d) => a.plus(dec(d.gross)), new Decimal(0));
  const adjusted = demands.reduce((a, d) => a.plus(dec(d.adjusted)), new Decimal(0));
  const receiptsTotal = receipts.reduce((a, r) => a.plus(dec(r.quantity)), new Decimal(0));

  // Group demand by need date (one planned order per date).
  const buckets = new Map<number, { date: Date; qty: Decimal }>();
  for (const d of demands) {
    const k = startOfDay(d.date).getTime();
    const b = buckets.get(k) ?? { date: startOfDay(d.date), qty: new Decimal(0) };
    b.qty = b.qty.plus(dec(d.adjusted));
    buckets.set(k, b);
  }

  const plannedOrders: PlannedOrder[] = [];
  const explanation: string[] = [];
  let cumDemand = new Decimal(0);
  let ordered = new Decimal(0);
  let receiptsUsed = new Decimal(0);
  const lead = Math.max(0, Math.floor(input.leadTimeDays));

  for (const [, b] of [...buckets.entries()].sort((x, y) => x[0] - y[0])) {
    cumDemand = cumDemand.plus(b.qty);
    const arrived = receipts.filter((r) => startOfDay(r.date).getTime() <= b.date.getTime()).reduce((a, r) => a.plus(dec(r.quantity)), new Decimal(0));
    receiptsUsed = Decimal.max(receiptsUsed, arrived);
    const supply = available.plus(arrived).plus(ordered);
    const need = Decimal.max(0, safety.plus(cumDemand).minus(supply));
    explanation.push(
      `By ${day(b.date)}: cumulative demand ${fmt(cumDemand)} + safety ${fmt(safety)} = ${fmt(safety.plus(cumDemand))}; supply = available ${fmt(available)} + receipts on time ${fmt(arrived)} + planned orders ${fmt(ordered)} = ${fmt(supply)}; shortfall ${fmt(need)}.`,
    );
    if (need.gt(0)) {
      const qty = ceil3(need);
      const earliest = startOfDay(input.today);
      const release = addDays(b.date, -lead).getTime() < earliest.getTime() ? earliest : addDays(b.date, -lead);
      const expectedArrival = addDays(release, lead);
      const late = expectedArrival.getTime() > b.date.getTime();
      const daysLate = late ? Math.round((expectedArrival.getTime() - b.date.getTime()) / DAY) : 0;
      const o: PlannedOrder = { needDate: b.date, quantity: qty.toFixed(), releaseDate: release, expectedArrival, late, daysLate, urgency: 'low' };
      o.urgency = urgencyFor(o, input.today, cfg);
      plannedOrders.push(o);
      ordered = ordered.plus(qty);
    }
  }

  // Receipts arriving after the first need date cannot cover it; they are only counted for later need dates.
  const first = demands.length ? startOfDay(demands[0].date).getTime() : null;
  const lateReceipts = receipts
    .filter((r) => first !== null && startOfDay(r.date).getTime() > first)
    .map((r) => ({ reference: r.reference, date: r.date, quantity: fmt(dec(r.quantity)) }));

  const net = plannedOrders.reduce((a, o) => a.plus(dec(o.quantity)), new Decimal(0));
  const cap = input.supplierCapacity != null && dec(input.supplierCapacity).gt(0) ? dec(input.supplierCapacity) : null;
  const exceeds = cap !== null && plannedOrders.some((o) => dec(o.quantity).gt(cap));
  const ordersNeeded = cap !== null ? plannedOrders.reduce((a, o) => a + dec(o.quantity).div(cap).ceil().toNumber(), 0) : null;
  const urgency = plannedOrders.length ? plannedOrders.map((o) => o.urgency).sort((a, b) => RANK[a] - RANK[b])[0] : null;

  if (reserved.gt(onHand)) explanation.unshift(`Reserved quantity ${fmt(reserved)} exceeds on-hand ${fmt(onHand)}; available is treated as 0.`);
  if (!plannedOrders.length && demands.length) explanation.push('Existing stock and scheduled receipts cover the demand and safety stock. No procurement needed.');
  for (const o of plannedOrders) {
    explanation.push(`Order ${o.quantity} by ${day(o.releaseDate)} (lead time ${lead} days) to arrive ${day(o.expectedArrival)} for need date ${day(o.needDate)}${o.late ? `; ${o.daysLate} day(s) too late, expedite or find a faster source` : ''}.`);
  }
  if (exceeds) explanation.push(`A planned order exceeds the supplier's single-order capacity of ${fmt(cap!)}: split across at least ${ordersNeeded} orders or add suppliers.`);

  return {
    grossRequirement: fmt(gross), adjustedRequirement: fmt(adjusted), onHand: fmt(onHand), reservedOther: fmt(reserved), available: fmt(available), safetyStock: fmt(safety),
    scheduledReceiptsTotal: fmt(receiptsTotal), scheduledReceiptsUsed: fmt(receiptsUsed), netRequirement: fmt(net), plannedOrders,
    firstNeedDate: demands.length ? startOfDay(demands[0].date) : null, urgency, exceedsSupplierCapacity: exceeds, ordersNeededForCapacity: ordersNeeded,
    lateReceipts, explanation,
  };
}
