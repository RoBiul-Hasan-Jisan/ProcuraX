import { Types } from 'mongoose';
import { Material } from '../models/Material';
import { MaterialCategory } from '../models/MaterialCategory';
import { toD128, str } from '../domain/money';
import { conflict, notFound } from '../utils/apiResponse';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function presentMaterial(m: any) {
  return {
    id: String(m._id), sku: m.sku, name: m.name,
    category: m.category?._id ? { id: String(m.category._id), name: m.category.name } : { id: String(m.category), name: null },
    description: m.description, unit: m.unit, technicalSpecs: m.technicalSpecs,
    preferredSuppliers: (m.preferredSuppliers ?? []).map((s: any) => (s?._id ? { id: String(s._id), name: s.companyName } : { id: String(s) })),
    minimumStock: m.minimumStock, safetyStock: m.safetyStock, reorderPoint: m.reorderPoint,
    averagePurchasePrice: m.averagePurchasePrice ? str(m.averagePurchasePrice) : null,
    leadTimeDays: m.leadTimeDays ?? 0, supplierCapacity: m.supplierCapacity ? str(m.supplierCapacity, 3) : null,
    currency: m.currency, active: m.active,
  };
}

export async function listMaterials(q: { page: number; limit: number; search?: string; category?: string; active?: boolean }) {
  const filter: Record<string, unknown> = {};
  if (q.category) filter.category = q.category;
  if (q.active !== undefined) filter.active = q.active;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ name: rx }, { sku: rx }];
  }
  const [items, total] = await Promise.all([
    Material.find(filter).populate('category', 'name').populate('preferredSuppliers', 'companyName')
      .sort({ name: 1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Material.countDocuments(filter),
  ]);
  return { items: items.map(presentMaterial), total };
}

export async function getMaterial(id: string) {
  const m = await Material.findById(id).populate('category', 'name').populate('preferredSuppliers', 'companyName').lean();
  if (!m) throw notFound('Material not found');
  return presentMaterial(m);
}

function toDoc(input: any) {
  const doc: Record<string, unknown> = { ...input };
  if ('averagePurchasePrice' in input) doc.averagePurchasePrice = input.averagePurchasePrice == null ? null : toD128(input.averagePurchasePrice);
  if ('supplierCapacity' in input) doc.supplierCapacity = input.supplierCapacity == null ? null : toD128(input.supplierCapacity);
  return doc;
}

export async function createMaterial(input: any) {
  try {
    const cat = await MaterialCategory.exists({ _id: input.category });
    if (!cat) throw notFound('Category not found');
    const m = await Material.create(toDoc(input));
    return getMaterial(String(m._id));
  } catch (e: any) {
    if (e?.code === 11000) throw conflict('A material with this SKU already exists');
    throw e;
  }
}

export async function updateMaterial(id: string, input: any) {
  try {
    const m = await Material.findByIdAndUpdate(id, { $set: toDoc(input) }, { returnDocument: 'after' });
    if (!m) throw notFound('Material not found');
    return getMaterial(id);
  } catch (e: any) {
    if (e?.code === 11000) throw conflict('A material with this SKU already exists');
    throw e;
  }
}

export async function listCategories() {
  const cats = await MaterialCategory.find().sort({ name: 1 }).lean();
  return cats.map((c) => ({ id: String(c._id), name: c.name, code: c.code, description: c.description }));
}

export const isObjectId = (v: string) => Types.ObjectId.isValid(v);
