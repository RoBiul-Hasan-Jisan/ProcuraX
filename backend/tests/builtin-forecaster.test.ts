import { builtinDemandForecast, builtinPriceForecast, toWeekly } from '../src/services/builtinForecaster';

const d = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
const daily = (days: number, f: (i: number) => number) => Array.from({ length: days }, (_, i) => ({ date: d(i), value: f(i) }));

describe('built-in demand forecast', () => {
  it('buckets into complete weeks ending on the as-of date and ignores later data', () => {
    const pts = daily(28, () => 1).concat([{ date: d(40), value: 999 }]);
    const { series } = toWeekly(pts, d(27));
    expect(series).toEqual([7, 7, 7, 7]);
  });
  it('refuses to forecast with under 8 weeks of history, and says why', () => {
    const r = builtinDemandForecast(daily(40, () => 5), d(39));
    expect(r.status).toBe('insufficient_data');
    expect(r.reason).toMatch(/8 weeks/);
  });
  it('refuses when nothing was consumed', () => {
    expect(builtinDemandForecast(daily(120, () => 0), d(119)).status).toBe('insufficient_data');
  });
  it('forecasts a steady series close to its level, with ordered bands and honest candidate list', () => {
    const r = builtinDemandForecast(daily(140, () => 10), d(139));
    expect(r.status).toBe('ok');
    expect(r.isForecast).toBe(true);
    expect(r.horizons.find((h: any) => h.days === 7).total).toBeCloseTo(70, 6);
    expect(r.horizons.find((h: any) => h.days === 30).total).toBeCloseTo(300, 6);
    for (const h of r.horizons) { expect(h.low).toBeLessThanOrEqual(h.total); expect(h.high).toBeGreaterThanOrEqual(h.total); expect(h.low).toBeGreaterThanOrEqual(0); }
    const names = r.candidates.map((c: any) => `${c.model}:${c.status}`);
    expect(names).toEqual(expect.arrayContaining(['moving_average:evaluated', 'exponential_smoothing:evaluated', 'random_forest:skipped', 'xgboost:skipped']));
    expect(r.engine).toBe('builtin');
  });
  it('picks the model with the lowest backtest RMSE', () => {
    const r = builtinDemandForecast(daily(210, (i) => 10 + Math.floor(i / 7) * 0.5 + (i % 3)), d(209));
    const ev = r.candidates.filter((c: any) => c.status === 'evaluated');
    const min = Math.min(...ev.map((c: any) => c.rmse));
    expect(ev.find((c: any) => c.model === r.selectedModel).rmse).toBe(min);
  });
  it('never uses data after the as-of date', () => {
    const base = daily(120, (i) => 5 + (i % 7));
    const a = builtinDemandForecast(base, d(119));
    const b = builtinDemandForecast([...base, ...daily(30, () => 9999).map((p, i) => ({ date: d(120 + i), value: p.value }))], d(119));
    expect(b.horizons).toEqual(a.horizons);
  });
});

describe('built-in price forecast', () => {
  it('needs 6 observations over 60 days', () => {
    expect(builtinPriceForecast([{ date: d(0), value: 1 }], d(1)).status).toBe('insufficient_data');
    const short = [0, 5, 10, 15, 20, 25].map((n) => ({ date: d(n), value: 100 + n }));
    expect(builtinPriceForecast(short, d(25)).reason).toMatch(/span/);
  });
  it('recovers an exact linear trend', () => {
    const pts = [0, 20, 40, 60, 80, 100].map((n) => ({ date: d(n), value: 100 + 0.5 * n }));
    const r = builtinPriceForecast(pts, d(100));
    expect(r.status).toBe('ok');
    expect(r.slopePerDay).toBeCloseTo(0.5, 9);
    expect(r.r2).toBeCloseTo(1, 9);
    expect(r.horizons[0].price).toBeCloseTo(165, 6);
    expect(r.horizons[0].changePercent).toBeCloseTo(((165 - 150) / 150) * 100, 6);
  });
});

describe('engine selection', () => {
  const load = (env: Record<string, string>) => { jest.resetModules(); Object.assign(process.env, { ML_MODE: undefined, ML_INTERNAL_KEY: undefined }); delete process.env.ML_MODE; delete process.env.ML_INTERNAL_KEY; Object.assign(process.env, env); return require('../src/services/mlClient'); };
  const pts = daily(140, () => 10);
  afterEach(() => { delete process.env.ML_MODE; delete process.env.ML_INTERNAL_KEY; jest.restoreAllMocks(); });
  it('uses the built-in forecaster when no key is configured, without any network call', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const ml = load({});
    const r = await ml.requestDemandForecast(pts, d(139));
    expect(r.status).toBe('ok');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('builtin mode ignores a configured key', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const ml = load({ ML_MODE: 'builtin', ML_INTERNAL_KEY: 'k'.repeat(20) });
    expect((await ml.requestDemandForecast(pts, d(139))).status).toBe('ok');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('auto mode falls back to builtin when the service is down; service mode does not', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await load({ ML_INTERNAL_KEY: 'k'.repeat(20) }).requestDemandForecast(pts, d(139))).engine).toBe('builtin');
    await expect(load({ ML_MODE: 'service', ML_INTERNAL_KEY: 'k'.repeat(20) }).requestDemandForecast(pts, d(139))).rejects.toThrow(/unavailable/);
  });
});
