import { Material } from '../models/Material';
import { StockMovement } from '../models/StockMovement';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { PriceObservation } from '../models/PriceObservation';
import { DemandForecast, PriceForecast } from '../models/Forecast';
import { toDaily, weeklyTotals, isoDay } from '../domain/series';
import { requestDemandForecast, requestPriceForecast } from './mlClient';
import { notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';
import { audit } from './auditService';

const HISTORY_DAYS = 400;

/** Actual consumption = stock issued to production. Adjustments and transfers are not consumption. */
export async function consumptionPoints(materialId: string, now = new Date()) {
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const rows: any[] = await StockMovement.find({ material: materialId, type: 'issue', createdAt: { $gte: since, $lte: now } }).select('delta createdAt').lean();
  return rows.map((r) => ({ date: new Date(r.createdAt), value: Math.abs(Number(r.delta.toString())) }));
}

/** Unit-price history: recorded observations plus issued purchase orders. */
export async function priceObservations(materialId: string) {
  const [obs, pos]: [any[], any[]] = await Promise.all([
    PriceObservation.find({ material: materialId }).sort({ observedAt: 1 }).lean() as any,
    PurchaseOrder.find({ 'lines.material': materialId, status: { $in: ['issued', 'partially_received', 'received', 'closed'] }, issuedAt: { $ne: null } }).select('lines issuedAt number').lean() as any,
  ]);
  const out = obs.map((o) => ({ date: new Date(o.observedAt), price: Number(o.unitPrice.toString()), source: o.source as string }));
  for (const po of pos) for (const l of po.lines) if (String(l.material) === String(materialId)) out.push({ date: new Date(po.issuedAt), price: Number(l.unitPrice.toString()), source: `PO ${po.number}` });
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function loadMaterial(id: string) {
  const m: any = await Material.findById(id).lean();
  if (!m) throw notFound('Material not found');
  return m;
}
const meta = (m: any) => ({ material: m._id, sku: m.sku, materialName: m.name, unit: m.unit });

export async function runDemandForecast(user: UserContext, materialId: string, now = new Date()) {
  const m = await loadMaterial(materialId);
  const daily = toDaily(await consumptionPoints(materialId, now));
  const result = await requestDemandForecast(daily.map((d) => ({ date: d.date, value: d.value })), isoDay(now));
  const doc: any = await DemandForecast.create({
    ...meta(m), status: result.status, reason: result.status === 'ok' ? undefined : (result as any).reason, modelVersion: result.modelVersion, selectedModel: result.status === 'ok' ? (result as any).selectedModel : undefined,
    asOf: now, result, generatedBy: user.id, generatedByName: user.displayName ?? user.email,
  });
  await audit(user, { action: 'forecast.generated', entityType: 'Material', entityId: materialId, entityNumber: m.sku, summary: `Generated a demand forecast (${result.status})`, after: { kind: 'demand', status: result.status, modelVersion: result.modelVersion } });
  return presentForecast(doc);
}

export async function runPriceForecast(user: UserContext, materialId: string, now = new Date()) {
  const m = await loadMaterial(materialId);
  const obs = await priceObservations(materialId);
  const result = await requestPriceForecast(obs.map((o) => ({ date: isoDay(o.date), value: o.price })), isoDay(now));
  const doc: any = await PriceForecast.create({
    ...meta(m), status: result.status, reason: result.status === 'ok' ? undefined : (result as any).reason, modelVersion: result.modelVersion, method: result.status === 'ok' ? (result as any).method : undefined,
    asOf: now, result, generatedBy: user.id, generatedByName: user.displayName ?? user.email,
  });
  await audit(user, { action: 'forecast.generated', entityType: 'Material', entityId: materialId, entityNumber: m.sku, summary: `Generated a price forecast (${result.status})`, after: { kind: 'price', status: result.status, modelVersion: result.modelVersion } });
  return presentForecast(doc);
}

function presentForecast(d: any) {
  return { id: String(d._id), material: String(d.material), sku: d.sku, materialName: d.materialName, unit: d.unit, status: d.status, reason: d.reason ?? null, modelVersion: d.modelVersion,
    isForecast: true, asOf: d.asOf, createdAt: d.createdAt, generatedByName: d.generatedByName ?? null, result: d.result };
}

/** Everything the forecasting page needs for one material: actual history, latest forecasts, price history. Actuals and predictions are kept apart. */
export async function materialForecastView(materialId: string, now = new Date()) {
  const m = await loadMaterial(materialId);
  const [points, prices, demand, price]: [any, any, any, any] = await Promise.all([
    consumptionPoints(materialId, now), priceObservations(materialId),
    DemandForecast.findOne({ material: materialId }).sort({ createdAt: -1 }).lean(),
    PriceForecast.findOne({ material: materialId }).sort({ createdAt: -1 }).lean(),
  ]);
  const w = weeklyTotals(points, now);
  return {
    material: { id: String(m._id), sku: m.sku, name: m.name, unit: m.unit },
    actualConsumption: { kind: 'actual', weekStart: w.start, weeks: w.weeks },
    priceHistory: { kind: 'actual', observations: prices.map((p: any) => ({ date: isoDay(p.date), price: p.price, source: p.source })) },
    demandForecast: demand ? presentForecast(demand) : null,
    priceForecast: price ? presentForecast(price) : null,
  };
}

export async function listForecasts(q: { page: number; limit: number; kind: 'demand' | 'price' }) {
  const Model: any = q.kind === 'price' ? PriceForecast : DemandForecast;
  const [items, total] = await Promise.all([
    Model.find().sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Model.countDocuments(),
  ]);
  return { items: items.map(presentForecast), total };
}
