import request from 'supertest';
import { oid } from './helpers';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

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
  return { userRepository: {
    findByFirebaseUid: jest.fn(async (uid: string) => profiles.get(uid) ?? null),
    permissionsForRole: jest.fn(async (role: string | null) => (role ? DEFAULT_ROLE_PERMISSIONS[role] : [])),
    touchLogin: jest.fn(), create: jest.fn(), list: jest.fn(), update: jest.fn(), findById: jest.fn(),
  } };
});
jest.mock('../src/models/Role', () => ({ ensureDefaultRoles: jest.fn(), Role: {} }));
jest.mock('../src/services/documentService');

import { createApp } from '../src/app';
import * as svc from '../src/services/documentService';
import { LocalStorage } from '../src/services/storage';
import { sniff, validateUpload, makeKey, displayName } from '../src/domain/documents';

const app = createApp();
const as = (uid: string) => ({ Authorization: `Bearer good-${uid}` });
const person = (uid: string, role: string, extra: Record<string, unknown> = {}) =>
  profiles.set(uid, { id: oid(uid), firebaseUid: uid, email: `${uid}@example.com`, displayName: uid, role, status: 'active', departmentId: null, supplierId: null, ...extra });
const api = '/api/v1';
const ID = oid('abc123');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');

beforeEach(() => { profiles.clear(); person('buyer', 'procurement_manager'); Object.values(svc).forEach((f: any) => f?.mockReset?.()); });

describe('document content validation', () => {
  it('detects type from bytes, not from the name', () => {
    expect(sniff(PDF)).toBe('pdf');
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png');
  });
  it('accepts a matching pdf', () => {
    expect(validateUpload({ originalName: 'quote.pdf', size: PDF.length, buffer: PDF }, 1024).ok).toBe(true);
  });
  it('rejects an executable renamed to .pdf', () => {
    const exe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00');
    expect(validateUpload({ originalName: 'quote.pdf', size: exe.length, buffer: exe }, 1024).ok).toBe(false);
  });
  it('rejects a pdf with the wrong extension', () => {
    expect(validateUpload({ originalName: 'quote.png', size: PDF.length, buffer: PDF }, 1024).ok).toBe(false);
  });
  it('rejects disallowed extensions and oversize files', () => {
    expect(validateUpload({ originalName: 'a.exe', size: 5, buffer: Buffer.from('hello') }, 1024).ok).toBe(false);
    expect(validateUpload({ originalName: 'a.pdf', size: 5000, buffer: PDF }, 1024).ok).toBe(false);
  });
  it('rejects empty files', () => {
    expect(validateUpload({ originalName: 'a.txt', size: 0, buffer: Buffer.alloc(0) }, 1024).ok).toBe(false);
  });
  it('makes server keys that carry no user input, and strips paths from display names', () => {
    const k = makeKey('invoice', '123e4567-e89b-42d3-a456-426614174000', 'pdf');
    expect(k).toMatch(/^invoice\/[0-9a-f-]{36}\.pdf$/);
    expect(displayName('../../etc/passwd.pdf')).not.toContain('/');
  });
});

describe('local storage', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sp-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const key = 'invoice/123e4567-e89b-42d3-a456-426614174000.pdf';
  it('stores, reads back and removes', async () => {
    const s = new LocalStorage(dir);
    await s.put(key, PDF);
    const chunks: Buffer[] = [];
    for await (const c of s.get(key) as Readable) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).equals(PDF)).toBe(true);
    await s.remove(key);
  });
  it('refuses traversal and unexpected keys', async () => {
    const s = new LocalStorage(dir);
    await expect(s.put('../../evil.pdf', PDF)).rejects.toBeDefined();
    await expect(s.put('invoice/../../x.pdf', PDF)).rejects.toBeDefined();
  });
  it('never overwrites an existing key', async () => {
    const s = new LocalStorage(dir);
    await s.put(key, PDF);
    await expect(s.put(key, PDF)).rejects.toBeDefined();
  });
});

describe('document routes', () => {
  it('requires authentication', async () => {
    expect((await request(app).get(`${api}/documents`)).status).toBe(401);
    expect((await request(app).get(`${api}/documents/${ID}/download`)).status).toBe(401);
  });
  it('validates list query', async () => {
    expect((await request(app).get(`${api}/documents?entityType=bogus&entityId=${ID}`).set(as('buyer'))).status).toBe(400);
    expect((await request(app).get(`${api}/documents?entityType=invoice&entityId=nope`).set(as('buyer'))).status).toBe(400);
  });
  it('lists through the service with the caller', async () => {
    (svc.listDocuments as jest.Mock).mockResolvedValue([]);
    const res = await request(app).get(`${api}/documents?entityType=invoice&entityId=${ID}`).set(as('buyer'));
    expect(res.status).toBe(200);
    expect((svc.listDocuments as jest.Mock).mock.calls[0][0].id).toBe(oid('buyer'));
  });
  it('uploads a multipart file and passes bytes to the service', async () => {
    (svc.uploadDocument as jest.Mock).mockResolvedValue({ id: ID });
    const res = await request(app).post(`${api}/documents`).set(as('buyer'))
      .field('entityType', 'invoice').field('entityId', ID).attach('file', PDF, 'inv.pdf');
    expect(res.status).toBe(201);
    const [, input, file] = (svc.uploadDocument as jest.Mock).mock.calls[0];
    expect(input.entityType).toBe('invoice');
    expect(file.originalName).toBe('inv.pdf');
    expect(file.buffer.equals(PDF)).toBe(true);
  });
  it('rejects a bad entity type before the service', async () => {
    const res = await request(app).post(`${api}/documents`).set(as('buyer')).field('entityType', 'x').field('entityId', ID).attach('file', PDF, 'a.pdf');
    expect(res.status).toBe(400);
    expect(svc.uploadDocument).not.toHaveBeenCalled();
  });
  it('streams downloads as attachments with nosniff', async () => {
    (svc.openDocument as jest.Mock).mockResolvedValue({ stream: Readable.from([PDF]), name: 'inv.pdf', mimeType: 'application/pdf', size: PDF.length });
    const res = await request(app).get(`${api}/documents/${ID}/download`).set(as('buyer'));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
  it('deletes through the service', async () => {
    (svc.deleteDocument as jest.Mock).mockResolvedValue(undefined);
    expect((await request(app).delete(`${api}/documents/${ID}`).set(as('buyer'))).status).toBe(200);
  });
});
