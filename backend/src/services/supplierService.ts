import { Supplier } from '../models/Supplier';
import { User } from '../models/User';
import { badRequest, conflict, forbidden, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';
import { canSeeBankInfo } from './scope';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Bank details are only included when the caller is allowed to see them (or it is their own record). */
export function presentSupplier(s: any, opts: { includeBank: boolean }) {
  const h = s.history ?? {};
  const out: Record<string, unknown> = {
    id: String(s._id), supplierCode: s.supplierCode, companyName: s.companyName, contactPerson: s.contactPerson,
    email: s.email, phone: s.phone, address: s.address, registrationNumber: s.registrationNumber, taxId: s.taxId,
    materialCategories: (s.materialCategories ?? []).map((c: any) => (c?._id ? { id: String(c._id), name: c.name } : { id: String(c) })),
    paymentTerms: s.paymentTerms, paymentTermsDays: s.paymentTermsDays,
    verificationStatus: s.verificationStatus, status: s.status,
    history: {
      completedOrders: h.completedOrders ?? 0, onTimeDeliveries: h.onTimeDeliveries ?? 0,
      unitsReceived: h.unitsReceived ?? 0, unitsAccepted: h.unitsAccepted ?? 0,
      onTimeRate: h.completedOrders ? Math.round((h.onTimeDeliveries / h.completedOrders) * 1000) / 10 : null,
      qualityAcceptanceRate: h.unitsReceived ? Math.round((h.unitsAccepted / h.unitsReceived) * 1000) / 10 : null,
    },
  };
  if (opts.includeBank) out.bankInfo = s.bankInfo ?? { bankName: '', accountName: '', accountNumber: '' };
  return out;
}

export async function listSuppliers(user: UserContext, q: { page: number; limit: number; search?: string; status?: string; verification?: string }) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.verification) filter.verificationStatus = q.verification;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ companyName: rx }, { supplierCode: rx }];
  }
  const [items, total] = await Promise.all([
    Supplier.find(filter).populate('materialCategories', 'name').sort({ companyName: 1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Supplier.countDocuments(filter),
  ]);
  const includeBank = canSeeBankInfo(user);
  return { items: items.map((s) => presentSupplier(s, { includeBank })), total };
}

/** A supplier-role user may only ever read their own record. Everyone else needs suppliers:view. */
export async function getSupplier(user: UserContext, id: string) {
  const isSelf = user.role === 'supplier';
  if (isSelf && user.supplierId !== id) throw forbidden('Suppliers can only access their own profile');
  const s = await Supplier.findById(id).populate('materialCategories', 'name').lean();
  if (!s) throw notFound('Supplier not found');
  return presentSupplier(s, { includeBank: isSelf || canSeeBankInfo(user) });
}

async function nextSupplierCode(): Promise<string> {
  const last = await Supplier.findOne({ supplierCode: /^SUP-\d+$/ }).sort({ supplierCode: -1 }).lean();
  const n = last ? parseInt(last.supplierCode.split('-')[1], 10) + 1 : 1;
  return `SUP-${String(n).padStart(4, '0')}`;
}

export async function createSupplier(input: any) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const s = await Supplier.create({ ...input, supplierCode: input.supplierCode ?? (await nextSupplierCode()) });
      return getSupplierAsManager(String(s._id));
    } catch (e: any) {
      if (e?.code === 11000 && !input.supplierCode) continue; // lost a code race, retry
      if (e?.code === 11000) throw conflict('A supplier with this code already exists');
      throw e;
    }
  }
  throw conflict('Could not allocate a supplier code, please retry');
}

async function getSupplierAsManager(id: string) {
  const s = await Supplier.findById(id).populate('materialCategories', 'name').lean();
  if (!s) throw notFound('Supplier not found');
  return presentSupplier(s, { includeBank: true });
}

/** Fields a procurement manager may change. Verification/status/history are NOT supplier-editable. */
export async function updateSupplier(id: string, input: any) {
  const s = await Supplier.findByIdAndUpdate(id, { $set: input }, { new: true });
  if (!s) throw notFound('Supplier not found');
  return getSupplierAsManager(id);
}

/** A supplier maintaining their own profile: contact, address and bank details only. */
export async function updateOwnProfile(user: UserContext, input: any) {
  if (!user.supplierId) throw badRequest('Your account is not linked to a supplier record');
  const allowed: Record<string, unknown> = {};
  for (const k of ['contactPerson', 'email', 'phone', 'address', 'registrationNumber', 'taxId', 'bankInfo']) {
    if (k in input) allowed[k] = input[k];
  }
  const s = await Supplier.findByIdAndUpdate(user.supplierId, { $set: allowed }, { new: true });
  if (!s) throw notFound('Supplier not found');
  return getSupplierAsManager(user.supplierId);
}

/** Admin: link a supplier-role user to a supplier record. */
export async function linkUserToSupplier(userId: string, supplierId: string | null) {
  if (supplierId && !(await Supplier.exists({ _id: supplierId }))) throw notFound('Supplier not found');
  const u = await User.findById(userId);
  if (!u) throw notFound('User not found');
  if (supplierId && u.role !== 'supplier') throw badRequest('Only users with the Supplier role can be linked to a supplier');
  u.supplier = supplierId as any;
  await u.save();
}
