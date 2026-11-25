import { z } from 'zod';
import { env } from '../config/environment';
import { AppError } from '../utils/apiResponse';

/** Thrown when the ML service cannot be reached or answers badly. Business operations never depend on it. */
export class MlUnavailableError extends AppError {
  constructor(detail: string) { super(503, `The forecasting service is unavailable: ${detail}`, 'ML_UNAVAILABLE'); }
}

const interval = z.object({ level: z.number(), method: z.string() });
const base = { modelVersion: z.string(), isForecast: z.literal(true) };
const insufficient = z.object({ ...base, status: z.literal('insufficient_data'), reason: z.string() }).passthrough();

export const demandResponse = z.union([
  insufficient,
  z.object({
    ...base, status: z.literal('ok'), selectedModel: z.string(), historyWeeks: z.number(), historyStart: z.string(), historyEnd: z.string(), history: z.array(z.number()),
    candidates: z.array(z.object({ model: z.string(), status: z.string() }).passthrough()),
    horizons: z.array(z.object({ days: z.number(), total: z.number(), low: z.number(), high: z.number() })),
    weekly: z.array(z.object({ weekStart: z.string(), point: z.number(), low: z.number(), high: z.number() })),
    interval, notes: z.array(z.string()),
  }).passthrough(),
]);
export const priceResponse = z.union([
  insufficient,
  z.object({
    ...base, status: z.literal('ok'), method: z.string(), observations: z.number(), spanDays: z.number(), lastPrice: z.number(), slopePerDay: z.number(), r2: z.number(),
    horizons: z.array(z.object({ days: z.number(), price: z.number(), low: z.number(), high: z.number(), changePercent: z.number().nullable() })),
    interval, notes: z.array(z.string()),
  }).passthrough(),
]);
export type DemandResult = z.infer<typeof demandResponse>;
export type PriceResult = z.infer<typeof priceResponse>;

async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  if (!env.ML_INTERNAL_KEY) throw new MlUnavailableError('ML_INTERNAL_KEY is not configured on the backend');
  let res: Response;
  try {
    res = await fetch(`${env.ML_SERVICE_URL}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': env.ML_INTERNAL_KEY },
      body: JSON.stringify(body), signal: AbortSignal.timeout(env.ML_TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new MlUnavailableError(e?.name === 'TimeoutError' ? 'it did not answer in time' : 'it could not be reached');
  }
  if (!res.ok) throw new MlUnavailableError(`it answered with status ${res.status}`);
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new MlUnavailableError('it returned an unexpected response');
  return parsed.data;
}

export const requestDemandForecast = (points: { date: string; value: number }[], asOf: string) => post('/v1/forecast/demand', { points, asOf }, demandResponse);
export const requestPriceForecast = (points: { date: string; value: number }[], asOf: string) => post('/v1/forecast/price', { points, asOf }, priceResponse);
