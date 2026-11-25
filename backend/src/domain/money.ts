import Decimal from 'decimal.js';
import { Types } from 'mongoose';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = Decimal.Value | Types.Decimal128 | null | undefined;
export { Decimal };

/** Converts strings, numbers, Mongo Decimal128 or Decimal into a Decimal. Null/undefined become 0. */
export function dec(value: DecimalInput): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  if (value instanceof Types.Decimal128) return new Decimal(value.toString());
  return new Decimal(value as Decimal.Value);
}

/** Stores monetary values with at most 4 decimal places. */
export function toD128(value: DecimalInput): Types.Decimal128 {
  return Types.Decimal128.fromString(dec(value).toDecimalPlaces(4).toFixed());
}

/** API representation: exact decimal string (never a JS float). */
export function str(value: DecimalInput, places = 2): string {
  return dec(value).toDecimalPlaces(places).toFixed(places);
}

export interface LandedCost {
  materialCost: Decimal;
  transportCost: Decimal;
  additionalCharges: Decimal;
  taxAmount: Decimal;
  totalLandedCost: Decimal;
}

/**
 * Total Landed Cost = Material Cost + Transportation Cost + Additional Charges + Applicable Taxes
 * where Material Cost = quantity x unit price and Taxes = tax rate % x Material Cost.
 * All components are rounded to 2 decimal places (half-up) before summing.
 */
export function computeLandedCost(input: {
  quantity: DecimalInput;
  unitPrice: DecimalInput;
  transportCost?: DecimalInput;
  additionalCharges?: DecimalInput;
  taxRatePercent?: DecimalInput;
}): LandedCost {
  const qty = dec(input.quantity);
  const price = dec(input.unitPrice);
  if (qty.lte(0)) throw new Error('Quantity must be greater than zero');
  if (price.lt(0)) throw new Error('Unit price cannot be negative');
  const materialCost = qty.mul(price).toDecimalPlaces(2);
  const transportCost = dec(input.transportCost).toDecimalPlaces(2);
  const additionalCharges = dec(input.additionalCharges).toDecimalPlaces(2);
  const taxAmount = materialCost.mul(dec(input.taxRatePercent)).div(100).toDecimalPlaces(2);
  return {
    materialCost,
    transportCost,
    additionalCharges,
    taxAmount,
    totalLandedCost: materialCost.plus(transportCost).plus(additionalCharges).plus(taxAmount),
  };
}

export interface QuotationCost extends LandedCost {
  lines: { quantity: Decimal; unitPrice: Decimal; lineTotal: Decimal }[];
}

/**
 * Landed cost for a multi-line quotation. Each line total is rounded to 2dp, then
 * Material Cost = sum(lines), Tax = tax% x Material Cost, and
 * Total Landed Cost = Material Cost + Transportation + Additional Charges + Taxes.
 */
export function computeQuotationCost(input: {
  lines: { quantity: DecimalInput; unitPrice: DecimalInput }[];
  transportCost?: DecimalInput;
  additionalCharges?: DecimalInput;
  taxRatePercent?: DecimalInput;
}): QuotationCost {
  if (input.lines.length === 0) throw new Error('At least one line is required');
  const lines = input.lines.map((l) => {
    const quantity = dec(l.quantity);
    const unitPrice = dec(l.unitPrice);
    if (quantity.lte(0)) throw new Error('Quantity must be greater than zero');
    if (unitPrice.lt(0)) throw new Error('Unit price cannot be negative');
    return { quantity, unitPrice, lineTotal: quantity.mul(unitPrice).toDecimalPlaces(2) };
  });
  const materialCost = lines.reduce((a, l) => a.plus(l.lineTotal), new Decimal(0));
  const transportCost = dec(input.transportCost).toDecimalPlaces(2);
  const additionalCharges = dec(input.additionalCharges).toDecimalPlaces(2);
  if (transportCost.lt(0) || additionalCharges.lt(0)) throw new Error('Charges cannot be negative');
  const taxAmount = materialCost.mul(dec(input.taxRatePercent)).div(100).toDecimalPlaces(2);
  return { lines, materialCost, transportCost, additionalCharges, taxAmount, totalLandedCost: materialCost.plus(transportCost).plus(additionalCharges).plus(taxAmount) };
}

/** Like toD128 but with a caller-chosen precision (BOM quantities per unit need up to 6 decimals, e.g. 0.000800 MT of refractory per MT). */
export function toD128p(value: DecimalInput, places: number): Types.Decimal128 {
  return Types.Decimal128.fromString(dec(value).toDecimalPlaces(places).toFixed());
}
