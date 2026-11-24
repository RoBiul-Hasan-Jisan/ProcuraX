import { Decimal } from './money';

export interface ScoreWeights {
  price: number;
  delivery: number;
  quality: number;
  leadTime: number;
  payment: number;
}
export const DEFAULT_WEIGHTS: ScoreWeights = { price: 30, delivery: 25, quality: 20, leadTime: 15, payment: 10 };

/** Suppliers with fewer completed orders than this have not proven reliability. */
export const MIN_HISTORY_ORDERS = 5;
export const NEUTRAL_SCORE = 50;
/** Payment terms of this many credit days or more earn the full payment score. */
export const FULL_CREDIT_DAYS = 60;

export interface SupplierHistory {
  completedOrders: number;
  onTimeDeliveries: number;
  unitsReceived: number;
  unitsAccepted: number;
}

export interface ScoringInput {
  quotationId: string;
  supplierId: string;
  supplierName: string;
  totalLandedCost: Decimal;
  deliveryDays: number;
  paymentTermsDays: number;
  history: SupplierHistory;
}

export interface ScoredQuotation {
  quotationId: string;
  supplierId: string;
  supplierName: string;
  scores: { price: number; delivery: number; quality: number; leadTime: number; payment: number };
  overall: number;
  rank: number;
  costDifference: Decimal;
  costDifferencePercent: number;
  deliveryDifferenceDays: number;
  insufficientHistory: boolean;
  reasons: string[];
}

export function normalizeWeights(w: ScoreWeights): ScoreWeights {
  const values = Object.values(w);
  if (values.some((v) => !Number.isFinite(v) || v < 0)) throw new Error('Weights must be non-negative numbers');
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error('At least one weight must be greater than zero');
  const f = (v: number) => (v / total) * 100;
  return { price: f(w.price), delivery: f(w.delivery), quality: f(w.quality), leadTime: f(w.leadTime), payment: f(w.payment) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Scores each quotation 0-100 per criterion and ranks by weighted total.
 *  - price:     lowest landed cost / this landed cost
 *  - leadTime:  fastest delivery days / this delivery days
 *  - payment:   credit days / 60 (capped at 100)
 *  - delivery & quality come from the supplier's recorded history; with too little history a neutral 50
 *    is used and flagged, so an unproven supplier is never scored as reliable.
 * Ranking is advisory only: awarding is always a manual human decision.
 */
export function scoreQuotations(inputs: ScoringInput[], rawWeights: ScoreWeights = DEFAULT_WEIGHTS): ScoredQuotation[] {
  if (inputs.length === 0) return [];
  const w = normalizeWeights(rawWeights);
  const minCost = Decimal.min(...inputs.map((i) => i.totalLandedCost));
  const minDays = Math.min(...inputs.map((i) => Math.max(i.deliveryDays, 1)));

  const scored = inputs.map((i) => {
    const insufficient = i.history.completedOrders < MIN_HISTORY_ORDERS;
    const price = i.totalLandedCost.lte(0) ? 100 : minCost.div(i.totalLandedCost).mul(100).toNumber();
    const leadTime = (minDays / Math.max(i.deliveryDays, 1)) * 100;
    const payment = Math.min(100, (Math.max(i.paymentTermsDays, 0) / FULL_CREDIT_DAYS) * 100);
    const delivery = insufficient ? NEUTRAL_SCORE : (i.history.onTimeDeliveries / i.history.completedOrders) * 100;
    const quality = insufficient || i.history.unitsReceived <= 0
      ? NEUTRAL_SCORE
      : (i.history.unitsAccepted / i.history.unitsReceived) * 100;
    const scores = { price: round2(price), delivery: round2(delivery), quality: round2(quality), leadTime: round2(leadTime), payment: round2(payment) };
    const overall = round2(
      (scores.price * w.price + scores.delivery * w.delivery + scores.quality * w.quality +
        scores.leadTime * w.leadTime + scores.payment * w.payment) / 100,
    );
    const costDifference = i.totalLandedCost.minus(minCost);
    const reasons: string[] = [];
    if (costDifference.isZero()) reasons.push('Lowest total landed cost');
    else reasons.push(`Landed cost is ${costDifference.toFixed(2)} (${minCost.isZero() ? 0 : costDifference.div(minCost).mul(100).toFixed(1)}%) above the lowest quotation`);
    if (i.deliveryDays === minDays) reasons.push('Fastest delivery');
    else reasons.push(`Delivers ${i.deliveryDays - minDays} day(s) later than the fastest quotation`);
    if (insufficient) {
      reasons.push(`Only ${i.history.completedOrders} completed order(s) on record (minimum ${MIN_HISTORY_ORDERS}): delivery and quality use a neutral score of ${NEUTRAL_SCORE}, reliability is unproven`);
    } else {
      reasons.push(`Historical on-time delivery ${scores.delivery.toFixed(1)}%, quality acceptance ${scores.quality.toFixed(1)}%`);
    }
    return {
      quotationId: i.quotationId, supplierId: i.supplierId, supplierName: i.supplierName, scores, overall,
      costDifference,
      costDifferencePercent: minCost.isZero() ? 0 : costDifference.div(minCost).mul(100).toDecimalPlaces(2).toNumber(),
      deliveryDifferenceDays: i.deliveryDays - minDays,
      insufficientHistory: insufficient, reasons, cost: i.totalLandedCost,
    };
  });

  scored.sort((a, b) => b.overall - a.overall || a.cost.comparedTo(b.cost));
  return scored.map(({ cost: _cost, ...rest }, idx) => ({ ...rest, rank: idx + 1 }));
}
