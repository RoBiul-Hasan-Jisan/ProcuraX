import { RFQ } from '../models/RFQ';
import { Material } from '../models/Material';
import { Supplier } from '../models/Supplier';
import { SupplierQuotation } from '../models/SupplierQuotation';
import { getSetting, putSetting } from '../models/Setting';
import { dec, str } from '../domain/money';
import { DEFAULT_WEIGHTS, normalizeWeights, scoreQuotations, type ScoreWeights } from '../domain/scoring';
import { badRequest, conflict, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';
import { notify } from './notifier';
import { audit } from './auditService';

/** Quotations that are this much above the material's average purchase price are flagged for review. */
const PRICE_FLAG_PERCENT = 20;

export const getScoringWeights = () => getSetting<ScoreWeights>('scoring', DEFAULT_WEIGHTS);
export async function setScoringWeights(w: ScoreWeights) {
  normalizeWeights(w); // validates
  await putSetting('scoring', w);
  return w;
}

/** Sealed-bid rule: quotations can be opened only after the deadline or once the RFQ is closed/awarded. */
export const isOpenedForComparison = (rfq: { status: string; deadline: Date }) => rfq.status !== 'open' || rfq.deadline.getTime() <= Date.now();

export async function getComparison(rfqId: string, weightsOverride?: ScoreWeights) {
  const rfq = await RFQ.findById(rfqId).lean();
  if (!rfq) throw notFound('RFQ not found');
  if (rfq.status === 'cancelled') throw conflict('This RFQ was cancelled');
  if (!isOpenedForComparison(rfq)) {
    throw conflict('Quotations are sealed until the submission deadline passes or the RFQ is closed');
  }
  const weights = weightsOverride ?? (await getScoringWeights());
  const quotes = await SupplierQuotation.find({ rfq: rfqId, status: { $ne: 'withdrawn' } }).lean();
  const suppliers = await Supplier.find({ _id: { $in: quotes.map((q) => q.supplier) } }).lean();
  const sById = new Map(suppliers.map((s) => [String(s._id), s]));
  const materials = await Material.find({ _id: { $in: rfq.items.map((i: any) => i.material) } }).lean();
  const avgPrice = new Map(materials.map((m) => [String(m._id), m.averagePurchasePrice ? dec(m.averagePurchasePrice as any) : null]));

  const scored = scoreQuotations(
    quotes.map((q) => {
      const s = sById.get(String(q.supplier))!;
      return {
        quotationId: String(q._id), supplierId: String(q.supplier), supplierName: s.companyName,
        totalLandedCost: dec(q.totalLandedCost as any), deliveryDays: q.deliveryDays, paymentTermsDays: q.paymentTermsDays ?? 0,
        history: {
          completedOrders: s.history?.completedOrders ?? 0, onTimeDeliveries: s.history?.onTimeDeliveries ?? 0,
          unitsReceived: s.history?.unitsReceived ?? 0, unitsAccepted: s.history?.unitsAccepted ?? 0,
        },
      };
    }),
    weights,
  );
  const scoreById = new Map(scored.map((s) => [s.quotationId, s]));

  const rows = quotes.map((q) => {
    const s = sById.get(String(q.supplier))!;
    const sc = scoreById.get(String(q._id))!;
    const h = s.history ?? ({} as any);
    return {
      quotationId: String(q._id), supplierId: String(q.supplier), supplierName: s.companyName, status: q.status,
      verificationStatus: s.verificationStatus,
      unitPrices: q.lines.map((l: any) => {
        const ref = avgPrice.get(String(l.material)) ?? null;
        const up = dec(l.unitPrice);
        const vsAvg = ref && ref.gt(0) ? up.minus(ref).div(ref).mul(100).toDecimalPlaces(1).toNumber() : null;
        return {
          materialId: String(l.material), materialName: l.materialName, unitPrice: str(l.unitPrice),
          averagePurchasePrice: ref ? str(ref) : null, percentVsAverage: vsAvg, flagged: vsAvg !== null && vsAvg > PRICE_FLAG_PERCENT,
        };
      }),
      materialCost: str(q.materialCost), transportCost: str(q.transportCost), additionalCharges: str(q.additionalCharges),
      taxAmount: str(q.taxAmount), totalLandedCost: str(q.totalLandedCost),
      deliveryDays: q.deliveryDays, paymentTerms: q.paymentTerms, validUntil: q.validUntil,
      expired: q.validUntil.getTime() < Date.now(),
      quality: {
        completedOrders: h.completedOrders ?? 0,
        onTimeRate: h.completedOrders ? Math.round((h.onTimeDeliveries / h.completedOrders) * 1000) / 10 : null,
        qualityAcceptanceRate: h.unitsReceived ? Math.round((h.unitsAccepted / h.unitsReceived) * 1000) / 10 : null,
      },
      evaluation: {
        scores: sc.scores, overall: sc.overall, rank: sc.rank, insufficientHistory: sc.insufficientHistory, reasons: sc.reasons,
        costDifference: str(sc.costDifference), costDifferencePercent: sc.costDifferencePercent, deliveryDifferenceDays: sc.deliveryDifferenceDays,
      },
    };
  }).sort((a, b) => a.evaluation.rank - b.evaluation.rank);

  return {
    rfq: { id: String(rfq._id), number: rfq.number, status: rfq.status, deadline: rfq.deadline, award: rfq.award?.quotation ? { quotationId: String(rfq.award.quotation) } : null },
    weights: normalizeWeights(weights), rawWeights: weights,
    advisory: 'Scores and ranks are decision support only. A procurement manager must select the supplier manually.',
    rows,
  };
}

/** Manual supplier selection. Nothing in the scoring code calls this. */
export async function awardRfq(user: UserContext, rfqId: string, quotationId: string, justification: string) {
  const rfq = await RFQ.findById(rfqId).lean();
  if (!rfq) throw notFound('RFQ not found');
  if (!isOpenedForComparison(rfq)) throw conflict('Quotations are sealed. Close the RFQ or wait for the deadline before selecting a supplier.');
  if (!['open', 'closed'].includes(rfq.status)) throw conflict(`An RFQ in status "${rfq.status}" cannot be awarded`);

  const quote = await SupplierQuotation.findOne({ _id: quotationId, rfq: rfqId }).lean();
  if (!quote) throw notFound('Quotation not found for this RFQ');
  if (quote.status !== 'submitted') throw conflict(`A ${quote.status} quotation cannot be selected`);
  if (quote.validUntil.getTime() < Date.now()) throw badRequest('This quotation has expired. Ask the supplier to renew it before awarding.');

  const comparison = await getComparison(rfqId);
  const top = comparison.rows[0];
  const overrodeTopRank = top.quotationId !== quotationId;
  if (overrodeTopRank && justification.trim().length < 10) {
    throw badRequest('A justification (at least 10 characters) is required when selecting a quotation that is not the top-ranked one');
  }

  // Atomic gate: only one award can succeed even if two managers click at once.
  const gate = await RFQ.findOneAndUpdate(
    { _id: rfqId, status: { $in: ['open', 'closed'] } },
    { $set: { status: 'awarded', award: { quotation: quote._id, supplier: quote.supplier, awardedBy: user.id, awardedByName: user.displayName, awardedAt: new Date(), justification: justification.trim(), overrodeTopRank } } },
    { new: true },
  );
  if (!gate) throw conflict('This RFQ was already awarded');
  await SupplierQuotation.updateOne({ _id: quote._id }, { $set: { status: 'awarded' } });
  await SupplierQuotation.updateMany({ rfq: rfqId, _id: { $ne: quote._id }, status: 'submitted' }, { $set: { status: 'not_selected' } });
  await notify.supplierAwarded(gate, String(quote.supplier));
  await audit(user, { action: 'supplier.awarded', entityType: 'RFQ', entityId: rfqId, entityNumber: gate.number, summary: overrodeTopRank ? `Selected a supplier that was not top-ranked: ${justification.trim()}` : 'Selected the top-ranked supplier', before: { status: rfq.status }, after: { status: 'awarded', quotation: String(quote._id), supplier: String(quote.supplier), overrodeTopRank, justification: justification.trim() } });
  return getComparison(rfqId);
}
