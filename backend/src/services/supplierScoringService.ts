import { Supplier } from '../models/Supplier';
import { MIN_HISTORY_ORDERS } from '../domain/scoring';
import { getScoringWeights } from './comparisonService';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Recorded supplier performance (not a quotation score). Unproven suppliers show no history score at all. */
export async function supplierScoring() {
  const [suppliers, weights]: [any[], any] = await Promise.all([Supplier.find({ status: { $ne: 'blocked' } }).sort({ companyName: 1 }).lean() as any, getScoringWeights()]);
  const rows = suppliers.map((s) => {
    const h = s.history ?? {};
    const orders = h.completedOrders ?? 0;
    const proven = orders >= MIN_HISTORY_ORDERS;
    const onTime = orders ? (h.onTimeDeliveries / orders) * 100 : null;
    const quality = h.unitsReceived ? (h.unitsAccepted / h.unitsReceived) * 100 : null;
    return {
      supplierId: String(s._id), code: s.supplierCode, name: s.companyName, status: s.status, verification: s.verificationStatus, completedOrders: orders,
      onTimePercent: onTime === null ? null : r1(onTime), qualityPercent: quality === null ? null : r1(quality), proven,
      // History score = mean of on-time and quality, shown only when proven
      historyScore: proven && onTime !== null && quality !== null ? r1((onTime + quality) / 2) : null,
      note: proven ? null : `Only ${orders} completed order(s); at least ${MIN_HISTORY_ORDERS} are needed before reliability is rated.`,
    };
  });
  rows.sort((a, b) => (b.historyScore ?? -1) - (a.historyScore ?? -1));
  return { minHistoryOrders: MIN_HISTORY_ORDERS, weights, rows };
}
