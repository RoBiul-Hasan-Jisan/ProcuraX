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
const api = '/api/v1';
const ID = oid('abc123');

describe('planning permissions (checked before any database access)', () => {
  // 403 = forbidden; 400 = passed authorization and stopped at validation with an empty body
  const cases: [string, string, string, number][] = [
    ['vendor', 'get', '/boms', 403], ['vendor', 'get', '/production-plans', 403], ['vendor', 'get', '/mrp/runs', 403], ['vendor', 'post', '/mrp/run', 403],
    ['vendor', 'get', '/finished-products', 403], ['vendor', 'get', '/reservations', 403], ['vendor', 'get', '/mrp/reorder-recommendations', 403],
    ['fin', 'post', '/mrp/run', 403], ['deptmgr', 'post', '/mrp/run', 403], ['inv', 'post', '/mrp/run', 403], ['exec', 'post', '/mrp/run', 403],
    ['buyer', 'post', '/mrp/run', 400], ['buyer', 'put', '/settings/mrp', 400], ['inv', 'put', '/settings/mrp', 403],
    ['inv', 'post', '/boms', 400], ['inv', 'post', '/production-plans', 400], ['inv', 'post', '/finished-products', 400],
    ['buyer', 'post', '/boms', 403], ['buyer', 'post', '/production-plans', 403], ['exec', 'post', '/boms', 403], ['fin', 'post', '/production-plans', 403],
    ['buyer', 'post', `/boms/${ID}/activate`, 403], ['exec', 'post', `/production-plans/${ID}/status`, 403],
    ['inv', 'post', '/reservations', 400], ['buyer', 'post', '/reservations', 403], ['exec', 'post', '/reservations', 403],
  ];
  it.each(cases)('%s %s %s -> %i', async (who, method, url, status) => {
    const res = await (request(app) as any)[method](api + url).set(as(who)).send({});
    expect(res.status).toBe(status);
  });
  it('requires authentication, including the settings route', async () => {
    for (const url of ['/boms', '/production-plans', '/mrp/runs', '/finished-products', '/reservations', '/settings/mrp']) expect((await request(app).get(api + url)).status).toBe(401);
  });
  it('rejects malformed ids and impossible input', async () => {
    expect((await request(app).get(`${api}/mrp/runs/zzz`).set(as('buyer'))).status).toBe(400);
    const run = await request(app).post(`${api}/mrp/run`).set(as('buyer')).send({ planIds: [], horizonDays: 30 });
    expect(run.status).toBe(400);
    const run2 = await request(app).post(`${api}/mrp/run`).set(as('buyer')).send({ planIds: [ID], horizonDays: 0 });
    expect(run2.status).toBe(400);
    const bom = await request(app).post(`${api}/boms`).set(as('inv')).send({ productId: ID, effectiveFrom: '2026-01-01', items: [{ materialId: ID, quantity: '0', wastagePercent: '0' }] });
    expect(bom.status).toBe(400);
    const bom2 = await request(app).post(`${api}/boms`).set(as('inv')).send({ productId: ID, effectiveFrom: '2026-01-01', items: [{ materialId: ID, quantity: '0.1234567', wastagePercent: '0' }] });
    expect(bom2.status).toBe(400); // more than 6 decimals
    const plan = await request(app).post(`${api}/production-plans`).set(as('inv')).send({ productId: ID, quantity: '-5', startDate: '2026-07-01', endDate: '2026-07-05' });
    expect(plan.status).toBe(400);
  });
  it('MRP settings reject a medium threshold below the high threshold', async () => {
    const res = await request(app).put(`${api}/settings/mrp`).set(as('buyer')).send({ horizonDays: 30, defaultLeadTimeDays: 14, urgency: { highDays: 10, mediumDays: 3 }, reorder: { lookbackDays: 90, coverageDays: 30 } });
    expect(res.status).toBe(400);
  });
});

describe('duties for planning', () => {
  const { DEFAULT_ROLE_PERMISSIONS: P } = jest.requireActual('../src/utils/permissions');
  it('production owners plan; procurement runs MRP; finance and suppliers do neither', () => {
    expect(P.inventory_officer).toContain('production:manage');
    expect(P.inventory_officer).not.toContain('mrp:run');
    expect(P.procurement_manager).toContain('mrp:run');
    expect(P.procurement_manager).not.toContain('production:manage');
    for (const role of ['finance_officer', 'supplier', 'department_manager']) { expect(P[role]).not.toContain('mrp:run'); expect(P[role]).not.toContain('production:manage'); }
  });
});
