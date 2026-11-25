import type { WeeklyForecast } from "@/types/intelligence";

export interface ChartPoint { label: string; actual: number | null; forecast: number | null; band: [number, number] | null }

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Joins ACTUAL weekly consumption and FORECAST weeks into one series. The two stay in separate fields so the chart can
 * style them differently. The last actual point is repeated as the first forecast point only to join the lines; it carries
 * no band, so no uncertainty is drawn for a value that is already known.
 */
export function buildForecastSeries(actualStart: string, actual: number[], forecast: WeeklyForecast[], maxActual = 26): ChartPoint[] {
  const shown = actual.slice(-maxActual);
  const firstShown = addDays(actualStart, 7 * (actual.length - shown.length));
  const points: ChartPoint[] = shown.map((v, i) => ({ label: addDays(firstShown, 7 * i), actual: v, forecast: null, band: null }));
  if (points.length && forecast.length) points[points.length - 1].forecast = points[points.length - 1].actual;
  for (const f of forecast) points.push({ label: f.weekStart, actual: null, forecast: f.point, band: [f.low, f.high] });
  return points;
}

export const fmtNum = (n: number | null | undefined, dp = 1) => (n == null ? "-" : n.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: 0 }));
