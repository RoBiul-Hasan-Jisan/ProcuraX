import type { Weights } from "@/types/procurement";

export const WEIGHT_KEYS: { key: keyof Weights; label: string; help: string }[] = [
  { key: "price", label: "Price", help: "Total landed cost: lower is better." },
  { key: "delivery", label: "Delivery speed", help: "Quoted delivery days: fewer is better." },
  { key: "quality", label: "Supplier quality", help: "Recorded accepted-quantity rate. Unproven suppliers get a neutral score, never a good one." },
  { key: "leadTime", label: "Lead-time reliability", help: "Recorded on-time delivery rate. Unproven suppliers get a neutral score." },
  { key: "payment", label: "Payment terms", help: "More credit days is better, up to 60 days." },
];

/** Returns an error message, or null when the weights are acceptable. Mirrors the server rule (the server re-checks). */
export function validateWeights(w: Record<keyof Weights, string>): string | null {
  for (const { key, label } of WEIGHT_KEYS) {
    const v = w[key].trim();
    if (!/^\d{1,3}(\.\d+)?$/.test(v)) return `${label}: enter a number from 0 to 100.`;
    if (Number(v) > 100) return `${label}: cannot be more than 100.`;
  }
  return WEIGHT_KEYS.every(({ key }) => Number(w[key]) === 0) ? "At least one weight must be greater than zero." : null;
}

/** Share of the total score each criterion carries, in percent with one decimal. Weights are relative, so they need not add to 100. */
export function normalizedShares(w: Record<keyof Weights, string>): Record<keyof Weights, string> {
  const total = WEIGHT_KEYS.reduce((a, { key }) => a + Number(w[key] || 0), 0);
  return Object.fromEntries(WEIGHT_KEYS.map(({ key }) => [key, total > 0 ? ((Number(w[key] || 0) / total) * 100).toFixed(1) : "0.0"])) as Record<keyof Weights, string>;
}
