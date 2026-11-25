import { Router } from 'express';
import { requirePermission } from '../middlewares/authorization';
import { validate } from '../middlewares/validation';
import { notFound, sendSuccess } from '../utils/apiResponse';
import { auditListQuery, idParam, notificationListQuery } from '../validators/schemas';
import { getAudit, listAudit } from '../services/auditService';
import { notificationService } from '../services/notifier';
import { AUDIT_ACTIONS } from '../domain/audit';
import { paginate, protectedChain, validated } from './common';

const r = Router();
r.use(['/notifications', '/audit-logs'], ...protectedChain);

/* Notifications: always the caller's own. The recipient comes from the session, never from the request. */
r.get('/notifications', requirePermission('notifications:view'), validate(notificationListQuery, 'query'), async (req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total, unread } = await notificationService.list(req.user!.id, q);
  sendSuccess(res, items, 'Notifications retrieved', 200, { ...paginate(q.page, q.limit, total), unread } as any);
});
r.get('/notifications/unread-count', requirePermission('notifications:view'), async (req, res) => sendSuccess(res, { unread: await notificationService.unreadCount(req.user!.id) }));
r.post('/notifications/read-all', requirePermission('notifications:view'), async (req, res) => sendSuccess(res, { updated: await notificationService.markAllRead(req.user!.id) }, 'All notifications marked as read'));
r.post('/notifications/:id/read', requirePermission('notifications:view'), validate(idParam, 'params'), async (req, res) => {
  const matched = await notificationService.markRead(req.user!.id, validated<any>(res, 'params').id);
  if (!matched) throw notFound('Notification not found or already read');
  sendSuccess(res, { read: true }, 'Marked as read');
});

/* Audit log: read-only by design. There is no write, update or delete route. */
r.get('/audit-logs/actions', requirePermission('audit:view'), (_req, res) => sendSuccess(res, AUDIT_ACTIONS));
r.get('/audit-logs', requirePermission('audit:view'), validate(auditListQuery, 'query'), async (_req, res) => {
  const q = validated<any>(res, 'query');
  const { items, total } = await listAudit(q);
  sendSuccess(res, items, 'Audit entries retrieved', 200, paginate(q.page, q.limit, total));
});
r.get('/audit-logs/:id', requirePermission('audit:view'), validate(idParam, 'params'), async (_req, res) => {
  const e = await getAudit(validated<any>(res, 'params').id);
  if (!e) throw notFound('Audit entry not found');
  sendSuccess(res, e);
});

export default r;
