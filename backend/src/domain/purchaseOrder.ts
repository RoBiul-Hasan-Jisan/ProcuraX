import { dec, Decimal, type DecimalInput } from './money';

export const PO_STATUSES = ['draft', 'issued', 'partially_received', 'received', 'closed', 'cancelled'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

const TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  draft: ['issued', 'cancelled'],
  issued: ['partially_received', 'received', 'cancelled'],
  partially_received: ['partially_received', 'received', 'closed'],
  received: [],
  closed: [],
  cancelled: [],
};
export const canPoTransition = (from: PoStatus, to: PoStatus) => TRANSITIONS[from]?.includes(to) ?? false;
export const canReceiveAgainst = (s: PoStatus) => s === 'issued' || s === 'partially_received';

export interface PoLineState { material: string; quantity: DecimalInput; acceptedQty: DecimalInput }
export interface ReceiptLineInput { material: string; acceptedQty: DecimalInput; rejectedQty: DecimalInput; rejectionReason?: string }

/**
 * Validates a goods receipt against the PO.
 * Rules: every line must belong to the PO; quantities are non-negative; at least one unit is delivered;
 * rejected goods need a reason; cumulative ACCEPTED quantity may never exceed the ordered quantity
 * (rejected goods are returned to the supplier and do not count toward the order).
 * Returns the list of problems (empty when valid).
 */
export function validateReceipt(po: PoLineState[], lines: ReceiptLineInput[]): string[] {
  const problems: string[] = [];
  const byMaterial = new Map(po.map((l) => [l.material, l]));
  const seen = new Set<string>();
  let delivered = new Decimal(0);
  for (const l of lines) {
    if (seen.has(l.material)) { problems.push('A material appears more than once in this receipt'); continue; }
    seen.add(l.material);
    const poLine = byMaterial.get(l.material);
    if (!poLine) { problems.push('A received material is not on the purchase order'); continue; }
    const acc = dec(l.acceptedQty), rej = dec(l.rejectedQty);
    if (acc.lt(0) || rej.lt(0)) { problems.push('Quantities cannot be negative'); continue; }
    delivered = delivered.plus(acc).plus(rej);
    if (rej.gt(0) && !(l.rejectionReason ?? '').trim()) problems.push('A rejection reason is required when goods are rejected');
    const remaining = dec(poLine.quantity).minus(dec(poLine.acceptedQty));
    if (acc.gt(remaining)) problems.push(`Accepted quantity ${acc.toFixed()} exceeds the remaining ordered quantity ${remaining.toFixed()}`);
  }
  if (delivered.lte(0)) problems.push('Nothing was received: enter an accepted or rejected quantity');
  return problems;
}

/** Status after a receipt: received when every line's accepted quantity reaches the ordered quantity. */
export function statusAfterReceipt(lines: PoLineState[]): 'partially_received' | 'received' {
  return lines.every((l) => dec(l.acceptedQty).gte(dec(l.quantity))) ? 'received' : 'partially_received';
}
