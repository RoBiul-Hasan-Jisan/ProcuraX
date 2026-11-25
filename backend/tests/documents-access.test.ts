import { oid } from './helpers';

const lean = (v: any) => ({ select: () => ({ lean: async () => v }), lean: async () => v });
const m = (name: string) => ({ findById: jest.fn(), findOne: jest.fn(), countDocuments: jest.fn(), create: jest.fn(), find: jest.fn(), updateOne: jest.fn() });
jest.mock('../src/models/Supplier', () => ({ Supplier: { findById: jest.fn() } }));
jest.mock('../src/models/SupplierQuotation', () => ({ SupplierQuotation: { findById: jest.fn() } }));
jest.mock('../src/models/RFQ', () => ({ RFQ: { findById: jest.fn() } }));
jest.mock('../src/models/PurchaseRequisition', () => ({ PurchaseRequisition: { findOne: jest.fn() } }));
jest.mock('../src/models/PurchaseOrder', () => ({ PurchaseOrder: { findById: jest.fn() } }));
jest.mock('../src/models/GoodsReceipt', () => ({ GoodsReceipt: { findById: jest.fn() } }));
jest.mock('../src/models/Invoice', () => ({ Invoice: { findById: jest.fn() } }));
jest.mock('../src/models/DocumentFile', () => ({ DocumentFile: { findOne: jest.fn(), countDocuments: jest.fn(), create: jest.fn(), find: jest.fn(), updateOne: jest.fn() } }));
jest.mock('../src/services/comparisonService', () => ({ isOpenedForComparison: (r: any) => r.status !== 'open' || r.deadline.getTime() <= Date.now() }));
jest.mock('../src/services/scope', () => ({ requisitionScope: () => ({}) }));

import { assertEntityAccess, uploadDocument } from '../src/services/documentService';
import { Supplier } from '../src/models/Supplier';
import { SupplierQuotation } from '../src/models/SupplierQuotation';
import { RFQ } from '../src/models/RFQ';
import { PurchaseOrder } from '../src/models/PurchaseOrder';
import { Invoice } from '../src/models/Invoice';
import { PurchaseRequisition } from '../src/models/PurchaseRequisition';
import { DocumentFile } from '../src/models/DocumentFile';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/utils/permissions';

const user = (role: string, extra: any = {}): any => ({ id: oid('u'), displayName: 'U', role, permissions: DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS] ?? [], supplierId: null, departmentId: null, ...extra });
const mine = oid('sup1'), other = oid('sup2');
const future = new Date(Date.now() + 86400000), past = new Date(Date.now() - 86400000);
const set = (model: any, fn: string, v: any) => (model[fn] as jest.Mock).mockReturnValue(lean(v));
const code = async (p: Promise<unknown>) => p.then(() => 0, (e: any) => e.statusCode ?? e.status ?? -1);

describe('document access rules', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a supplier cannot see another supplier\'s quotation documents', async () => {
    set(SupplierQuotation, 'findById', { supplier: other, rfq: oid('r'), status: 'submitted' });
    set(RFQ, 'findById', { number: 'RFQ-1', status: 'open', deadline: future });
    expect(await code(assertEntityAccess(user('supplier', { supplierId: mine }), 'quotation', oid('q'), 'read'))).toBe(404);
  });
  it('staff cannot read quotation documents while the RFQ is sealed', async () => {
    set(SupplierQuotation, 'findById', { supplier: mine, rfq: oid('r'), status: 'submitted' });
    set(RFQ, 'findById', { number: 'RFQ-1', status: 'open', deadline: future });
    expect(await code(assertEntityAccess(user('procurement_manager'), 'quotation', oid('q'), 'read'))).toBe(404);
  });
  it('staff can read them once the deadline has passed', async () => {
    set(SupplierQuotation, 'findById', { supplier: mine, rfq: oid('r'), status: 'submitted' });
    set(RFQ, 'findById', { number: 'RFQ-1', status: 'open', deadline: past });
    expect((await assertEntityAccess(user('procurement_manager'), 'quotation', oid('q'), 'read')).number).toBe('RFQ-1');
  });
  it('a supplier cannot attach to a quotation after the deadline', async () => {
    set(SupplierQuotation, 'findById', { supplier: mine, rfq: oid('r'), status: 'submitted' });
    set(RFQ, 'findById', { number: 'RFQ-1', status: 'open', deadline: past });
    expect(await code(assertEntityAccess(user('supplier', { supplierId: mine }), 'quotation', oid('q'), 'upload'))).toBe(409);
  });
  it('staff can never upload onto a supplier quotation', async () => {
    set(SupplierQuotation, 'findById', { supplier: mine, rfq: oid('r'), status: 'submitted' });
    set(RFQ, 'findById', { number: 'RFQ-1', status: 'closed', deadline: past });
    expect(await code(assertEntityAccess(user('procurement_manager'), 'quotation', oid('q'), 'upload'))).toBe(403);
  });
  it('a supplier cannot see another supplier\'s PO nor any draft PO', async () => {
    set(PurchaseOrder, 'findById', { number: 'PO-1', supplier: other, status: 'issued' });
    expect(await code(assertEntityAccess(user('supplier', { supplierId: mine }), 'purchase_order', oid('p'), 'read'))).toBe(404);
    set(PurchaseOrder, 'findById', { number: 'PO-1', supplier: mine, status: 'draft' });
    expect(await code(assertEntityAccess(user('supplier', { supplierId: mine }), 'purchase_order', oid('p'), 'read'))).toBe(404);
  });
  it('a supplier may attach delivery documents to their own open PO only', async () => {
    set(PurchaseOrder, 'findById', { number: 'PO-1', supplier: mine, status: 'issued' });
    expect((await assertEntityAccess(user('supplier', { supplierId: mine }), 'purchase_order', oid('p'), 'upload')).number).toBe('PO-1');
    set(PurchaseOrder, 'findById', { number: 'PO-1', supplier: mine, status: 'closed' });
    expect(await code(assertEntityAccess(user('supplier', { supplierId: mine }), 'purchase_order', oid('p'), 'upload'))).toBe(409);
  });
  it('a supplier can read but not upload invoice documents on their own invoice, and not others\'', async () => {
    set(Invoice, 'findById', { number: 'INV-1', supplier: mine });
    expect((await assertEntityAccess(user('supplier', { supplierId: mine }), 'invoice', oid('i'), 'read')).number).toBe('INV-1');
    expect(await code(assertEntityAccess(user('supplier', { supplierId: mine }), 'invoice', oid('i'), 'upload'))).toBe(403);
    set(Invoice, 'findById', { number: 'INV-1', supplier: other });
    expect(await code(assertEntityAccess(user('supplier', { supplierId: mine }), 'invoice', oid('i'), 'read'))).toBe(404);
  });
  it('suppliers never reach requisitions', async () => {
    expect(await code(assertEntityAccess(user('supplier', { supplierId: mine }), 'requisition', oid('r'), 'read'))).toBe(404);
  });
  it('an out-of-scope requisition reads as not found', async () => {
    set(PurchaseRequisition, 'findOne', null);
    expect(await code(assertEntityAccess(user('department_manager'), 'requisition', oid('r'), 'read'))).toBe(404);
  });
  it('a supplier can only manage their own profile documents', async () => {
    set(Supplier, 'findById', { supplierCode: 'S1' });
    expect((await assertEntityAccess(user('supplier', { supplierId: mine }), 'supplier', mine, 'upload')).number).toBe('S1');
    expect(await code(assertEntityAccess(user('supplier', { supplierId: mine }), 'supplier', other, 'upload'))).toBe(403);
  });
});

describe('uploadDocument', () => {
  beforeEach(() => jest.clearAllMocks());
  it('rejects invalid content before touching storage or the database', async () => {
    const exe = Buffer.from('MZ\x90\x00');
    expect(await code(uploadDocument(user('procurement_manager'), { entityType: 'invoice', entityId: oid('i') }, { originalName: 'a.pdf', size: exe.length, buffer: exe }))).toBe(400);
    expect(DocumentFile.create).not.toHaveBeenCalled();
  });
  it('requires a file', async () => {
    expect(await code(uploadDocument(user('procurement_manager'), { entityType: 'invoice', entityId: oid('i') }, undefined))).toBe(400);
  });
});
