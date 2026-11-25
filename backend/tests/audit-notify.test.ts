import { chain, D, oid } from './helpers';

// This file tests the REAL audit service and notifier, so it undoes the global stubs from tests/mocks.ts.
jest.unmock('../src/services/auditService');
jest.unmock('../src/services/notifier');
jest.mock('../src/models/AuditLog', () => ({ AuditLog: require('./helpers').mockModel('create', 'find', 'findById', 'countDocuments') }));
jest.mock('../src/models/User', () => ({ User: require('./helpers').mockModel('find') }));
jest.mock('../src/models/Role', () => ({ Role: require('./helpers').mockModel('find') }));
jest.mock('../src/models/Material', () => ({ Material: require('./helpers').mockModel('findById') }));
jest.mock('../src/models/StockLevel', () => ({ StockLevel: require('./helpers').mockModel('find') }));
jest.mock('../src/models/PurchaseOrder', () => ({ PurchaseOrder: require('./helpers').mockModel('findById') }));
jest.mock('../src/models/Invoice', () => ({ Invoice: require('./helpers').mockModel('findById') }));
jest.mock('../src/models/Notification', () => ({ Notification: require('./helpers').mockModel('bulkWrite', 'find', 'countDocuments', 'updateOne', 'updateMany') }));

import { AuditLog } from '../src/models/AuditLog';
import { User } from '../src/models/User';
import { Role } from '../src/models/Role';
import { Material } from '../src/models/Material';
import { StockLevel } from '../src/models/StockLevel';
import { PurchaseOrder } from '../src/models/PurchaseOrder';
import { Notification } from '../src/models/Notification';
import { audit, listAudit } from '../src/services/auditService';
import { notify, notificationService, deliver } from '../src/services/notifier';
import { diffFields, sanitize } from '../src/domain/audit';
import { requestStore } from '../src/utils/requestStore';

const m = (x: unknown) => x as jest.Mock;
const actor: any = { id: oid('u1'), displayName: 'Buyer One', role: 'procurement_manager' };
const users = (...ids: string[]) => chain(ids.map((id) => ({ _id: id })));
const delivered = () => m(Notification.bulkWrite).mock.calls.flatMap((c) => c[0] as any[]).map((o) => o.insertOne?.document ?? o.updateOne.update.$setOnInsert);
beforeEach(() => {
  for (const mdl of [AuditLog, User, Role, Material, StockLevel, PurchaseOrder, Notification] as any[]) for (const fn of Object.values(mdl)) (fn as jest.Mock).mockReset?.();
  m(Notification.bulkWrite).mockResolvedValue({ insertedCount: 1, upsertedCount: 0 });
});

describe('audit helpers', () => {
  it('redacts secrets, stringifies dates/ids/decimals and caps depth', () => {
    const out: any = sanitize({ bankDetails: { account: '123' }, token: 'x', at: new Date('2026-01-02T00:00:00Z'), id: { toHexString: () => 'abc' }, amt: D('12.50'), n: { a: { b: { c: { d: { e: 1 } } } } } });
    expect(out.bankDetails).toBe('[redacted]'); expect(out.token).toBe('[redacted]'); expect(out.at).toBe('2026-01-02T00:00:00.000Z'); expect(out.id).toBe('abc'); expect(out.amt).toBe('12.50');
    expect(JSON.stringify(out.n)).toContain('[truncated]');
  });
  it('diffFields keeps only what changed, and nothing when nothing did', () => {
    expect(diffFields({ a: 1, b: 2 }, { a: 1, b: 3 }, ['a', 'b'])).toEqual({ before: { b: 2 }, after: { b: 3 } });
    expect(diffFields({ a: 1 }, { a: 1 }, ['a'])).toBeNull();
    expect(diffFields({ d: new Date('2026-01-01') }, { d: new Date('2026-01-01') }, ['d'])).toBeNull();
  });
});

describe('audit log is append-only', () => {
  const { AuditLog: Real } = jest.requireActual('../src/models/AuditLog');
  it.each(['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'])('%s is refused before reaching the database', async (op) => {
    await expect((Real as any)[op]({ action: 'x' }, { $set: { action: 'y' } }).exec()).rejects.toThrow(/append-only/);
  });
  it('an existing entry cannot be re-saved', async () => {
    const d = new Real({ action: 'a', entityType: 'T', entityId: '1' });
    d.isNew = false;
    await expect(d.save()).rejects.toThrow(/append-only/);
  });
  it('the main fields are immutable on a document', () => {
    const d = new Real({ action: 'a', entityType: 'T', entityId: '1' });
    for (const f of ['at', 'action', 'entityType', 'entityId']) expect(Real.schema.path(f).options.immutable).toBe(true);
    expect(d.action).toBe('a');
  });
});

describe('audit service', () => {
  it('records actor, entity and the request id/ip from the current request, with before/after sanitised', async () => {
    m(AuditLog.create).mockResolvedValue({});
    await requestStore.run({ requestId: 'req-1', ip: '10.0.0.5', userAgent: 'jest' }, () => audit(actor, { action: 'user.updated', entityType: 'User', entityId: 'u9', entityNumber: 'x@y.z', summary: 's', before: { role: 'a', bankDetails: 'secret' }, after: { role: 'b' } }));
    expect(m(AuditLog.create).mock.calls[0][0]).toMatchObject({
      actor: { id: actor.id, name: 'Buyer One', role: 'procurement_manager' }, action: 'user.updated', entityType: 'User', entityId: 'u9', requestId: 'req-1', ip: '10.0.0.5',
      before: { role: 'a', bankDetails: '[redacted]' }, after: { role: 'b' },
    });
  });
  it('system events have a System actor and work without a request', async () => {
    m(AuditLog.create).mockResolvedValue({});
    await audit(null, { action: 'mrp.run', entityType: 'MRPRun', entityId: '1' });
    expect(m(AuditLog.create).mock.calls[0][0]).toMatchObject({ actor: { id: null, name: 'System' }, requestId: null });
  });
  it('a failed write is logged but never breaks the business action', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    m(AuditLog.create).mockRejectedValue(new Error('db down'));
    await expect(audit(actor, { action: 'rfq.created', entityType: 'RFQ', entityId: '1' })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('FAILED to record rfq.created'), 'db down');
    spy.mockRestore();
  });
  it('filters by entity, actor, action and date range and escapes the search text', async () => {
    m(AuditLog.find).mockReturnValue(chain([])); m(AuditLog.countDocuments).mockResolvedValue(0);
    await listAudit({ page: 1, limit: 25, entityType: 'PurchaseOrder', actor: 'u1', action: 'purchase_order.issued', from: new Date('2026-01-01'), to: new Date('2026-02-01'), search: 'PO-(1)' });
    const f = m(AuditLog.find).mock.calls[0][0];
    expect(f).toMatchObject({ entityType: 'PurchaseOrder', 'actor.id': 'u1', action: 'purchase_order.issued' });
    expect(f.at.$gte).toEqual(new Date('2026-01-01')); expect(f.$or[0].entityNumber.source).toBe('PO-\\(1\\)'); // regex metacharacters are escaped
  });
});

describe('notification delivery', () => {
  it('deduplicates recipients and never notifies the person who caused the event', async () => {
    await deliver(['a', 'b', 'a', null, undefined, 'actor'], { type: 'goods_received', title: 't' }, 'actor');
    expect(delivered().map((d) => d.recipient).sort()).toEqual(['a', 'b']);
  });
  it('repeating conditions use an upsert keyed on (recipient, dedupeKey) so they arrive once', async () => {
    await deliver(['a'], { type: 'low_stock', title: 't', dedupeKey: 'stock:m1:low:2026-11-25' });
    const op = m(Notification.bulkWrite).mock.calls[0][0][0];
    expect(op.updateOne.filter).toEqual({ recipient: 'a', dedupeKey: 'stock:m1:low:2026-11-25' }); expect(op.updateOne.upsert).toBe(true); expect(op.updateOne.update.$setOnInsert.readAt).toBeNull();
  });
  it('nobody to notify means no write', async () => { expect(await deliver([], { type: 'low_stock', title: 't' })).toBe(0); expect(Notification.bulkWrite).not.toHaveBeenCalled(); });
});

describe('role-aware business notifications', () => {
  const req = { _id: oid('r1'), number: 'PR-2026-0001', requestedBy: oid('req1'), requestedByName: 'Rafi', department: oid('d1') };
  it('a department-manager approval goes only to active managers of the SAME department', async () => {
    m(User.find).mockReturnValue(users('mgr1'));
    await notify.approvalNeeded(req, 'department_manager');
    expect(m(User.find).mock.calls[0][0]).toMatchObject({ role: { $in: ['department_manager'] }, status: 'active', department: String(req.department) });
    expect(delivered()[0]).toMatchObject({ recipient: 'mgr1', type: 'approval_requested', link: '/procurement/approvals' });
  });
  it('a procurement approval is not scoped to a department, and the requester is excluded', async () => {
    m(User.find).mockReturnValue(users('p1', String(req.requestedBy)));
    await notify.approvalNeeded(req, 'procurement_manager');
    expect(m(User.find).mock.calls[0][0].department).toBeUndefined();
    expect(delivered().map((d) => d.recipient)).toEqual(['p1']);
  });
  it.each([['Approved', 'requisition_approved'], ['Rejected', 'requisition_rejected'], ['Modification Requested', 'modification_requested']])('%s goes to the requester as %s', async (action, type) => {
    await notify.requisitionDecided(req, action);
    expect(delivered()[0]).toMatchObject({ recipient: String(req.requestedBy), type });
  });
  it('an RFQ reaches only the user accounts linked to the invited suppliers', async () => {
    m(User.find).mockReturnValue(users('su1'));
    await notify.rfqPublished({ _id: oid('rfq1'), number: 'RFQ-1', deadline: new Date('2026-12-01') }, ['sup1', 'sup2']);
    expect(m(User.find).mock.calls[0][0]).toMatchObject({ role: 'supplier', status: 'active', supplier: { $in: ['sup1', 'sup2'] } });
    expect(delivered()[0].title).toContain('RFQ-1');
  });
  it('a quotation notice goes to the RFQ creator and reveals neither supplier nor price (sealed bids)', async () => {
    await notify.quotationSubmitted({ _id: oid('rfq1'), number: 'RFQ-1', createdBy: oid('buyer1') }, 'sup9');
    const d = delivered()[0];
    expect(d.recipient).toBe(oid('buyer1')); expect(JSON.stringify(d)).not.toMatch(/sup9|price|BDT/i);
  });
  it('an awarded supplier is told; nobody else on the RFQ is', async () => {
    m(User.find).mockReturnValue(users('su9'));
    await notify.supplierAwarded({ _id: oid('rfq1'), number: 'RFQ-1' }, 'sup9');
    expect(m(User.find).mock.calls[0][0].supplier).toEqual({ $in: ['sup9'] });
  });
  it('goods received tells the PO creator and the supplier users', async () => {
    m(PurchaseOrder.findById).mockReturnValue(chain({ _id: oid('po1'), number: 'PO-1', createdBy: oid('buyer1'), supplier: oid('sup1') }));
    m(User.find).mockReturnValue(users('su1'));
    await notify.goodsReceived({ receipt: { purchaseOrder: oid('po1') }, poStatus: 'partially_received' });
    expect(delivered().map((d) => d.recipient).sort()).toEqual([oid('buyer1'), 'su1'].sort());
  });
  it('a failing notification never throws into the business action', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    m(User.find).mockImplementation(() => { throw new Error('db down'); });
    await expect(notify.approvalNeeded(req, 'procurement_manager')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled(); spy.mockRestore();
  });
});

describe('low and critical stock notices', () => {
  const mat = { name: '[DEMO] HMS Scrap', sku: 'SCR-HMS', safetyStock: 100, minimumStock: 200, reorderPoint: 300 };
  const setup = (after: string) => { m(Material.findById).mockReturnValue(chain(mat)); m(StockLevel.find).mockReturnValue(chain([{ quantity: D(after) }])); m(User.find).mockReturnValue(users('inv1')); };
  it('notifies when stock falls INTO a worse level (critical)', async () => {
    setup('90'); await notify.stockDecreased('m1', '50'); // 140 (low) -> 90 (critical)
    expect(delivered()[0]).toMatchObject({ type: 'critical_stock', severity: 'critical' });
  });
  it('notifies for a drop into low, with a once-a-day dedupe key', async () => {
    setup('190'); await notify.stockDecreased('m1', '50'); // 240 (reorder) -> 190 (low)
    expect(delivered()[0]).toMatchObject({ type: 'low_stock' });
    expect(m(Notification.bulkWrite).mock.calls[0][0][0].updateOne.filter.dedupeKey).toMatch(/^stock:m1:low:\d{4}-\d{2}-\d{2}$/);
  });
  it('stays silent when the level does not get worse (already critical, or still healthy)', async () => {
    setup('50'); await notify.stockDecreased('m1', '10'); // 60 critical -> 50 critical
    setup('1000'); await notify.stockDecreased('m1', '10');
    expect(Notification.bulkWrite).not.toHaveBeenCalled();
  });
  it('notifies stock owners and buyers (by role), not everyone', async () => {
    setup('90'); await notify.stockDecreased('m1', '50');
    expect(m(User.find).mock.calls[0][0].role.$in.sort()).toEqual(['inventory_officer', 'procurement_manager']);
  });
});

describe('risk alert notifications', () => {
  it('low-severity alerts raise no notification', async () => {
    await notify.riskAlertRaised({ number: 'RSK-1', category: 'delayed_po', severity: 'low', title: 't' });
    expect(Notification.bulkWrite).not.toHaveBeenCalled();
  });
  it('reaches holders of risks:review, typed by category (delayed delivery, supplier performance, other)', async () => {
    m(Role.find).mockReturnValue(chain([{ name: 'procurement_manager' }])); m(User.find).mockReturnValue(users('p1'));
    await notify.riskAlertRaised({ number: 'RSK-1', category: 'delayed_po', severity: 'high', title: 'PO late' });
    await notify.riskAlertRaised({ number: 'RSK-2', category: 'supplier_quality', severity: 'critical', title: 'Quality' });
    await notify.riskAlertRaised({ number: 'RSK-3', category: 'duplicate_invoice', severity: 'medium', title: 'Dup' });
    expect(m(Role.find).mock.calls[0][0]).toEqual({ permissions: 'risks:review' });
    expect(delivered().map((d) => d.type)).toEqual(['delayed_delivery', 'supplier_performance', 'risk_alert']);
    expect(delivered()[1].severity).toBe('critical');
  });
});

describe('own-notification access', () => {
  it('marking read is scoped to the caller: someone else\'s notification does not match', async () => {
    m(Notification.updateOne).mockResolvedValue({ matchedCount: 0 });
    expect(await notificationService.markRead('me', 'n1')).toBe(0);
    expect(m(Notification.updateOne).mock.calls[0][0]).toEqual({ _id: 'n1', recipient: 'me', readAt: null });
  });
  it('list and unread count are filtered by the recipient', async () => {
    m(Notification.find).mockReturnValue(chain([])); m(Notification.countDocuments).mockResolvedValue(0);
    await notificationService.list('me', { page: 1, limit: 20, unreadOnly: true });
    expect(m(Notification.find).mock.calls[0][0]).toEqual({ recipient: 'me', readAt: null });
    m(Notification.updateMany).mockResolvedValue({ modifiedCount: 0 });
    await notificationService.markAllRead('me');
    expect(m(Notification.updateMany).mock.calls[0][0]).toEqual({ recipient: 'me', readAt: null });
  });
});
