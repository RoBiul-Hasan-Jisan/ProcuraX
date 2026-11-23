import request from 'supertest';

// Firebase Admin is mocked: tokens "good-<uid>" verify, anything else is rejected.
jest.mock('../src/config/firebase', () => ({
  verifyIdToken: jest.fn(async (token: string) => {
    if (!token.startsWith('good-')) throw new Error('bad token');
    const uid = token.slice(5);
    return { uid, email: `${uid}@example.com`, name: uid, emailVerified: true };
  }),
}));

// In-memory stand-in for the MongoDB-backed repository.
const profiles = new Map<string, any>();
const oid = (uid: string) => Buffer.from(uid).toString('hex').padEnd(24, '0').slice(0, 24);
jest.mock('../src/repositories/userRepository', () => {
  const { DEFAULT_ROLE_PERMISSIONS } = jest.requireActual('../src/utils/permissions');
  return {
    userRepository: {
      findByFirebaseUid: jest.fn(async (uid: string) => profiles.get(uid) ?? null),
      create: jest.fn(async (input: any) => {
        const p = { id: oid(input.firebaseUid), departmentId: null, supplierId: null, ...input };
        profiles.set(input.firebaseUid, p);
        return p;
      }),
      touchLogin: jest.fn(async () => undefined),
      permissionsForRole: jest.fn(async (role: string | null) => (role ? DEFAULT_ROLE_PERMISSIONS[role] : [])),
      list: jest.fn(async () => ({ items: [...profiles.values()], total: profiles.size })),
      update: jest.fn(async (id: string, patch: any) => {
        const p = [...profiles.values()].find((x) => x.id === id);
        if (!p) return null;
        Object.assign(p, patch);
        return p;
      }),
    },
  };
});
jest.mock('../src/models/Role', () => ({ ensureDefaultRoles: jest.fn(async () => undefined), Role: {} }));

import { createApp } from '../src/app';

const app = createApp();
const bearer = (uid: string) => ({ Authorization: `Bearer good-${uid}` });
const seed = (uid: string, role: string | null, status: string) =>
  profiles.set(uid, {
    id: oid(uid), firebaseUid: uid, email: `${uid}@example.com`, displayName: uid,
    role, status, departmentId: null, supplierId: null,
  });

beforeEach(() => {
  profiles.clear();
  seed('admin', 'system_admin', 'active');
  seed('buyer', 'procurement_manager', 'active');
  seed('vendor', 'supplier', 'active');
  seed('newbie', null, 'pending');
  seed('blocked', 'inventory_officer', 'suspended');
});

describe('Firebase token verification', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
  it('rejects an invalid token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
  });
  it('accepts a valid token and returns DB-backed role and permissions', async () => {
    const res = await request(app).get('/api/v1/auth/me').set(bearer('buyer'));
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('procurement_manager');
    expect(res.body.data.permissions).toContain('rfq:manage');
  });
});

describe('Session provisioning', () => {
  it('creates a pending profile with no role for a new user', async () => {
    const res = await request(app).post('/api/v1/auth/session').set(bearer('fresh'));
    expect(res.status).toBe(201);
    expect(res.body.data.user.status).toBe('pending');
    expect(res.body.data.user.role).toBeNull();
    expect(res.body.data.permissions).toEqual([]);
  });
  it('ignores a role supplied by the client', async () => {
    const res = await request(app)
      .post('/api/v1/auth/session')
      .set(bearer('sneaky'))
      .send({ role: 'system_admin', status: 'active' });
    expect(res.body.data.user.role).toBeNull();
    expect(res.body.data.user.status).toBe('pending');
  });
  it('bootstraps the configured admin email only', async () => {
    const res = await request(app).post('/api/v1/auth/session').set(bearer('boss'));
    expect(res.body.data.user.role).toBe('system_admin');
    expect(res.body.data.user.status).toBe('active');
  });
});

describe('Account status and RBAC', () => {
  it('blocks pending accounts from business routes', async () => {
    const res = await request(app).get('/api/v1/dashboard/overview').set(bearer('newbie'));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_PENDING');
  });
  it('blocks suspended accounts', async () => {
    const res = await request(app).get('/api/v1/dashboard/overview').set(bearer('blocked'));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
  });
  it('denies a supplier the executive dashboard', async () => {
    const res = await request(app).get('/api/v1/dashboard/overview').set(bearer('vendor'));
    expect(res.status).toBe(403);
  });
  it('denies non-admins user management', async () => {
    const res = await request(app).get('/api/v1/users').set(bearer('buyer'));
    expect(res.status).toBe(403);
  });
  it('lets an admin list users', async () => {
    const res = await request(app).get('/api/v1/users').set(bearer('admin'));
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(5);
  });
  it('stops admins editing their own role', async () => {
    const res = await request(app).patch(`/api/v1/users/${oid('admin')}`).set(bearer('admin')).send({ role: 'supplier' });
    expect(res.status).toBe(403);
  });
  it('validates the user update payload', async () => {
    const res = await request(app).patch(`/api/v1/users/${oid('newbie')}`).set(bearer('admin')).send({ role: 'god' });
    expect(res.status).toBe(400);
  });
});

describe('Request hygiene', () => {
  it('strips $-operators from query strings without crashing', async () => {
    const res = await request(app).get('/api/v1/users?status[$ne]=x').set(bearer('admin'));
    expect(res.status).toBe(200);
  });
  it('returns a JSON 404 without stack traces', async () => {
    const res = await request(app).get('/api/v1/nothing-here');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
  });
});
