import { dec, Decimal, computeQuotationCost, type DecimalInput } from './money';

export interface MatchPoLine { material: string; unitPrice: DecimalInput; acceptedQty: DecimalInput }
export interface MatchPo { lines: MatchPoLine[]; transportCost: DecimalInput; additionalCharges: DecimalInput; taxRatePercent: DecimalInput }
export interface MatchInvoice { lines: { material: string; quantity: DecimalInput; unitPrice: DecimalInput }[]; transportCost: DecimalInput; additionalCharges: DecimalInput; taxRatePercent: DecimalInput }

export interface MatchResult { ok: boolean; issues: string[]; expectedTotal: string; invoiceTotal: string }

/**
 * Three-way match: purchase order (what was agreed) vs goods receipts (what was accepted) vs invoice (what is billed).
 *  - every billed material must be on the PO
 *  - unit price must equal the PO price (no tolerance)
 *  - billed quantity may not exceed accepted-and-not-yet-invoiced quantity (`alreadyInvoiced` covers earlier invoices)
 *  - transport and additional charges may not exceed the PO amounts; tax rate must equal the PO rate
 * The invoice total is always recomputed here from the lines; a total typed by a person is never trusted.
 */
export function matchInvoice(po: MatchPo, invoice: MatchInvoice, alreadyInvoiced: Record<string, DecimalInput> = {}): MatchResult {
  const issues: string[] = [];
  const poLines = new Map(po.lines.map((l) => [l.material, l]));
  const seen = new Set<string>();
  for (const l of invoice.lines) {
    if (seen.has(l.material)) { issues.push('A material appears more than once on the invoice'); continue; }
    seen.add(l.material);
    const p = poLines.get(l.material);
    if (!p) { issues.push('Invoice bills a material that is not on the purchase order'); continue; }
    if (!dec(l.unitPrice).eq(dec(p.unitPrice))) issues.push(`Unit price ${dec(l.unitPrice).toFixed()} differs from the PO price ${dec(p.unitPrice).toFixed()}`);
    const billable = dec(p.acceptedQty).minus(dec(alreadyInvoiced[l.material]));
    if (dec(l.quantity).gt(billable)) issues.push(`Billed quantity ${dec(l.quantity).toFixed()} exceeds the accepted, not-yet-invoiced quantity ${Decimal.max(0, billable).toFixed()}`);
  }
  if (dec(invoice.transportCost).gt(dec(po.transportCost))) issues.push('Transportation charge exceeds the amount on the PO');
  if (dec(invoice.additionalCharges).gt(dec(po.additionalCharges))) issues.push('Additional charges exceed the amount on the PO');
  if (!dec(invoice.taxRatePercent).eq(dec(po.taxRatePercent))) issues.push('Tax rate differs from the PO');

  const cost = (lines: { quantity: DecimalInput; unitPrice: DecimalInput }[], t: DecimalInput, a: DecimalInput, tax: DecimalInput) =>
    computeQuotationCost({ lines, transportCost: t, additionalCharges: a, taxRatePercent: tax }).totalLandedCost;
  const invoiceTotal = cost(invoice.lines, invoice.transportCost, invoice.additionalCharges, invoice.taxRatePercent);
  // What the PO terms would allow for the same quantities: informational, shown next to the invoice total.
  const expectedTotal = cost(
    invoice.lines.map((l) => ({ quantity: l.quantity, unitPrice: poLines.get(l.material)?.unitPrice ?? l.unitPrice })),
    Decimal.min(dec(invoice.transportCost), dec(po.transportCost)), Decimal.min(dec(invoice.additionalCharges), dec(po.additionalCharges)), po.taxRatePercent,
  );
  return { ok: issues.length === 0, issues, expectedTotal: expectedTotal.toFixed(2), invoiceTotal: invoiceTotal.toFixed(2) };
}
