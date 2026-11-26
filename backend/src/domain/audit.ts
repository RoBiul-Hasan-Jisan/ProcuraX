/** Audit helpers. Pure functions: turn records into small, JSON-safe, secret-free before/after snapshots. */
export const AUDIT_ACTIONS = [
  'requisition.created', 'requisition.updated', 'requisition.submitted', 'requisition.cancelled', 'approval.decided',
  'rfq.created', 'rfq.closed', 'rfq.cancelled', 'quotation.submitted', 'supplier.awarded',
  'purchase_order.created', 'purchase_order.issued', 'purchase_order.cancelled', 'purchase_order.closed',
  'goods_receipt.recorded', 'inventory.adjusted', 'inventory.issued', 'inventory.transferred',
  'invoice.recorded', 'invoice.verified', 'invoice.disputed',
  'user.updated', 'department.created', 'department.updated', 'mrp.run', 'risk_alert.reviewed', 'forecast.generated', 'document.uploaded', 'document.deleted', 'scoring_weights.updated', 'report.exported',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const REDACT = /(password|token|secret|bank|iban|account(number)?|apikey)/i;

/** Dates become ISO strings, ids and decimals become strings, secrets are replaced, depth is capped. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 4) return '[truncated]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const o = value as Record<string, any>;
    if (typeof o.toHexString === 'function') return o.toHexString(); // ObjectId
    if (o._bsontype === 'Decimal128') return String(o);
    return Object.fromEntries(Object.entries(o).filter(([k]) => k !== '__v').map(([k, v]) => [k, REDACT.test(k) ? '[redacted]' : sanitize(v, depth + 1)]));
  }
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  return value;
}

/** Only the fields that actually changed, on both sides. Returns null when nothing changed. */
export function diffFields(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined, keys: string[]) {
  const b: Record<string, unknown> = {}, a: Record<string, unknown> = {};
  for (const k of keys) {
    const x = sanitize(before?.[k]), y = sanitize(after?.[k]);
    if (JSON.stringify(x) !== JSON.stringify(y)) { b[k] = x; a[k] = y; }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
