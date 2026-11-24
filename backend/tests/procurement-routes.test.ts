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
  person('deptmgr', 'department_manager', { departmentId: oid('d1') });
  person('inv', 'inventory_officer', { departmentId: oid('d1') });
  person('fin', 'finance_officer');
  person('buyer', 'procurement_manager');
  person('exec', 'management');
});

const ID = oid('abc123');

describe('supplier isolation at the route level', () => {
  const denied: [string, string][] = [
    ['get', '/api/v1/requisitions'], ['get', '/api/v1/suppliers'], ['get', '/api/v1/materials'],
    ['get', '/api/v1/approvals'], ['post', '/api/v1/rfqs'], ['post', `/api/v1/rfqs/${ID}/close`],
    ['get', `/api/v1/quotation-comparisons/${ID}`], ['post', `/api/v1/quotation-comparisons/${ID}/award`],
    ['get', '/api/v1/settings/scoring'], ['put', '/api/v1/settings/scoring'], ['get', '/api/v1/dashboard/overview'],
  ];
  it.each(denied)('forbids a supplier from %s %s', async (method, url) => {
    const res = await (request(app) as any)[method](url).set(as('vendor')).send({});
    expect(res.status).toBe(403);
  });
  it('lets a supplier reach supplier-only endpoints past authorization', async () => {
    // body is invalid on purpose: a 400 (validation) proves the permission check passed.
    const res = await request(app).put(`/api/v1/rfqs/${ID}/quotation`).set(as('vendor')).send({});
    expect(res.status).toBe(400);
  });
  it('forbids non-suppliers from submitting quotations', async () => {
    const res = await request(app).put(`/api/v1/rfqs/${ID}/quotation`).set(as('buyer')).send({});
    expect(res.status).toBe(403);
  });
});

describe('role boundaries', () => {
  it('only procurement may create RFQs', async () => {
    for (const uid of ['deptmgr', 'inv', 'fin', 'exec']) {
      const res = await request(app).post('/api/v1/rfqs').set(as(uid)).send({});
      expect(res.status).toBe(403);
    }
  });
  it('finance and department managers cannot award a supplier', async () => {
    for (const uid of ['fin', 'deptmgr', 'exec']) {
      const res = await request(app).post(`/api/v1/quotation-comparisons/${ID}/award`).set(as(uid)).send({});
      expect(res.status).toBe(403);
    }
  });
  it('management is read-only on requisitions', async () => {
    const res = await request(app).post('/api/v1/requisitions').set(as('exec')).send({});
    expect(res.status).toBe(403);
  });
  it('only approvers may decide', async () => {
    for (const uid of ['inv', 'exec', 'vendor']) {
      const res = await request(app).post(`/api/v1/approvals/${ID}/decision`).set(as(uid)).send({ action: 'approve' });
      expect(res.status).toBe(403);
    }
  });
  it('only settings managers may change the approval threshold', async () => {
    const res = await request(app).put('/api/v1/settings/approval').set(as('buyer')).send({ financeThreshold: '5', currency: 'BDT' });
    expect(res.status).toBe(403);
  });
  it('requires authentication for every new route', async () => {
    for (const url of ['/api/v1/materials', '/api/v1/suppliers', '/api/v1/requisitions', '/api/v1/rfqs', `/api/v1/quotation-comparisons/${ID}`]) {
      expect((await request(app).get(url)).status).toBe(401);
    }
  });
});

describe('request validation', () => {
  const future = new Date(Date.now() + 864e5 * 10).toISOString();
  const line = { materialId: oid('m1'), quantity: '10', estimatedUnitPrice: '100' };
  const post = (body: unknown) => request(app).post('/api/v1/requisitions').set(as('inv')).send(body as object);

  it('rejects an empty item list', async () => expect((await post({ items: [], requiredDate: future, reason: 'need steel' })).status).toBe(400));
  it('rejects zero or negative quantities', async () => {
    expect((await post({ items: [{ ...line, quantity: '0' }], requiredDate: future, reason: 'need steel' })).status).toBe(400);
    expect((await post({ items: [{ ...line, quantity: '-5' }], requiredDate: future, reason: 'need steel' })).status).toBe(400);
  });
  it('rejects past required dates and missing reasons', async () => {
    expect((await post({ items: [line], requiredDate: '2020-01-01', reason: 'need steel' })).status).toBe(400);
    expect((await post({ items: [line], requiredDate: future, reason: '' })).status).toBe(400);
  });
  it('rejects malformed ids and non-numeric prices', async () => {
    expect((await post({ items: [{ ...line, materialId: 'nope' }], requiredDate: future, reason: 'need steel' })).status).toBe(400);
    expect((await post({ items: [{ ...line, estimatedUnitPrice: '12abc' }], requiredDate: future, reason: 'need steel' })).status).toBe(400);
  });
  it('rejects an invalid id parameter', async () => expect((await request(app).get('/api/v1/requisitions/not-an-id').set(as('inv'))).status).toBe(400));
  it('rejects an unknown decision action', async () => {
    expect((await request(app).post(`/api/v1/approvals/${ID}/decision`).set(as('buyer')).send({ action: 'rubber_stamp' })).status).toBe(400);
  });
  it('rejects weights that sum to zero and negative weights', async () => {
    expect((await request(app).put('/api/v1/settings/scoring').set(as('buyer')).send({ price: 0, delivery: 0, quality: 0, leadTime: 0, payment: 0 })).status).toBe(400);
    expect((await request(app).put('/api/v1/settings/scoring').set(as('buyer')).send({ price: -1, delivery: 1, quality: 1, leadTime: 1, payment: 1 })).status).toBe(400);
  });
  it('rejects an RFQ with no invited suppliers', async () => {
    const res = await request(app).post('/api/v1/rfqs').set(as('buyer')).send({ requisitionId: ID, deliveryLocation: 'Main yard', deadline: future, invitedSupplierIds: [] });
    expect(res.status).toBe(400);
  });
  it('rejects a quotation with a tax rate or price that is not a number', async () => {
    const res = await request(app).put(`/api/v1/rfqs/${ID}/quotation`).set(as('vendor'))
      .send({ lines: [{ materialId: oid('m1'), unitPrice: 'free' }], deliveryDays: 5, paymentTerms: 'Net 30', validUntil: future });
    expect(res.status).toBe(400);
  });
});
