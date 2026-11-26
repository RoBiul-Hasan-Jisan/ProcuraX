/**
 * Built-in forecasting: runs inside the backend, needs no Python service, no paid API and no network.
 * It is a TypeScript port of the simple models in the ML service (ml/app): moving average and simple exponential
 * smoothing for demand (the one with the lowest rolling-origin backtest RMSE wins), and a linear trend for price.
 * The tree-based models (random forest, XGBoost) exist only in the Python service and are reported as "skipped" here.
 * Output has the same shape as the ML service so the rest of the app does not care which one answered.
 */
const DAY = 86_400_000;
export const BUILTIN_MODEL_VERSION = '2026.11-1-builtin';
const MIN_HISTORY_WEEKS = 8;
const HORIZONS = [7, 30, 60, 90];
const Z80 = 1.2816;
const MIN_WEEKS: Record<string, number> = { moving_average: 6, exponential_smoothing: 8 };

type Point = { date: string; value: number };
const day = (s: string) => Math.floor(Date.parse(`${s.slice(0, 10)}T00:00:00Z`) / DAY);
const iso = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

/** Same bucketing as the ML service: last bucket ends on `end`; a partly covered oldest bucket is dropped; nothing after `end` is used. */
export function toWeekly(points: Point[], endIso?: string): { start: string; series: number[] } {
  if (!points.length) return { start: endIso ?? iso(Math.floor(Date.now() / DAY)), series: [] };
  const last = endIso ? day(endIso) : Math.max(...points.map((p) => day(p.date)));
  const first = Math.min(...points.map((p) => day(p.date)));
  let nWeeks = last >= first ? Math.floor((last - first) / 7) + 1 : 0;
  let totals = new Array<number>(nWeeks).fill(0);
  for (const p of points) {
    const age = last - day(p.date);
    if (age < 0) continue;
    const k = Math.floor(age / 7);
    if (k < nWeeks) totals[nWeeks - 1 - k] += p.value;
  }
  let start = last - (7 * nWeeks - 1);
  if (start < first && nWeeks > 1) { totals = totals.slice(1); start += 7; nWeeks -= 1; }
  return { start: iso(start), series: totals };
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
type Fn = (train: number[], steps: number) => number[];

export const movingAverage: Fn = (train, steps) => Array(steps).fill(mean(train.slice(-Math.min(4, train.length))));
function sesLevel(train: number[], alpha: number) {
  let level = train[0], sse = 0;
  for (const y of train.slice(1)) { sse += (y - level) ** 2; level = alpha * y + (1 - alpha) * level; }
  return { level, sse };
}
export const exponentialSmoothing: Fn = (train, steps) => {
  let best = { sse: Infinity, alpha: 0.1 };
  for (let i = 0; i < 9; i++) { const alpha = 0.1 + i * 0.1; const { sse } = sesLevel(train, alpha); if (sse < best.sse) best = { sse, alpha }; }
  return Array(steps).fill(sesLevel(train, best.alpha).level);
};
const MODELS: Record<string, Fn> = { moving_average: movingAverage, exponential_smoothing: exponentialSmoothing };

function backtest(fn: Fn, series: number[], minTrain: number, maxFolds = 8) {
  const n = series.length, folds = Math.min(maxFolds, n - minTrain);
  if (folds < 3) return null;
  const err: number[] = [], actual: number[] = [];
  for (let t = n - folds; t < n; t++) { err.push(series[t] - fn(series.slice(0, t), 1)[0]); actual.push(series[t]); }
  const mae = mean(err.map(Math.abs)), rmse = Math.sqrt(mean(err.map((e) => e * e)));
  const mape = actual.every((a) => a !== 0) ? mean(err.map((e, i) => Math.abs(e) / Math.abs(actual[i]))) * 100 : null;
  const m = mean(err);
  const std = folds > 1 ? Math.sqrt(err.reduce((s, e) => s + (e - m) ** 2, 0) / (folds - 1)) : 0;
  return { mae, rmse, mape, folds, residual_std: std };
}

function horizonTotal(weekly: number[], days: number) {
  const weeks = Math.ceil(days / 7);
  return weekly.slice(0, weeks - 1).reduce((s, x) => s + x, 0) + (weekly[weeks - 1] * (days - 7 * (weeks - 1))) / 7;
}

export function builtinDemandForecast(points: Point[], asOf: string): any {
  const { start, series } = toWeekly(points, asOf);
  const base = { modelVersion: BUILTIN_MODEL_VERSION, isForecast: true as const, historyWeeks: series.length, unit: 'per_week', engine: 'builtin' };
  if (series.length < MIN_HISTORY_WEEKS) return { ...base, status: 'insufficient_data', reason: `Need at least ${MIN_HISTORY_WEEKS} weeks of history; found ${series.length}.` };
  if (series.reduce((s, x) => s + x, 0) === 0) return { ...base, status: 'insufficient_data', reason: 'No consumption recorded in the history window.' };

  const candidates: any[] = [];
  const usable: { name: string; fn: Fn; bt: NonNullable<ReturnType<typeof backtest>> }[] = [];
  for (const [name, fn] of Object.entries(MODELS)) {
    if (series.length < MIN_WEEKS[name]) { candidates.push({ model: name, status: 'skipped', reason: `needs ${MIN_WEEKS[name]} weeks of history, have ${series.length}` }); continue; }
    const bt = backtest(fn, series, Math.max(MIN_WEEKS[name], 6));
    if (!bt) { candidates.push({ model: name, status: 'skipped', reason: 'not enough history left for backtesting' }); continue; }
    candidates.push({ model: name, status: 'evaluated', ...bt });
    usable.push({ name, fn, bt });
  }
  for (const name of ['random_forest', 'xgboost']) candidates.push({ model: name, status: 'skipped', reason: 'not available in built-in mode (needs the Python ML service)' });
  if (!usable.length) return { ...base, status: 'insufficient_data', reason: 'History too short to backtest any model.' };

  const best = usable.reduce((a, b) => (Math.round(b.bt.rmse * 1e9) < Math.round(a.bt.rmse * 1e9) ? b : a)); // ties keep the simpler (earlier) model
  const steps = Math.ceil(Math.max(...HORIZONS) / 7);
  const weekly = best.fn(series, steps);
  const std = best.bt.residual_std;
  return {
    ...base, status: 'ok', selectedModel: best.name, candidates,
    horizons: HORIZONS.map((h) => { const total = horizonTotal(weekly, h), band = Z80 * std * Math.sqrt(Math.ceil(h / 7)); return { days: h, total, low: Math.max(0, total - band), high: total + band }; }),
    weekly: weekly.map((p, i) => ({ weekStart: iso(day(asOf) + 1 + 7 * i), point: p, low: Math.max(0, p - Z80 * std), high: p + Z80 * std })),
    historyStart: start, historyEnd: asOf, history: series,
    interval: { level: 0.8, method: 'normal approximation from backtest residuals; indicative only' },
    notes: ['This is a forecast, not an actual value.', 'Computed by the built-in forecaster (moving average / exponential smoothing); no external service or API is used.'],
  };
}

export function builtinPriceForecast(points: Point[], asOf: string): any {
  const base = { modelVersion: BUILTIN_MODEL_VERSION, isForecast: true as const, engine: 'builtin' };
  const obs = [...points].sort((a, b) => day(a.date) - day(b.date));
  if (obs.length < 6) return { ...base, status: 'insufficient_data', reason: `Need at least 6 price observations; found ${obs.length}.` };
  const span = day(obs[obs.length - 1].date) - day(obs[0].date);
  if (span < 60) return { ...base, status: 'insufficient_data', reason: `Observations span ${span} days; need at least 60.` };
  const t0 = day(obs[0].date), x = obs.map((o) => day(o.date) - t0), y = obs.map((o) => o.value), n = x.length;
  const mx = mean(x), my = mean(y);
  const sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0);
  const slope = sxx > 0 ? x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / sxx : 0, intercept = my - slope * mx;
  const sse = y.reduce((s, v, i) => s + (v - (slope * x[i] + intercept)) ** 2, 0), sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const s = Math.sqrt(sse / (n - 2)), r2 = sst > 0 ? 1 - sse / sst : 0, last = y[n - 1], xa = day(asOf) - t0;
  return {
    ...base, status: 'ok', method: 'linear_trend', observations: n, spanDays: span, lastPrice: last, slopePerDay: slope, r2, residualStd: s,
    horizons: [30, 60, 90].map((h) => {
      const xf = xa + h, pred = slope * xf + intercept, se = sxx > 0 ? s * Math.sqrt(1 + 1 / n + (xf - mx) ** 2 / sxx) : s;
      return { days: h, price: Math.max(pred, 0), low: Math.max(pred - Z80 * se, 0), high: pred + Z80 * se, changePercent: last ? ((pred - last) / last) * 100 : null };
    }),
    interval: { level: 0.8, method: 'normal approximation (t-value approximated as 1.28); indicative only' },
    notes: ['Price estimate, not a guaranteed future price.', 'Trend is extrapolated from history and ignores market events. Computed by the built-in forecaster; no external service is used.'],
  };
}
