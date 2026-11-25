/** Time-series helpers shared by forecasting, risk detection and the assistant. Pure functions. */
const DAY_MS = 86_400_000;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export interface DailyPoint { date: Date; value: number }

/** Sum same-day records. */
export function toDaily(points: DailyPoint[]): { date: string; value: number }[] {
  const m = new Map<string, number>();
  for (const p of points) m.set(isoDay(p.date), (m.get(isoDay(p.date)) ?? 0) + p.value);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

/**
 * 7-day buckets, the last one ending on `end`. Days with no record count as zero. The oldest bucket is dropped when the
 * data does not cover all seven of its days, because it would understate consumption. Records after `end` are ignored.
 * Mirrors ml/app/preprocessing/series.py so the UI history and the forecast input agree.
 */
export function weeklyTotals(points: DailyPoint[], end: Date): { start: string; weeks: number[] } {
  const e = utcDay(end);
  const used = points.filter((p) => utcDay(p.date) <= e);
  if (!used.length) return { start: isoDay(end), weeks: [] };
  const first = Math.min(...used.map((p) => utcDay(p.date)));
  const nWeeks = Math.floor((e - first) / DAY_MS / 7) + 1;
  let weeks = new Array<number>(nWeeks).fill(0);
  for (const p of used) {
    const k = Math.floor((e - utcDay(p.date)) / DAY_MS / 7);
    weeks[nWeeks - 1 - k] += p.value;
  }
  let start = e - (7 * nWeeks - 1) * DAY_MS;
  if (start < first && nWeeks > 1) { weeks = weeks.slice(1); start += 7 * DAY_MS; }
  return { start: isoDay(new Date(start)), weeks };
}
