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

describe('intelligence permissions (checked before any database access)', () => {
  const cases: [string, string, string, number][] = [
    // suppliers and roles without intelligence access
    ['vendor', 'get', '/forecasting', 403], ['vendor', 'get', '/risk-alerts', 403], ['vendor', 'post', '/assistant/query', 403], ['vendor', 'get', '/supplier-scoring', 403],
    ['deptmgr', 'get', '/risk-alerts', 403], ['deptmgr', 'post', '/assistant/query', 403], ['fin', 'post', '/assistant/query', 403], ['fin', 'get', '/risk-alerts', 403],
    ['inv', 'get', '/risk-alerts', 403], ['inv', 'post', '/assistant/query', 403],
    // forecasts are generated only by people who can run MRP
    ['inv', 'post', '/forecasting/demand', 403], ['exec', 'post', '/forecasting/demand', 403], ['fin', 'post', '/forecasting/prices', 403], ['buyer', 'post', '/forecasting/demand', 400], ['buyer', 'post', '/forecasting/prices', 400],
    // reviewing risk is a duty: management can read alerts but not change them
    ['exec', 'post', `/risk-alerts/${ID}/review`, 403], ['exec', 'post', '/risk-alerts/scan', 403], ['inv', 'post', `/risk-alerts/${ID}/review`, 403], ['fin', 'post', '/risk-alerts/scan', 403],
    ['buyer', 'post', `/risk-alerts/${ID}/review`, 400], // empty body: authorised, stopped by validation
    ['buyer', 'post', '/assistant/query', 400], ['exec', 'post', '/assistant/query', 400],
  ];
  it.each(cases)('%s %s %s -> %i', async (who, method, url, status) => {
    const res = await (request(app) as any)[method](api + url).set(as(who)).send({});
    expect(res.status).toBe(status);
  });
  it('requires authentication on every endpoint', async () => {
    for (const url of ['/forecasting', '/forecasting/material/' + ID, '/risk-alerts', '/assistant/suggestions', '/assistant/history', '/supplier-scoring']) expect((await request(app).get(api + url)).status).toBe(401);
    for (const url of ['/forecasting/demand', '/risk-alerts/scan', '/assistant/query']) expect((await request(app).post(api + url).send({})).status).toBe(401);
  });
  it('rejects bad ids, bad status values and too-short questions', async () => {
    expect((await request(app).get(`${api}/risk-alerts/zzz`).set(as('buyer'))).status).toBe(400);
    expect((await request(app).post(`${api}/risk-alerts/${ID}/review`).set(as('buyer')).send({ status: 'open' })).status).toBe(400); // cannot move back to open
    expect((await request(app).post(`${api}/risk-alerts/${ID}/review`).set(as('buyer')).send({ status: 'guilty' })).status).toBe(400);
    expect((await request(app).post(`${api}/assistant/query`).set(as('buyer')).send({ question: 'hi' })).status).toBe(400);
    expect((await request(app).post(`${api}/forecasting/demand`).set(as('buyer')).send({ materialId: 'nope' })).status).toBe(400);
    expect((await request(app).get(`${api}/risk-alerts?severity=catastrophic`).set(as('buyer'))).status).toBe(400);
  });
  it('the assistant suggestions need no database', async () => {
    const res = await request(app).get(`${api}/assistant/suggestions`).set(as('exec'));
    expect(res.status).toBe(200); expect(res.body.data.length).toBeGreaterThan(5);
  });
});

describe('duties for intelligence', () => {
  const { DEFAULT_ROLE_PERMISSIONS: P } = jest.requireActual('../src/utils/permissions');
  it('only procurement and administration review risks; management reads but cannot act', () => {
    expect(P.procurement_manager).toContain('risks:review');
    expect(P.system_admin).toContain('risks:review');
    for (const role of ['management', 'finance_officer', 'inventory_officer', 'supplier', 'department_manager']) expect(P[role]).not.toContain('risks:review');
    expect(P.management).toContain('intelligence:view');
  });
  it('suppliers never get intelligence, forecasting or scoring permissions', () => {
    for (const p of ['intelligence:view', 'forecasting:view', 'risks:review', 'suppliers:view', 'reports:financial']) expect(P.supplier).not.toContain(p);
  });
});
