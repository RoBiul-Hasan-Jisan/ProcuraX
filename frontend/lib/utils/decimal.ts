/**
 * Exact decimal arithmetic on strings using BigInt (no binary floating point).
 * Inputs: non-negative decimals with at most 4 fractional digits. Display-only helper:
 * the server recomputes and stores every authoritative total.
 */
const SCALE = 4;
const VALID = /^\d+(\.\d{1,4})?$/;

export function isDecimal(v: string): boolean {
  return VALID.test(v.trim());
}

function toScaled(v: string): bigint {
  const [i, f = ""] = v.trim().split(".");
  return BigInt(i + f.padEnd(SCALE, "0"));
}

/** a x b rounded half-up to 2 decimals, as a string. Returns null if either input is not a valid decimal. */
export function mul2(a: string, b: string): string | null {
  if (!isDecimal(a) || !isDecimal(b)) return null;
  const product = toScaled(a) * toScaled(b); // scale 8
  const unit = BigInt(10) ** BigInt(SCALE * 2 - 2); // to 2dp
  const rounded = (product + unit / BigInt(2)) / unit;
  return fmt2(rounded);
}

/** Sum of 2dp decimal strings. */
export function sum2(values: (string | null)[]): string {
  let total = BigInt(0);
  for (const v of values) if (v !== null) total += toScaled(v) / BigInt(100);
  return fmt2(total);
}

function fmt2(cents: bigint): string {
  const s = cents.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Rounds a decimal string half-up to 2 decimals (same rule as the server). */
export function round2(v: string): string | null {
  if (!isDecimal(v)) return null;
  return fmt2((toScaled(v) + BigInt(50)) / BigInt(100));
}

/** amount x rate% rounded half-up to 2 decimals, e.g. pct2("6500010.00", "5") = "325000.50". */
export function pct2(amount: string, ratePercent: string): string | null {
  if (!isDecimal(amount) || !isDecimal(ratePercent)) return null;
  const product = toScaled(amount) * toScaled(ratePercent); // scale 8, still needs /100
  const unit = BigInt(10) ** BigInt(SCALE * 2 + 2 - 2); // 10^8 -> 2dp after the /100
  return fmt2((product + unit / BigInt(2)) / unit);
}

/** Compares two non-negative decimal strings exactly: -1, 0 or 1. Invalid input compares as 0 (callers validate first). */
export function cmp(a: string, b: string): number {
  if (!isDecimal(a) || !isDecimal(b)) return 0;
  const x = toScaled(a), y = toScaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** max(a - b, 0) as a string with up to 4 decimals trimmed, e.g. remaining("100", "40.5") = "59.5". */
export function remaining(ordered: string, done: string): string {
  if (!isDecimal(ordered) || !isDecimal(done)) return "0";
  const d = toScaled(ordered) - toScaled(done);
  if (d <= BigInt(0)) return "0";
  const s = d.toString().padStart(SCALE + 1, "0");
  const out = `${s.slice(0, -SCALE)}.${s.slice(-SCALE)}`.replace(/0+$/, "").replace(/\.$/, "");
  return out;
}
