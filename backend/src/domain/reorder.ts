import { dec, Decimal, type DecimalInput } from './money';
import { addDays } from './mrp';

export interface ReorderPolicy { lookbackDays: number; coverageDays: number }
export const DEFAULT_REORDER_POLICY: ReorderPolicy = { lookbackDays: 90, coverageDays: 30 };

export interface ReorderInput {
  consumedInLookback: DecimalInput; // total units issued to production within the lookback window
  available: DecimalInput; // on hand minus reservations
  onOrder: DecimalInput; // outstanding purchase-order quantity (issued, not yet accepted)
  safetyStock: DecimalInput;
  configuredReorderPoint: DecimalInput;
  leadTimeDays: number;
  today: Date;
  policy?: ReorderPolicy;
}
export interface ReorderRecommendation {
  averageDailyConsumption: string; leadTimeDemand: string; safetyStock: string; reorderPoint: string; basis: 'consumption' | 'configured';
  inventoryPosition: string; reorderNow: boolean; suggestedQuantity: string;
  plannedOrderDate: Date | null; expectedDelivery: Date | null; explanation: string[];
}
const f = (d: Decimal) => d.toDecimalPlaces(3).toFixed();

/**
 * Reorder planning.
 *   Average daily consumption = units issued in the lookback window / lookback days
 *   Lead-time demand          = average daily consumption x lead time
 *   Reorder point             = lead-time demand + safety stock
 *   Inventory position        = available (on hand - reserved) + outstanding purchase orders
 *   Order when position <= reorder point; suggested quantity = reorder point + coverage days x daily use - position (rounded up)
 * With no consumption history there is nothing to derive a rate from, so the configured reorder point is used (basis "configured")
 * and the suggestion only tops the position back up to that point.
 */
export function recommendReorder(i: ReorderInput): ReorderRecommendation {
  const policy = i.policy ?? DEFAULT_REORDER_POLICY;
  const consumed = dec(i.consumedInLookback);
  const avg = consumed.div(Math.max(1, policy.lookbackDays));
  const safety = dec(i.safetyStock);
  const position = Decimal.max(0, dec(i.available)).plus(dec(i.onOrder));
  const explanation: string[] = [];
  let basis: 'consumption' | 'configured' = 'consumption';
  let ltd = avg.mul(Math.max(0, i.leadTimeDays));
  let rop = ltd.plus(safety);
  let target: Decimal;
  if (consumed.lte(0)) {
    basis = 'configured'; ltd = new Decimal(0); rop = dec(i.configuredReorderPoint); target = rop;
    explanation.push(`No consumption recorded in the last ${policy.lookbackDays} days, so the configured reorder point ${f(rop)} is used and the suggestion only restores that level.`);
  } else {
    target = rop.plus(avg.mul(policy.coverageDays));
    explanation.push(`Average daily consumption ${f(avg)} (= ${f(consumed)} over ${policy.lookbackDays} days). Lead-time demand ${f(ltd)} + safety stock ${f(safety)} = reorder point ${f(rop)}.`);
  }
  const reorderNow = rop.gt(0) && position.lte(rop);
  const qty = reorderNow ? Decimal.max(0, target.minus(position)).toDecimalPlaces(3, Decimal.ROUND_UP) : new Decimal(0);
  explanation.push(`Inventory position ${f(position)} (available + on order) ${reorderNow ? 'is at or below' : 'is above'} the reorder point${reorderNow ? `; order ${f(qty)} to reach ${f(target)}.` : '.'}`);
  const planned = reorderNow ? i.today : null;
  return {
    averageDailyConsumption: f(avg), leadTimeDemand: f(ltd), safetyStock: f(safety), reorderPoint: f(rop), basis, inventoryPosition: f(position), reorderNow,
    suggestedQuantity: f(qty), plannedOrderDate: planned, expectedDelivery: planned ? addDays(planned, Math.max(0, i.leadTimeDays)) : null, explanation,
  };
}
