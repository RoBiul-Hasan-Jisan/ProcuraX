import { AuditLog } from '../models/AuditLog';
import { sanitize, type AuditAction } from '../domain/audit';
import { currentRequest } from '../utils/requestStore';
import type { UserContext } from '../types/express';

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId: string;
  entityNumber?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Writes one audit entry. Called right after the business change commits. A failure here is logged loudly but does NOT
 * undo or fail the business action that already happened (the entry is not in the same transaction): see README limitations.
 */
export async function audit(user: Pick<UserContext, 'id' | 'displayName' | 'role'> | null, input: AuditInput): Promise<void> {
  const req = currentRequest();
  try {
    await AuditLog.create({
      actor: user ? { id: String(user.id), name: user.displayName, role: user.role ?? null } : { id: null, name: 'System', role: null },
      action: input.action, entityType: input.entityType, entityId: String(input.entityId), entityNumber: input.entityNumber ?? '', summary: input.summary ?? '',
      before: input.before === undefined ? null : sanitize(input.before), after: input.after === undefined ? null : sanitize(input.after),
      requestId: req?.requestId ?? null, ip: req?.ip ?? null, userAgent: req?.userAgent ?? null,
    });
  } catch (e) {
    console.error(`[audit] FAILED to record ${input.action} ${input.entityType}/${input.entityId} (request ${req?.requestId ?? 'n/a'}):`, e instanceof Error ? e.message : e);
  }
}

export interface AuditQuery { page: number; limit: number; entityType?: string; entityId?: string; action?: string; actor?: string; from?: Date; to?: Date; search?: string }

export async function listAudit(q: AuditQuery) {
  const f: Record<string, unknown> = {};
  if (q.entityType) f.entityType = q.entityType;
  if (q.entityId) f.entityId = q.entityId;
  if (q.action) f.action = q.action;
  if (q.actor) f['actor.id'] = q.actor;
  if (q.from || q.to) f.at = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.search) { const re = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); f.$or = [{ entityNumber: re }, { summary: re }, { 'actor.name': re }]; }
  const [items, total] = await Promise.all([
    AuditLog.find(f).sort({ at: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    AuditLog.countDocuments(f),
  ]);
  return { items, total };
}
export const getAudit = (id: string) => AuditLog.findById(id).lean();
