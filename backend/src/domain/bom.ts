import { dec, Decimal, type DecimalInput } from './money';

export interface BomItem { material?: string | null; subProduct?: string | null; quantity: DecimalInput; wastagePercent: DecimalInput }
export interface Bom { id: string; number: string; product: string; version: number; status: 'draft' | 'active' | 'obsolete'; effectiveFrom: Date; items: BomItem[] }

/**
 * Picks the BOM that applies to a product on a date: ACTIVE only, effective on or before the date,
 * latest effective date first, then highest version. Draft and obsolete versions are never used.
 */
export function selectBom(boms: Bom[], productId: string, on: Date): Bom | null {
  const candidates = boms.filter((b) => b.product === productId && b.status === 'active' && b.effectiveFrom.getTime() <= on.getTime());
  candidates.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.version - a.version);
  return candidates[0] ?? null;
}

export interface Requirement {
  material: string;
  /** planned quantity x BOM quantity (no wastage) */
  gross: Decimal;
  /** gross x (1 + wastage%) */
  adjusted: Decimal;
  /** human-readable route, e.g. "TMT 12mm > BOM-2026-0001 v2" */
  path: string[];
  bom: { id: string; number: string; version: number };
  perUnit: Decimal;
  wastagePercent: Decimal;
  parentQuantity: Decimal;
}
export interface ExplodeIssue { product: string; message: string }

export const MAX_BOM_DEPTH = 6;

/**
 * Explodes `quantity` of a product into raw-material requirements.
 *   Gross    = parent quantity x BOM quantity
 *   Adjusted = Gross x (1 + wastage% / 100)
 * A component that is itself a product (multi-level BOM) is produced in-house: the ADJUSTED quantity becomes the
 * production quantity of that sub-product and is exploded with the sub-product's own applicable BOM.
 * Missing BOMs and circular references are reported as issues instead of being skipped silently.
 */
export function explodeBom(
  productId: string, quantity: DecimalInput, on: Date, boms: Bom[], names: (id: string) => string = (s) => s,
  trail: string[] = [], depth = 0,
): { requirements: Requirement[]; issues: ExplodeIssue[] } {
  const issues: ExplodeIssue[] = [];
  if (trail.includes(productId)) return { requirements: [], issues: [{ product: productId, message: `Circular BOM: ${[...trail, productId].map(names).join(' > ')}` }] };
  if (depth >= MAX_BOM_DEPTH) return { requirements: [], issues: [{ product: productId, message: `BOM nesting is deeper than ${MAX_BOM_DEPTH} levels` }] };
  const bom = selectBom(boms, productId, on);
  if (!bom) return { requirements: [], issues: [{ product: productId, message: `No active BOM effective on ${on.toISOString().slice(0, 10)} for ${names(productId)}` }] };

  const qty = dec(quantity);
  const requirements: Requirement[] = [];
  for (const item of bom.items) {
    const perUnit = dec(item.quantity);
    const wastage = dec(item.wastagePercent);
    const gross = qty.mul(perUnit);
    const adjusted = gross.mul(new Decimal(1).plus(wastage.div(100)));
    const here = [...trail.map(names), `${names(productId)} (${bom.number} v${bom.version})`];
    if (item.subProduct) {
      const sub = explodeBom(item.subProduct, adjusted, on, boms, names, [...trail, productId], depth + 1);
      issues.push(...sub.issues);
      requirements.push(...sub.requirements); // child paths already start with the ancestors (via `trail`)
    } else if (item.material) {
      requirements.push({ material: item.material, gross, adjusted, path: here, bom: { id: bom.id, number: bom.number, version: bom.version }, perUnit, wastagePercent: wastage, parentQuantity: qty });
    }
  }
  return { requirements, issues };
}
