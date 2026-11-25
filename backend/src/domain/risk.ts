/**
 * Explainable procurement risk detection. Pure functions: plain data in, candidate alerts out.
 * Every rule states its threshold in the evidence so a reviewer can see why it fired.
 * Alerts describe a pattern that deserves review. They never assert misconduct by a person or supplier.
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export const RISK_CATEGORIES = [
  'high_quotation_price', 'price_increase', 'duplicate_requisition', 'duplicate_invoice', 'unusual_adjustment',
  'abnormal_consumption', 'delayed_po', 'supplier_quality', 'supplier_delivery', 'repeated_mismatch',
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export interface RiskCandidate {
  /** Stable identity of the underlying condition. The same condition never raises a second alert. */
  dedupeKey: string;
  category: RiskCategory;
  severity: Severity;
  title: string;
  material?: { id: string; name: string; sku?: string };
  supplier?: { id: string; name: string };
  reference?: { kind: string; id: string; number?: string };
  reason: string;
  evidence: Record<string, unknown>;
  recommendedAction: string;
}

/* ---------- statistics ---------- */
export const MIN_BASELINE = 8;

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Robust z-score from the median and MAD (0.6745 makes MAD comparable to a standard deviation).
 *  Returns null when the baseline is too short or has no spread: no score is better than a made-up one. */
export function robustZ(baseline: number[], x: number): number | null {
  if (baseline.length < MIN_BASELINE) return null;
  const med = median(baseline);
  const mad = median(baseline.map((v) => Math.abs(v - med)));
  if (mad === 0) return null;
  return (0.6745 * (x - med)) / mad;
}

const pct = (a: number, b: number) => (b === 0 ? null : ((a - b) / b) * 100);
const r1 = (n: number) => Math.round(n * 10) / 10;
const day = (d: Date) => d.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

/* ---------- 1. abnormal consumption ---------- */
export interface WeeklyConsumption { material: { id: string; name: string; sku?: string }; weeks: number[]; lastWeekStart: string }
export const CONSUMPTION_Z = 3.5;
/** The most recent COMPLETE week against the weeks before it. */
export function detectAbnormalConsumption(i: WeeklyConsumption): RiskCandidate | null {
  if (i.weeks.length < MIN_BASELINE + 1) return null;
  const latest = i.weeks[i.weeks.length - 1];
  const base = i.weeks.slice(0, -1);
  const z = robustZ(base, latest);
  if (z === null || Math.abs(z) < CONSUMPTION_Z) return null;
  const med = median(base);
  const up = z > 0;
  return {
    dedupeKey: `consumption:${i.material.id}:${i.lastWeekStart}`, category: 'abnormal_consumption',
    severity: Math.abs(z) >= 6 ? 'high' : 'medium',
    title: `${up ? 'Unusually high' : 'Unusually low'} consumption of ${i.material.name}`, material: i.material,
    reason: `Consumption in the week starting ${i.lastWeekStart} was ${latest} against a typical ${r1(med)} per week (robust z-score ${r1(z)}, threshold ${CONSUMPTION_Z}).`,
    evidence: { latestWeek: latest, baselineMedian: med, baselineWeeks: base.length, robustZ: r1(z), threshold: CONSUMPTION_Z },
    recommendedAction: up ? 'Check whether production output, a changed recipe, a data-entry error or scrap explains the increase.' : 'Check whether production was paused or issues were not recorded.',
  };
}

/* ---------- 2. abnormal price increase ---------- */
export interface PriceSeries { material: { id: string; name: string; sku?: string }; observations: { date: Date; price: number }[] }
export const PRICE_INCREASE_PCT = { medium: 10, high: 20, critical: 40 };
export function detectPriceIncrease(i: PriceSeries): RiskCandidate | null {
  const obs = [...i.observations].sort((a, b) => a.date.getTime() - b.date.getTime());
  if (obs.length < 6) return null;
  const latest = obs[obs.length - 1];
  const prior = obs.slice(0, -1).map((o) => o.price);
  const baseline = median(prior.slice(-12));
  const change = pct(latest.price, baseline);
  if (change === null || change < PRICE_INCREASE_PCT.medium) return null;
  const severity: Severity = change >= PRICE_INCREASE_PCT.critical ? 'critical' : change >= PRICE_INCREASE_PCT.high ? 'high' : 'medium';
  const z = robustZ(prior, latest.price);
  return {
    dedupeKey: `price:${i.material.id}:${day(latest.date)}`, category: 'price_increase', severity,
    title: `Price of ${i.material.name} rose ${r1(change)}%`, material: i.material,
    reason: `The latest recorded unit price (${latest.price} on ${day(latest.date)}) is ${r1(change)}% above the median of the previous ${Math.min(prior.length, 12)} observations (${r1(baseline)}). Thresholds: medium ${PRICE_INCREASE_PCT.medium}%, high ${PRICE_INCREASE_PCT.high}%, critical ${PRICE_INCREASE_PCT.critical}%.`,
    evidence: { latestPrice: latest.price, latestDate: day(latest.date), baselineMedian: baseline, changePercent: r1(change), robustZ: z === null ? null : r1(z), observations: obs.length },
    recommendedAction: 'Confirm whether the increase reflects a market move, a specification change or a different supplier before the next order.',
  };
}

/* ---------- 3. unusually high quotation ---------- */
export interface QuoteLine { quotationId: string; rfqNumber?: string; supplier: { id: string; name: string }; material: { id: string; name: string; sku?: string }; unitPrice: number; averagePrice: number | null; peerPrices: number[] }
export const QUOTE_ABOVE_AVG_PCT = { medium: 20, high: 35, critical: 60 };
export function detectHighQuotation(i: QuoteLine): RiskCandidate | null {
  if (!i.averagePrice || i.averagePrice <= 0) return null;
  const change = pct(i.unitPrice, i.averagePrice)!;
  if (change < QUOTE_ABOVE_AVG_PCT.medium) return null;
  const severity: Severity = change >= QUOTE_ABOVE_AVG_PCT.critical ? 'critical' : change >= QUOTE_ABOVE_AVG_PCT.high ? 'high' : 'medium';
  const peers = i.peerPrices.filter((p) => p > 0);
  const peerMedian = peers.length ? median(peers) : null;
  return {
    dedupeKey: `quote:${i.quotationId}:${i.material.id}`, category: 'high_quotation_price', severity,
    title: `${i.supplier.name} quoted ${i.material.name} ${r1(change)}% above its average price`, material: i.material, supplier: i.supplier,
    reference: { kind: 'SupplierQuotation', id: i.quotationId, number: i.rfqNumber },
    reason: `Quoted unit price ${i.unitPrice} is ${r1(change)}% above the material's average purchase price ${i.averagePrice}. Thresholds: medium ${QUOTE_ABOVE_AVG_PCT.medium}%, high ${QUOTE_ABOVE_AVG_PCT.high}%, critical ${QUOTE_ABOVE_AVG_PCT.critical}%.`,
    evidence: { unitPrice: i.unitPrice, averagePrice: i.averagePrice, changePercent: r1(change), peerQuoteMedian: peerMedian, peerQuotes: peers.length },
    recommendedAction: 'Compare with the other quotations on the same RFQ and ask the supplier to explain the price (specification, quantity, delivery terms).',
  };
}

/* ---------- 4. duplicate requisitions ---------- */
export interface ReqLite { id: string; number?: string; department: string; requestedBy: string; createdAt: Date; status: string; items: { material: string; quantity: number }[] }
export const DUPLICATE_REQ_DAYS = 7;
const ACTIVE_REQ = (s: string) => !['Cancelled', 'Rejected'].includes(s);
const reqSig = (r: ReqLite) => r.items.map((x) => `${x.material}:${x.quantity}`).sort().join('|');
export function detectDuplicateRequisitions(reqs: ReqLite[]): RiskCandidate[] {
  const out: RiskCandidate[] = [];
  const live = reqs.filter((r) => ACTIVE_REQ(r.status)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const seen = new Set<string>();
  for (let a = 0; a < live.length; a++) {
    for (let b = a + 1; b < live.length; b++) {
      const x = live[a], y = live[b];
      if ((y.createdAt.getTime() - x.createdAt.getTime()) / DAY_MS > DUPLICATE_REQ_DAYS) break;
      if (x.department !== y.department || reqSig(x) !== reqSig(y)) continue;
      const key = `duprq:${[x.id, y.id].sort().join(':')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        dedupeKey: key, category: 'duplicate_requisition', severity: 'medium',
        title: `Possible duplicate requisitions ${x.number ?? x.id} and ${y.number ?? y.id}`,
        reference: { kind: 'PurchaseRequisition', id: y.id, number: y.number },
        reason: `Both requisitions are from the same department, list the same materials and quantities, and were created ${r1((y.createdAt.getTime() - x.createdAt.getTime()) / DAY_MS)} day(s) apart (window ${DUPLICATE_REQ_DAYS} days).`,
        evidence: { first: x.number ?? x.id, second: y.number ?? y.id, requestedByFirst: x.requestedBy, requestedBySecond: y.requestedBy, lines: x.items.length },
        recommendedAction: 'Confirm with the requester(s) whether both are needed; cancel one if it was submitted twice by mistake.',
      });
    }
  }
  return out;
}

/* ---------- 5. duplicate supplier invoices ---------- */
export interface InvoiceLite { id: string; number: string; invoiceNumber: string; supplier: { id: string; name: string }; total: number; invoiceDate: Date; status: string; matchOk: boolean | null }
/** "INV-0012", "inv 12" and "0012" all normalise to "12": formatting differences must not hide a duplicate. */
export const normaliseInvoiceNumber = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(inv|invoice|bill)/, '').replace(/^0+(?=\d)/, '');
export function detectDuplicateInvoices(invs: InvoiceLite[]): RiskCandidate[] {
  const out: RiskCandidate[] = [];
  const seen = new Set<string>();
  for (let a = 0; a < invs.length; a++) {
    for (let b = a + 1; b < invs.length; b++) {
      const x = invs[a], y = invs[b];
      if (x.supplier.id !== y.supplier.id) continue;
      const sameNo = normaliseInvoiceNumber(x.invoiceNumber) === normaliseInvoiceNumber(y.invoiceNumber);
      const sameAmountDate = x.total === y.total && day(x.invoiceDate) === day(y.invoiceDate);
      if (!sameNo && !sameAmountDate) continue;
      const key = `dupinv:${[x.id, y.id].sort().join(':')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        dedupeKey: key, category: 'duplicate_invoice', severity: sameNo ? 'high' : 'medium',
        title: `Possible duplicate invoice from ${x.supplier.name}`, supplier: x.supplier, reference: { kind: 'Invoice', id: y.id, number: y.number },
        reason: sameNo
          ? `Invoices ${x.number} ("${x.invoiceNumber}") and ${y.number} ("${y.invoiceNumber}") have the same supplier invoice number once formatting is ignored.`
          : `Invoices ${x.number} and ${y.number} are from the same supplier with the same total (${x.total}) and invoice date (${day(x.invoiceDate)}) but different invoice numbers.`,
        evidence: { first: x.number, second: y.number, normalisedNumberMatch: sameNo, sameTotalAndDate: sameAmountDate, total: x.total },
        recommendedAction: 'Check both against the supplier statement and the goods received before verifying either one for payment.',
      });
    }
  }
  return out;
}

/* ---------- 6. unusual inventory adjustments ---------- */
export interface AdjustmentLite { id: string; material: { id: string; name: string; sku?: string }; delta: number; balanceAfter: number; at: Date; by: string; reason: string }
export const ADJUSTMENT_PCT = { medium: 20, high: 50 };
export function detectUnusualAdjustment(a: AdjustmentLite): RiskCandidate | null {
  const before = a.balanceAfter - a.delta;
  const size = Math.abs(a.delta);
  if (size === 0) return null;
  // Against a zero starting balance every adjustment is 100%: judge those as high only when the quantity itself is large.
  const change = before > 0 ? (size / before) * 100 : null;
  if (change === null || change < ADJUSTMENT_PCT.medium) return null;
  return {
    dedupeKey: `adjust:${a.id}`, category: 'unusual_adjustment', severity: change >= ADJUSTMENT_PCT.high ? 'high' : 'medium',
    title: `Large stock adjustment of ${a.material.name}`, material: a.material, reference: { kind: 'StockMovement', id: a.id },
    reason: `A ${a.delta > 0 ? 'increase' : 'decrease'} of ${size} changed the balance from ${before} to ${a.balanceAfter} (${r1(change)}% of the previous balance). Thresholds: medium ${ADJUSTMENT_PCT.medium}%, high ${ADJUSTMENT_PCT.high}%.`,
    evidence: { delta: a.delta, balanceBefore: before, balanceAfter: a.balanceAfter, percentOfBalance: r1(change), recordedReason: a.reason, at: a.at.toISOString(), performedBy: a.by },
    recommendedAction: 'Review the recorded reason against a physical count. Large adjustments are often legitimate (stock-takes), so treat this as a prompt to verify.',
  };
}

/* ---------- 7. delayed purchase orders ---------- */
export interface PoLite { id: string; number: string; status: string; expectedDeliveryDate: Date | null; supplier: { id: string; name: string } }
export const PO_DELAY_DAYS = { medium: 4, high: 15, critical: 31 };
export function detectDelayedPo(po: PoLite, now: Date): RiskCandidate | null {
  if (!['issued', 'partially_received'].includes(po.status) || !po.expectedDeliveryDate) return null;
  const late = Math.floor((now.getTime() - po.expectedDeliveryDate.getTime()) / DAY_MS);
  if (late < 1) return null;
  const severity: Severity = late >= PO_DELAY_DAYS.critical ? 'critical' : late >= PO_DELAY_DAYS.high ? 'high' : late >= PO_DELAY_DAYS.medium ? 'medium' : 'low';
  return {
    // One alert per PO per severity band, so escalation is visible without one alert per day.
    dedupeKey: `po-late:${po.id}:${severity}`, category: 'delayed_po', severity,
    title: `PO ${po.number} is ${late} day(s) overdue`, supplier: po.supplier, reference: { kind: 'PurchaseOrder', id: po.id, number: po.number },
    reason: `The order is ${po.status.replace('_', ' ')} and was expected on ${day(po.expectedDeliveryDate)}; it is now ${late} day(s) past that date. Bands: 1-3 low, ${PO_DELAY_DAYS.medium}-14 medium, ${PO_DELAY_DAYS.high}-30 high, ${PO_DELAY_DAYS.critical}+ critical.`,
    evidence: { expectedDeliveryDate: day(po.expectedDeliveryDate), daysLate: late, status: po.status },
    recommendedAction: 'Contact the supplier for a revised delivery date and check whether production plans depend on this order.',
  };
}

/* ---------- 8. supplier quality deterioration ---------- */
export interface ReceiptLite { id: string; at: Date; accepted: number; rejected: number }
export const QUALITY = { recent: 3, minReceipts: 6, dropMedium: 10, dropHigh: 20, floor: 95 };
export function detectQualityDeterioration(supplier: { id: string; name: string }, receipts: ReceiptLite[]): RiskCandidate | null {
  const r = [...receipts].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (r.length < QUALITY.minReceipts) return null;
  const rate = (xs: ReceiptLite[]) => { const t = xs.reduce((s, x) => s + x.accepted + x.rejected, 0); return t === 0 ? null : (xs.reduce((s, x) => s + x.accepted, 0) / t) * 100; };
  const recent = rate(r.slice(-QUALITY.recent)), earlier = rate(r.slice(0, -QUALITY.recent));
  if (recent === null || earlier === null) return null;
  const drop = earlier - recent;
  if (drop < QUALITY.dropMedium || recent >= QUALITY.floor) return null;
  const last = r[r.length - 1];
  return {
    dedupeKey: `quality:${supplier.id}:${last.id}`, category: 'supplier_quality', severity: drop >= QUALITY.dropHigh ? 'high' : 'medium',
    title: `Acceptance rate of ${supplier.name} has fallen`, supplier,
    reason: `Accepted quantity over the last ${QUALITY.recent} receipts is ${r1(recent)}%, down ${r1(drop)} points from ${r1(earlier)}% across earlier receipts. Thresholds: drop of ${QUALITY.dropMedium} points (medium) or ${QUALITY.dropHigh} (high), and recent rate below ${QUALITY.floor}%.`,
    evidence: { recentAcceptancePercent: r1(recent), earlierAcceptancePercent: r1(earlier), dropPoints: r1(drop), receiptsConsidered: r.length },
    recommendedAction: 'Review the rejection reasons on the latest receipts and raise them with the supplier before the next award.',
  };
}

/* ---------- 9. unexpected delivery delays (supplier-level pattern) ---------- */
export const DELIVERY = { minOrders: 5, onTimeMedium: 80, onTimeHigh: 60 };
export function detectSupplierDelivery(s: { id: string; name: string; completedOrders: number; onTimeDeliveries: number }): RiskCandidate | null {
  if (s.completedOrders < DELIVERY.minOrders) return null;
  const rate = (s.onTimeDeliveries / s.completedOrders) * 100;
  if (rate >= DELIVERY.onTimeMedium) return null;
  return {
    dedupeKey: `delivery:${s.id}:${Math.floor(rate / 5) * 5}`, category: 'supplier_delivery', severity: rate < DELIVERY.onTimeHigh ? 'high' : 'medium',
    title: `${s.name} delivers on time in only ${r1(rate)}% of orders`, supplier: { id: s.id, name: s.name },
    reason: `${s.onTimeDeliveries} of ${s.completedOrders} completed orders arrived by the expected date. Thresholds: below ${DELIVERY.onTimeMedium}% (medium), below ${DELIVERY.onTimeHigh}% (high), with at least ${DELIVERY.minOrders} orders.`,
    evidence: { completedOrders: s.completedOrders, onTimeDeliveries: s.onTimeDeliveries, onTimePercent: r1(rate) },
    recommendedAction: 'Account for the lead-time risk when planning orders, and discuss delivery performance with the supplier.',
  };
}

/* ---------- 10. repeated invoice mismatches ---------- */
export const MISMATCH = { windowDays: 90, medium: 3, high: 5 };
export function detectRepeatedMismatch(supplier: { id: string; name: string }, invs: InvoiceLite[], now: Date): RiskCandidate | null {
  const since = now.getTime() - MISMATCH.windowDays * DAY_MS;
  const bad = invs.filter((i) => i.invoiceDate.getTime() >= since && i.matchOk === false);
  if (bad.length < MISMATCH.medium) return null;
  return {
    dedupeKey: `mismatch:${supplier.id}:${bad.length >= MISMATCH.high ? 'high' : 'medium'}`, category: 'repeated_mismatch', severity: bad.length >= MISMATCH.high ? 'high' : 'medium',
    title: `${bad.length} invoices from ${supplier.name} failed the three-way match`, supplier,
    reason: `${bad.length} invoices dated in the last ${MISMATCH.windowDays} days did not match the purchase order and accepted goods. Thresholds: ${MISMATCH.medium} (medium), ${MISMATCH.high} (high).`,
    evidence: { invoices: bad.map((b) => b.number), windowDays: MISMATCH.windowDays },
    recommendedAction: 'Look for a common cause (price list out of date, quantities billed before delivery) and agree a correction with the supplier.',
  };
}

/* ---------- review workflow ---------- */
export const RISK_STATUSES = ['open', 'acknowledged', 'investigating', 'resolved', 'dismissed'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];
export const RISK_TRANSITIONS: Record<RiskStatus, RiskStatus[]> = {
  open: ['acknowledged', 'investigating', 'dismissed'],
  acknowledged: ['investigating', 'resolved', 'dismissed'],
  investigating: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
};
export const canTransitionRisk = (from: RiskStatus, to: RiskStatus) => RISK_TRANSITIONS[from]?.includes(to) ?? false;
/** Closing an alert needs a written outcome so the decision can be audited later. */
export const NOTE_REQUIRED: RiskStatus[] = ['resolved', 'dismissed'];
