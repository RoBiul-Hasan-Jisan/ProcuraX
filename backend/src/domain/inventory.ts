import { dec, Decimal, type DecimalInput } from './money';

export const MOVEMENT_TYPES = ['opening_balance', 'receipt', 'issue', 'transfer_in', 'transfer_out', 'adjustment'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Signed stock change for a movement. Issues and transfer-outs reduce stock; adjustments carry their own sign. */
export function signedDelta(type: MovementType, quantity: DecimalInput, adjustmentDirection?: 'increase' | 'decrease'): Decimal {
  const q = dec(quantity);
  if (q.lte(0)) throw new Error('Movement quantity must be greater than zero');
  if (type === 'issue' || type === 'transfer_out') return q.neg();
  if (type === 'adjustment') {
    if (!adjustmentDirection) throw new Error('Adjustment direction is required');
    return adjustmentDirection === 'decrease' ? q.neg() : q;
  }
  return q;
}

export type StockStatus = 'ok' | 'reorder' | 'low' | 'critical';

/**
 * Stock status against the material's own levels (checked from most to least severe):
 *   critical : stock <= safety stock
 *   low      : stock <= minimum stock
 *   reorder  : stock <= reorder point
 *   ok       : above all levels
 * A level of 0 is treated as "not set" and is ignored, so unconfigured materials are never flagged.
 */
export function stockStatus(stock: DecimalInput, levels: { safetyStock: number; minimumStock: number; reorderPoint: number }): StockStatus {
  const s = dec(stock);
  if (levels.safetyStock > 0 && s.lte(levels.safetyStock)) return 'critical';
  if (levels.minimumStock > 0 && s.lte(levels.minimumStock)) return 'low';
  if (levels.reorderPoint > 0 && s.lte(levels.reorderPoint)) return 'reorder';
  return 'ok';
}

export const shortfallToReorderPoint = (stock: DecimalInput, reorderPoint: number): Decimal =>
  Decimal.max(0, dec(reorderPoint).minus(dec(stock)));
