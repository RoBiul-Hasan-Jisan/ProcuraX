import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DocumentFile } from '../models/DocumentFile';
import { Supplier } from '../models/Supplier';
import { SupplierQuotation } from '../models/SupplierQuotation';
import { RFQ } from '../models/RFQ';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { GoodsReceipt } from '../models/GoodsReceipt';
import { Invoice } from '../models/Invoice';
import { DEFAULT_MAX_BYTES, displayName, makeKey, validateUpload, type DocumentEntity } from '../domain/documents';
import { badRequest, conflict, forbidden, notFound } from '../utils/apiResponse';
import { isOpenedForComparison } from './comparisonService';
import { requisitionScope } from './scope';
import { audit } from './auditService';
import { getStorage } from './storage';
import type { UserContext } from '../types/express';

export const MAX_DOCS_PER_RECORD = 20;
export const maxUploadBytes = () => (Number(process.env.MAX_UPLOAD_MB) > 0 ? Number(process.env.MAX_UPLOAD_MB) * 1024 * 1024 : DEFAULT_MAX_BYTES);
const has = (u: UserContext, ...p: string[]) => p.some((x) => (u.permissions as string[]).includes(x));
const isSupplier = (u: UserContext) => u.role === 'supplier';
type Action = 'read' | 'upload';

/**
 * Who may read or add documents on a record. Rules mirror access to the record itself:
 * suppliers only ever reach documents on THEIR OWN records; a record you cannot see is reported as not found;
 * quotation attachments stay sealed from staff until the RFQ is opened for comparison.
 * Returns the record's display number for the audit trail.
 */
export async function assertEntityAccess(user: UserContext, type: DocumentEntity, id: string, action: Action): Promise<{ number: string }> {
  const deny = () => forbidden('You cannot add documents to this record');
  switch (type) {
    case 'supplier': {
      const s: any = await Supplier.findById(id).select('supplierCode').lean();
      if (!s) throw notFound('Record not found');
      const own = isSupplier(user) && user.supplierId === id;
      if (action === 'read' ? !(own || has(user, 'suppliers:view')) : !(own || has(user, 'suppliers:manage'))) throw action === 'read' ? notFound('Record not found') : deny();
      return { number: s.supplierCode ?? '' };
    }
    case 'quotation': {
      const q: any = await SupplierQuotation.findById(id).select('supplier rfq status').lean();
      if (!q) throw notFound('Record not found');
      const rfq: any = await RFQ.findById(q.rfq).select('number status deadline').lean();
      if (!rfq) throw notFound('Record not found');
      if (isSupplier(user)) {
        if (!user.supplierId || String(q.supplier) !== user.supplierId) throw notFound('Record not found');
        if (action === 'upload' && (q.status !== 'submitted' || rfq.status !== 'open' || rfq.deadline.getTime() <= Date.now())) throw conflict('Documents can only be added to a submitted quotation before the RFQ deadline');
      } else {
        if (action === 'upload') throw deny();
        if (!has(user, 'quotations:compare', 'rfq:manage') || !isOpenedForComparison(rfq)) throw notFound('Record not found'); // sealed bids stay sealed
      }
      return { number: rfq.number };
    }
    case 'requisition': {
      if (isSupplier(user)) throw notFound('Record not found');
      const r: any = await PurchaseRequisition.findOne({ _id: id, ...requisitionScope(user) }).select('number requestedBy status').lean();
      if (!r) throw notFound('Record not found');
      if (action === 'upload' && !((String(r.requestedBy) === user.id && r.status !== 'Cancelled') || has(user, 'rfq:manage'))) throw deny();
      return { number: r.number ?? '' };
    }
    case 'purchase_order': {
      const p: any = await PurchaseOrder.findById(id).select('number supplier status').lean();
      if (!p) throw notFound('Record not found');
      if (isSupplier(user)) {
        if (!user.supplierId || String(p.supplier) !== user.supplierId || p.status === 'draft') throw notFound('Record not found'); // suppliers never see drafts or others' orders
        if (action === 'upload' && !['issued', 'partially_received'].includes(p.status)) throw conflict('Delivery documents can only be added to an open purchase order');
      } else if (action === 'read' ? !has(user, 'purchase_orders:view', 'purchase_orders:manage') : !has(user, 'purchase_orders:manage', 'goods_receipts:manage')) {
        throw action === 'read' ? notFound('Record not found') : deny();
      }
      return { number: p.number };
    }
    case 'goods_receipt': {
      const g: any = await GoodsReceipt.findById(id).select('number').lean();
      if (!g || isSupplier(user)) throw notFound('Record not found');
      if (action === 'read' ? !has(user, 'goods_receipts:manage', 'purchase_orders:view', 'inventory:view') : !has(user, 'goods_receipts:manage')) throw action === 'read' ? notFound('Record not found') : deny();
      return { number: g.number ?? '' };
    }
    case 'invoice': {
      const i: any = await Invoice.findById(id).select('number supplier').lean();
      if (!i) throw notFound('Record not found');
      if (isSupplier(user)) { if (action === 'upload' || !user.supplierId || String(i.supplier) !== user.supplierId) throw action === 'upload' ? deny() : notFound('Record not found'); }
      else if (action === 'read' ? !has(user, 'invoices:verify', 'purchase_orders:view') : !has(user, 'invoices:verify')) throw action === 'read' ? notFound('Record not found') : deny();
      return { number: i.number ?? '' };
    }
  }
}

const present = (d: any) => ({ id: String(d._id), entityType: d.entityType, entityId: String(d.entityId), name: d.name, mimeType: d.mimeType, size: d.size, description: d.description, uploadedByName: d.uploadedByName, uploadedAt: d.createdAt });

export async function uploadDocument(user: UserContext, input: { entityType: DocumentEntity; entityId: string; description?: string }, file: { originalName: string; size: number; buffer: Buffer } | undefined) {
  if (!file) throw badRequest('Choose a file to upload');
  const verdict = validateUpload(file, maxUploadBytes());
  if (!verdict.ok) throw badRequest(verdict.reason);
  const { number } = await assertEntityAccess(user, input.entityType, input.entityId, 'upload');
  if ((await DocumentFile.countDocuments({ entityType: input.entityType, entityId: input.entityId, deletedAt: null })) >= MAX_DOCS_PER_RECORD) throw conflict(`A record can hold at most ${MAX_DOCS_PER_RECORD} documents`);

  const key = makeKey(input.entityType, randomUUID(), verdict.ext);
  const storage = getStorage();
  await storage.put(key, file.buffer);
  try {
    const doc = await DocumentFile.create({
      entityType: input.entityType, entityId: input.entityId, entityNumber: number, name: displayName(file.originalName), key, mimeType: verdict.mime, size: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'), description: (input.description ?? '').trim().slice(0, 300), uploadedBy: user.id, uploadedByName: user.displayName,
    });
    await audit(user, { action: 'document.uploaded', entityType: input.entityType, entityId: input.entityId, entityNumber: number, summary: `Uploaded document "${displayName(file.originalName)}"`, after: { documentId: String(doc._id), size: file.size, mimeType: verdict.mime } });
    return present(doc);
  } catch (e) {
    await storage.remove(key).catch(() => undefined); // no orphan bytes if the metadata could not be saved
    throw e;
  }
}

export async function listDocuments(user: UserContext, entityType: DocumentEntity, entityId: string) {
  await assertEntityAccess(user, entityType, entityId, 'read');
  const docs = await DocumentFile.find({ entityType, entityId, deletedAt: null }).sort({ createdAt: -1 }).lean();
  return docs.map(present);
}

/** Access is re-checked on every download; a link or id alone grants nothing. */
export async function openDocument(user: UserContext, id: string): Promise<{ stream: Readable; name: string; mimeType: string; size: number }> {
  const d: any = await DocumentFile.findOne({ _id: id, deletedAt: null }).lean();
  if (!d) throw notFound('Document not found');
  try { await assertEntityAccess(user, d.entityType, String(d.entityId), 'read'); } catch { throw notFound('Document not found'); }
  return { stream: getStorage().get(d.key), name: d.name, mimeType: d.mimeType, size: d.size };
}

export async function deleteDocument(user: UserContext, id: string) {
  const d: any = await DocumentFile.findOne({ _id: id, deletedAt: null }).lean();
  if (!d) throw notFound('Document not found');
  try { await assertEntityAccess(user, d.entityType, String(d.entityId), 'read'); } catch { throw notFound('Document not found'); }
  const mine = String(d.uploadedBy) === user.id;
  if (!mine && !['system_admin', 'procurement_manager'].includes(user.role ?? '')) throw forbidden('Only the uploader or a procurement manager can delete a document');
  const gate = await DocumentFile.updateOne({ _id: id, deletedAt: null }, { $set: { deletedAt: new Date(), deletedByName: user.displayName } });
  if (!gate.modifiedCount) throw conflict('This document was already deleted');
  await getStorage().remove(d.key).catch(() => undefined);
  await audit(user, { action: 'document.deleted', entityType: d.entityType, entityId: String(d.entityId), entityNumber: d.entityNumber, summary: `Deleted document "${d.name}"`, before: { documentId: id, sha256: d.sha256 } });
}
