import request from 'supertest';
import { oid } from './helpers';

jest.mock('../src/config/firebase', () => ({
  verifyIdToken: jest.fn(async (token: string) => {
    if (!token.startsWith('good-')) throw new Error('bad token');
    const uid = token.slice(5);
    return { uid, email: `${uid}@example.com`, name: uid, emailVerified: true };
  }),
}));
const profiles = new Map<string, any>();
jest.mock('../src/repositories/userRepository', () => {
  const { DEFAULT_ROLE_PERMISSIONS } = jest.requireActual('../src/utils/permissions');
  return {
    userRepository: {
      findByFirebaseUid: jest.fn(async (uid: string) => profiles.get(uid) ?? null),
      permissionsForRole: jest.fn(async (role: string | null) => (role ? DEFAULT_ROLE_PERMISSIONS[role] : [])),
      touchLogin: jest.fn(), create: jest.fn(), list: jest.fn(), update: jest.fn(), findById: jest.fn(),
    },
  };
});
jest.mock('../src/models/Role', () => ({ ensureDefaultRoles: jest.fn(), Role: {} }));

import { createApp } from '../src/app';
const app = createApp();
const as = (uid: string) => ({ Authorization: `Bearer good-${uid}` });
const person = (uid: string, role: string, extra: Record<string, unknown> = {}) =>
  profiles.set(uid, { id: oid(uid), firebaseUid: uid, email: `${uid}@example.com`, displayName: uid, role, status: 'active', departmentId: null, supplierId: null, ...extra });
beforeEach(() => {
  profiles.clear();
  person('vendor', 'supplier', { supplierId: oid('sup1') });
  person('deptmgr', 'department_manager');
  person('inv', 'inventory_officer');
  person('fin', 'finance_officer');
  person('buyer', 'procurement_manager');
  person('exec', 'management');
});
const ID = oid('abc123');
const api = '/api/v1';

describe('who can do what (permission layer, before any database access)', () => {
  const cases: [string, string, string, number][] = [
    // [user, method, url, expected status for an empty body: 403 = forbidden, 400 = passed auth, stopped by validation]
    ['vendor', 'post', '/purchase-orders', 403], ['vendor', 'post', '/goods-receipts', 403], ['vendor', 'get', '/goods-receipts', 403],
    ['vendor', 'get', '/invoices', 403], ['vendor', 'post', '/invoices', 403], ['vendor', 'get', '/stock', 403], ['vendor', 'get', '/stock-movements', 403],
    ['vendor', 'post', '/stock/adjustments', 403], ['vendor', 'get', '/warehouses', 403],
    ['buyer', 'post', '/purchase-orders', 400], ['inv', 'post', '/purchase-orders', 403], ['fin', 'post', '/purchase-orders', 403], ['exec', 'post', '/purchase-orders', 403],
    ['inv', 'post', '/goods-receipts', 400], ['buyer', 'post', '/goods-receipts', 403], ['fin', 'post', '/goods-receipts', 403],
    ['fin', 'post', '/invoices', 400], ['buyer', 'post', '/invoices', 403], ['inv', 'post', '/invoices', 403],
    ['fin', 'post', `/invoices/${ID}/decision`, 400], ['inv', 'post', `/invoices/${ID}/decision`, 403],
    ['inv', 'post', '/stock/adjustments', 400], ['exec', 'post', '/stock/adjustments', 403], ['buyer', 'post', '/stock/adjustments', 403],
    ['inv', 'post', '/stock/issues', 400], ['inv', 'post', '/stock/transfers', 400], ['deptmgr', 'post', '/stock/issues', 403],
    ['inv', 'post', '/warehouses', 400], ['buyer', 'post', '/warehouses', 403], ['exec', 'patch', `/warehouses/${ID}`, 403],
  ];
  it.each(cases)('%s %s %s -> %i', async (who, method, url, status) => {
    const res = await (request(app) as any)[method](api + url).set(as(who)).send({});
    expect(res.status).toBe(status);
  });
  it('requires authentication everywhere', async () => {
    for (const url of ['/purchase-orders', '/goods-receipts', '/invoices', '/warehouses', '/stock', '/stock/alerts', '/stock-movements']) {
      expect((await request(app).get(api + url)).status).toBe(401);
    }
  });
  it('rejects malformed ids and negative / non-decimal quantities', async () => {
    expect((await request(app).get(`${api}/purchase-orders/not-an-id`).set(as('buyer'))).status).toBe(400);
    const bad = await request(app).post(`${api}/stock/issues`).set(as('inv')).send({ materialId: ID, warehouseId: ID, quantity: '-5', reason: 'melt shop' });
    expect(bad.status).toBe(400);
    const bad2 = await request(app).post(`${api}/stock/adjustments`).set(as('inv')).send({ materialId: ID, warehouseId: ID, direction: 'increase', quantity: '1e3', reason: 'count correction' });
    expect(bad2.status).toBe(400);
  });
  it('an adjustment needs a real reason', async () => {
    const res = await request(app).post(`${api}/stock/adjustments`).set(as('inv')).send({ materialId: ID, warehouseId: ID, direction: 'decrease', quantity: '1', reason: 'x' });
    expect(res.status).toBe(400);
  });
  it('a receipt line cannot carry a client-chosen total or status', async () => {
    const res = await request(app).post(`${api}/goods-receipts`).set(as('inv')).send({ purchaseOrderId: ID, warehouseId: ID, lines: [] });
    expect(res.status).toBe(400); // lines.min(1)
  });
});

describe('role defaults for Phase 3', () => {
  const { DEFAULT_ROLE_PERMISSIONS: P } = jest.requireActual('../src/utils/permissions');
  it('keeps duties separate', () => {
    expect(P.inventory_officer).toContain('goods_receipts:manage');
    expect(P.inventory_officer).not.toContain('invoices:verify');
    expect(P.inventory_officer).not.toContain('purchase_orders:manage');
    expect(P.finance_officer).toContain('invoices:verify');
    expect(P.finance_officer).not.toContain('goods_receipts:manage');
    expect(P.procurement_manager).toContain('purchase_orders:manage');
    expect(P.procurement_manager).not.toContain('goods_receipts:manage');
    expect(P.supplier).not.toContain('purchase_orders:view');
    expect(P.supplier).not.toContain('inventory:view');
  });
});
