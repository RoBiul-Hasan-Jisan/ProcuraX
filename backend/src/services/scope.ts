import type { UserContext } from '../types/express';

const SEE_ALL = new Set(['system_admin', 'procurement_manager', 'finance_officer', 'management']);

/**
 * Query filter limiting which requisitions a user may see.
 *  - admin/procurement/finance/management: every non-draft requisition (plus their own drafts)
 *  - department manager: their department (plus own drafts)
 *  - everyone else: only their own requisitions
 * Other people's drafts are never visible.
 */
export function requisitionScope(user: UserContext): Record<string, unknown> {
  const own = { requestedBy: user.id };
  const notDraft = { status: { $ne: 'Draft' } };
  if (user.role && SEE_ALL.has(user.role)) return { $or: [notDraft, own] };
  if (user.role === 'department_manager' && user.departmentId) {
    return { $or: [{ department: user.departmentId, ...notDraft }, own] };
  }
  return own;
}

export const canSeeBankInfo = (user: UserContext) => user.permissions.includes('suppliers:bank');
