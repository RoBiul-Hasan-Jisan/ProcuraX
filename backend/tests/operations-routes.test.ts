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
  person('buyer', 'procurement_manager');
  person('exec', 'management');
  person('admin', 'system_admin');
});
const api = '/api/v1';
const ID = oid('abc123');

describe('audit log access', () => {
  it.each(['vendor', 'deptmgr', 'inv', 'fin', 'buyer', 'exec'])('%s cannot read the audit log', async (who) => {
    for (const url of ['/audit-logs', `/audit-logs/${ID}`, '/audit-logs/actions']) expect((await request(app).get(api + url).set(as(who))).status).toBe(403);
  });
  it('requires authentication', async () => { expect((await request(app).get(`${api}/audit-logs`)).status).toBe(401); });
  it('the administrator can list the action catalogue (no database needed)', async () => {
    const res = await request(app).get(`${api}/audit-logs/actions`).set(as('admin'));
    expect(res.status).toBe(200); expect(res.body.data).toContain('supplier.awarded');
  });
  it('validates filters', async () => {
    expect((await request(app).get(`${api}/audit-logs?from=not-a-date`).set(as('admin'))).status).toBe(400);
    expect((await request(app).get(`${api}/audit-logs?limit=1000`).set(as('admin'))).status).toBe(400);
    expect((await request(app).get(`${api}/audit-logs/zzz`).set(as('admin'))).status).toBe(400);
  });
  it('is read-only: no route exists to create, change or delete an entry, even for the administrator', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      for (const url of ['/audit-logs', `/audit-logs/${ID}`]) expect((await (request(app) as any)[method](api + url).set(as('admin')).send({})).status).toBe(404);
    }
  });
  it('only the administrator role holds the permission by default', () => {
    const { DEFAULT_ROLE_PERMISSIONS: P } = jest.requireActual('../src/utils/permissions');
    expect(P.system_admin).toContain('audit:view');
    for (const role of Object.keys(P).filter((r) => r !== 'system_admin')) expect(P[role]).not.toContain('audit:view');
  });
});

describe('notification access', () => {
  it('requires authentication on every endpoint', async () => {
    for (const url of ['/notifications', '/notifications/unread-count']) expect((await request(app).get(api + url)).status).toBe(401);
    for (const url of ['/notifications/read-all', `/notifications/${ID}/read`]) expect((await request(app).post(api + url)).status).toBe(401);
  });
  it('rejects malformed ids and query values before touching data', async () => {
    expect((await request(app).post(`${api}/notifications/zzz/read`).set(as('buyer'))).status).toBe(400);
    expect((await request(app).get(`${api}/notifications?limit=500`).set(as('buyer'))).status).toBe(400);
    expect((await request(app).get(`${api}/notifications?unreadOnly=maybe`).set(as('buyer'))).status).toBe(400);
  });
  it('a pending (not yet activated) account gets no notifications', async () => {
    person('newbie', 'procurement_manager', { status: 'pending' });
    expect((await request(app).get(`${api}/notifications`).set(as('newbie'))).status).toBe(403);
  });
  it('every default role can read its own notifications', () => {
    const { DEFAULT_ROLE_PERMISSIONS: P } = jest.requireActual('../src/utils/permissions');
    for (const role of Object.keys(P)) expect(P[role]).toContain('notifications:view');
  });
});
