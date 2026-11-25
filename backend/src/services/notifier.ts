import { User } from '../models/User';
import { Role } from '../models/Role';
import { Material } from '../models/Material';
import { StockLevel } from '../models/StockLevel';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { Invoice } from '../models/Invoice';
import { Notification, type NotificationType } from '../models/Notification';
import { Decimal, dec } from '../domain/money';
import { stockStatus, type StockStatus } from '../domain/inventory';

/**
 * Role-aware, persisted notifications, created by backend business events (never by the front end).
 * A notification failure is logged and swallowed: it must never undo or fail the business action that triggered it.
 */
export interface NotificationInput {
  type: NotificationType; title: string; body?: string; severity?: 'info' | 'warning' | 'critical'; link?: string;
  entity?: { kind: string; id: string; number?: string };
  /** Same key to the same person is delivered once (used for repeating conditions such as low stock). */
  dedupeKey?: string;
}

const str = (v: unknown) => (v == null ? '' : String(v));

/* ---------- recipients ---------- */
export async function usersByRoles(roles: string[], opts: { department?: string | null } = {}): Promise<string[]> {
  const f: Record<string, unknown> = { role: { $in: roles }, status: 'active' };
  if (opts.department) f.department = opts.department;
  return (await User.find(f).select('_id').lean()).map((u: any) => String(u._id));
}
export async function usersByPermission(permission: string): Promise<string[]> {
  const roles = (await Role.find({ permissions: permission } as any).select('name').lean()).map((r: any) => r.name);
  return roles.length ? usersByRoles(roles) : [];
}
export async function usersBySuppliers(supplierIds: string[]): Promise<string[]> {
  if (!supplierIds.length) return [];
  return (await User.find({ role: 'supplier', status: 'active', supplier: { $in: supplierIds } }).select('_id').lean()).map((u: any) => String(u._id));
}

/** Deduplicates recipients and drops the person who caused the event (they already know). */
export async function deliver(recipients: (string | null | undefined)[], n: NotificationInput, exceptUserId?: string | null): Promise<number> {
  const ids = [...new Set(recipients.filter((r): r is string => !!r).map(String))].filter((id) => id !== exceptUserId);
  if (!ids.length) return 0;
  const base = { type: n.type, title: n.title, body: n.body ?? '', severity: n.severity ?? 'info', link: n.link ?? '', entity: n.entity, readAt: null };
  const ops = ids.map((recipient) => n.dedupeKey
    ? { updateOne: { filter: { recipient, dedupeKey: n.dedupeKey }, update: { $setOnInsert: { ...base, recipient, dedupeKey: n.dedupeKey, createdAt: new Date() } }, upsert: true } }
    : { insertOne: { document: { ...base, recipient, createdAt: new Date() } } });
  const res: any = await Notification.bulkWrite(ops as any, { ordered: false });
  return (res.insertedCount ?? 0) + (res.upsertedCount ?? 0);
}

async function safely(label: string, fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { console.error(`[notify] ${label} failed:`, e instanceof Error ? e.message : e); }
}

const RISK_TYPE: Record<string, NotificationType> = { delayed_po: 'delayed_delivery', supplier_quality: 'supplier_performance', supplier_delivery: 'supplier_performance', repeated_mismatch: 'supplier_performance' };
const STOCK_RANK: Record<StockStatus, number> = { critical: 0, low: 1, reorder: 2, ok: 3 };

export const notify = {
  /** A requisition was submitted. Procurement is told for visibility; the approver is told separately via approvalNeeded. */
  async requisitionSubmitted(r: any, actorId?: string | null) {
    await safely('requisitionSubmitted', async () => deliver(await usersByRoles(['procurement_manager']), {
      type: 'requisition_submitted', title: `New requisition ${str(r.number)}`, body: `Submitted by ${str(r.requestedByName)}.`, link: `/procurement/requisitions/${r._id}`, entity: { kind: 'PurchaseRequisition', id: str(r._id), number: str(r.number) },
    }, actorId));
  },

  async approvalNeeded(r: any, approverRole: string) {
    await safely('approvalNeeded', async () => deliver(await usersByRoles([approverRole], approverRole === 'department_manager' ? { department: str(r.department) } : {}), {
      type: 'approval_requested', severity: 'warning', title: `Approval needed: ${str(r.number)}`, body: `Requisition from ${str(r.requestedByName)} is waiting for your decision.`,
      link: '/procurement/approvals', entity: { kind: 'PurchaseRequisition', id: str(r._id), number: str(r.number) },
    }, str(r.requestedBy)));
  },

  async requisitionDecided(r: any, action: string) {
    const type: NotificationType = action === 'Approved' ? 'requisition_approved' : action === 'Rejected' ? 'requisition_rejected' : 'modification_requested';
    const verb = action === 'Approved' ? 'approved' : action === 'Rejected' ? 'rejected' : 'returned for changes';
    await safely('requisitionDecided', () => deliver([str(r.requestedBy)], {
      type, severity: action === 'Approved' ? 'info' : 'warning', title: `Requisition ${str(r.number)} ${verb}`, link: `/procurement/requisitions/${r._id}`, entity: { kind: 'PurchaseRequisition', id: str(r._id), number: str(r.number) },
    }));
  },

  async rfqPublished(rfq: any, supplierIds: string[]) {
    await safely('rfqPublished', async () => deliver(await usersBySuppliers(supplierIds.map(str)), {
      type: 'rfq_published', severity: 'warning', title: `New request for quotation ${str(rfq.number)}`, body: `Deadline ${rfq.deadline ? new Date(rfq.deadline).toISOString().slice(0, 10) : 'not set'}.`,
      link: `/procurement/rfqs/${rfq._id}`, entity: { kind: 'RFQ', id: str(rfq._id), number: str(rfq.number) },
    }));
  },

  async quotationSubmitted(rfq: any, _supplierId: string) {
    await safely('quotationSubmitted', () => deliver([str(rfq.createdBy)], {
      // Sealed bids: the notice says a quotation arrived, never who or how much.
      type: 'quotation_submitted', title: `Quotation received for ${str(rfq.number)}`, body: 'Quotations stay sealed until the deadline.', link: `/procurement/rfqs/${rfq._id}`, entity: { kind: 'RFQ', id: str(rfq._id), number: str(rfq.number) },
    }));
  },

  async supplierAwarded(rfq: any, supplierId: string) {
    await safely('supplierAwarded', async () => deliver(await usersBySuppliers([supplierId]), {
      type: 'supplier_awarded', title: `Your quotation for ${str(rfq.number)} was selected`, link: `/procurement/rfqs/${rfq._id}`, entity: { kind: 'RFQ', id: str(rfq._id), number: str(rfq.number) },
    }));
  },

  /** There is no separate PO approval step in this build: the notice goes out when the order is issued. */
  async purchaseOrderIssued(po: any, supplierId: string) {
    await safely('purchaseOrderIssued', async () => {
      const created: any = await PurchaseOrder.findById(po.id).select('createdBy').lean();
      await deliver([...(await usersBySuppliers([str(supplierId)])), str(created?.createdBy)], {
        type: 'purchase_order_issued', title: `Purchase order ${str(po.number)} issued`, link: `/procurement/purchase-orders/${po.id}`, entity: { kind: 'PurchaseOrder', id: str(po.id), number: str(po.number) },
      });
    });
  },

  async goodsReceived(result: any) {
    await safely('goodsReceived', async () => {
      const po: any = await PurchaseOrder.findById(result.receipt?.purchaseOrder).select('createdBy supplier number').lean();
      if (!po) return;
      await deliver([str(po.createdBy), ...(await usersBySuppliers([str(po.supplier)]))], {
        type: 'goods_received', title: `Goods received against ${str(po.number)}`, body: `Order is now ${str(result.poStatus).replace('_', ' ')}.`, link: `/procurement/purchase-orders/${po.id ?? po._id}`, entity: { kind: 'PurchaseOrder', id: str(po._id), number: str(po.number) },
      });
    });
  },

  async invoiceDecided(invoice: any, decision: string) {
    await safely('invoiceDecided', async () => {
      const inv: any = await Invoice.findById(invoice.id).select('supplier number').lean();
      const finance = await usersByRoles(['finance_officer']);
      await deliver([...(await usersBySuppliers([str(inv?.supplier)])), ...finance], {
        type: decision === 'verify' ? 'invoice_verified' : 'invoice_disputed', severity: decision === 'verify' ? 'info' : 'warning', title: `Invoice ${str(invoice.number)} ${decision === 'verify' ? 'verified' : 'disputed'}`,
        link: '/procurement/invoices', entity: { kind: 'Invoice', id: str(invoice.id), number: str(invoice.number) },
      });
    });
  },

  /** After stock fell by `decrease`: tells stock owners and buyers only when the material got WORSE (crossed into a more severe level). */
  async stockDecreased(materialId: string, decrease: string) {
    await safely('stockDecreased', async () => {
      const [mat, levels]: [any, any[]] = await Promise.all([Material.findById(materialId).select('name sku safetyStock minimumStock reorderPoint').lean() as any, StockLevel.find({ material: materialId }).select('quantity').lean() as any]);
      if (!mat) return;
      const after = levels.reduce((a: Decimal, l) => a.plus(dec(l.quantity)), new Decimal(0));
      const before = after.plus(dec(decrease));
      const lv = { safetyStock: mat.safetyStock ?? 0, minimumStock: mat.minimumStock ?? 0, reorderPoint: mat.reorderPoint ?? 0 };
      const sBefore = stockStatus(before, lv), sAfter = stockStatus(after, lv);
      if (sAfter === 'ok' || STOCK_RANK[sAfter] >= STOCK_RANK[sBefore]) return;
      const critical = sAfter === 'critical';
      await deliver(await usersByRoles(['inventory_officer', 'procurement_manager']), {
        type: critical ? 'critical_stock' : 'low_stock', severity: critical ? 'critical' : 'warning', dedupeKey: `stock:${materialId}:${sAfter}:${new Date().toISOString().slice(0, 10)}`,
        title: `${critical ? 'Critical' : 'Low'} stock: ${str(mat.name).replace(/^\[DEMO\]\s*/, '')}`, body: `${str(mat.sku)} is now ${after.toFixed(3)} (status ${sAfter}).`,
        link: '/inventory/alerts', entity: { kind: 'Material', id: materialId, number: str(mat.sku) },
      });
    });
  },

  /** A new risk alert was raised by a scan. Medium and above reach the people who can review risks. */
  async riskAlertRaised(alert: { _id?: unknown; number: string; category: string; severity: string; title: string }) {
    if (alert.severity === 'low') return;
    await safely('riskAlertRaised', async () => deliver(await usersByPermission('risks:review'), {
      type: RISK_TYPE[alert.category] ?? 'risk_alert', severity: alert.severity === 'critical' ? 'critical' : 'warning', dedupeKey: `risk:${alert.number}`,
      title: alert.title, body: `Risk alert ${alert.number} (${alert.severity}).`, link: '/intelligence/risks', entity: { kind: 'RiskAlert', id: str(alert._id), number: alert.number },
    }));
  },
};

export const notificationService = {
  async list(userId: string, q: { page: number; limit: number; unreadOnly?: boolean }) {
    const f: Record<string, unknown> = { recipient: userId, ...(q.unreadOnly ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
      Notification.find(f).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      Notification.countDocuments(f), Notification.countDocuments({ recipient: userId, readAt: null }),
    ]);
    return { items, total, unread };
  },
  unreadCount: (userId: string) => Notification.countDocuments({ recipient: userId, readAt: null }),
  /** Scoped by recipient: someone else's notification id behaves as not found. */
  async markRead(userId: string, id: string) { return (await Notification.updateOne({ _id: id, recipient: userId, readAt: null }, { $set: { readAt: new Date() } })).matchedCount; },
  async markAllRead(userId: string) { return (await Notification.updateMany({ recipient: userId, readAt: null }, { $set: { readAt: new Date() } })).modifiedCount; },
};
