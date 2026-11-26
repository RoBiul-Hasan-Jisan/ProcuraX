import { FinishedProduct } from '../models/FinishedProduct';
import { BillOfMaterials } from '../models/BillOfMaterials';
import { ProductionPlan } from '../models/ProductionPlan';
import { StockReservation } from '../models/StockReservation';
import { StockLevel } from '../models/StockLevel';
import { Material } from '../models/Material';
import { nextNumber } from '../models/Counter';
import { dec, Decimal, str, toD128, toD128p } from '../domain/money';
import { explodeBom, type Bom } from '../domain/bom';
import { canPlanTransition, isPlanEditable, type PlanStatus } from '../domain/productionPlan';
import { badRequest, conflict, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';

/* ---------- finished products ---------- */
const presentProduct = (p: any) => ({ id: String(p._id), code: p.code, name: p.name, unit: p.unit, description: p.description, intermediate: !!p.intermediate, active: p.active });

export async function listProducts(q: { search?: string; active?: boolean }) {
  const f: Record<string, unknown> = {};
  if (q.active !== undefined) f.active = q.active;
  if (q.search) f.$or = [{ name: new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { code: new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
  return (await FinishedProduct.find(f).sort({ code: 1 }).lean()).map(presentProduct);
}
export async function createProduct(input: { code: string; name: string; unit: string; description: string; intermediate: boolean }) {
  try { return presentProduct(await FinishedProduct.create(input)); }
  catch (e: any) { if (e?.code === 11000) throw conflict('A product with this code already exists'); throw e; }
}
export async function updateProduct(id: string, patch: Record<string, unknown>) {
  const p = await FinishedProduct.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after' }).lean();
  if (!p) throw notFound('Product not found');
  return presentProduct(p);
}

/* ---------- bill of materials ---------- */
export interface BomItemInput { materialId?: string | null; subProductId?: string | null; quantity: string; wastagePercent: string }
export interface BomInput { productId: string; effectiveFrom: Date; notes: string; items: BomItemInput[] }

const presentBom = (b: any) => ({
  id: String(b._id), number: b.number, version: b.version, status: b.status, effectiveFrom: b.effectiveFrom, notes: b.notes,
  product: { id: String(b.product?._id ?? b.product), code: b.product?.code ?? null, name: b.product?.name ?? null, unit: b.product?.unit ?? null },
  items: b.items.map((i: any) => ({
    materialId: i.material ? String(i.material) : null, subProductId: i.subProduct ? String(i.subProduct) : null,
    name: i.name, sku: i.sku, quantity: str(i.quantity, 6), unit: i.unit, wastagePercent: str(i.wastagePercent, 2),
  })),
  createdAt: b.createdAt,
});

/** Validates components and resolves names/units server-side. Units always come from the catalogue, never from the client. */
async function buildItems(productId: string, items: BomItemInput[]) {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const it of items) {
    if (!!it.materialId === !!it.subProductId) throw badRequest('Each component must be either a material or a sub-product');
    const key = it.materialId ?? `p:${it.subProductId}`;
    if (seen.has(key)) throw badRequest('A component can appear only once in a BOM');
    seen.add(key);
    if (dec(it.quantity).lte(0)) throw badRequest('Component quantities must be greater than zero');
    if (dec(it.wastagePercent).lt(0) || dec(it.wastagePercent).gt(100)) throw badRequest('Wastage must be between 0 and 100 percent');
    if (it.materialId) {
      const m = await Material.findById(it.materialId).lean();
      if (!m) throw notFound('A component material does not exist');
      out.push({ material: m._id, name: m.name, sku: m.sku, unit: m.unit, quantity: toD128p(it.quantity, 6), wastagePercent: toD128p(it.wastagePercent, 2) });
    } else {
      if (it.subProductId === productId) throw badRequest('A product cannot be a component of its own BOM');
      const p = await FinishedProduct.findById(it.subProductId).lean();
      if (!p) throw notFound('A component sub-product does not exist');
      out.push({ subProduct: p._id, name: p.name, sku: p.code, unit: p.unit, quantity: toD128p(it.quantity, 6), wastagePercent: toD128p(it.wastagePercent, 2) });
    }
  }
  return out;
}

export async function listBoms(q: { product?: string; status?: string }) {
  const f: Record<string, unknown> = {};
  if (q.product) f.product = q.product;
  if (q.status) f.status = q.status;
  return (await BillOfMaterials.find(f).populate('product', 'code name unit').sort({ createdAt: -1 }).lean()).map(presentBom);
}
export async function getBom(id: string) {
  const b = await BillOfMaterials.findById(id).populate('product', 'code name unit').lean();
  if (!b) throw notFound('BOM not found');
  return presentBom(b);
}

export async function createBom(user: UserContext, input: BomInput) {
  const product = await FinishedProduct.findById(input.productId).lean();
  if (!product) throw notFound('Product not found');
  const items = await buildItems(input.productId, input.items);
  const last = await BillOfMaterials.findOne({ product: input.productId }).sort({ version: -1 }).lean();
  try {
    const b = await BillOfMaterials.create({ number: await nextNumber('BOM'), product: input.productId, version: (last?.version ?? 0) + 1, status: 'draft', effectiveFrom: input.effectiveFrom, notes: input.notes, items, createdBy: user.id });
    return getBom(String(b._id));
  } catch (e: any) {
    if (e?.code === 11000) throw conflict('Another version was created at the same time. Try again.');
    throw e;
  }
}

/** Only drafts are editable. An active BOM is history that production plans and MRP runs depend on; change it by creating a new version. */
export async function updateBom(id: string, input: BomInput) {
  const existing = await BillOfMaterials.findById(id).lean();
  if (!existing) throw notFound('BOM not found');
  if (existing.status !== 'draft') throw conflict('Only a draft BOM can be edited. Create a new version instead.');
  const items = await buildItems(String(existing.product), input.items);
  const b = await BillOfMaterials.findOneAndUpdate({ _id: id, status: 'draft' }, { $set: { effectiveFrom: input.effectiveFrom, notes: input.notes, items } }, { returnDocument: 'after' });
  if (!b) throw conflict('This BOM is no longer a draft');
  return getBom(id);
}

export async function newBomVersion(user: UserContext, id: string) {
  const src = await BillOfMaterials.findById(id).lean();
  if (!src) throw notFound('BOM not found');
  const last = await BillOfMaterials.findOne({ product: src.product }).sort({ version: -1 }).lean();
  try {
    const b = await BillOfMaterials.create({ number: await nextNumber('BOM'), product: src.product, version: (last?.version ?? src.version) + 1, status: 'draft', effectiveFrom: new Date(), notes: `Copied from ${src.number}`, items: src.items, createdBy: user.id });
    return getBom(String(b._id));
  } catch (e: any) {
    if (e?.code === 11000) throw conflict('Another version was created at the same time. Try again.');
    throw e;
  }
}

/** Activating checks that the BOM does not create a circular multi-level structure. */
export async function activateBom(id: string) {
  const b = await BillOfMaterials.findById(id).lean();
  if (!b) throw notFound('BOM not found');
  if (b.status !== 'draft') throw conflict(`A ${b.status} BOM cannot be activated`);
  const others = await BillOfMaterials.find({ status: 'active' }).lean();
  const asDomain = (x: any): Bom => ({ id: String(x._id), number: x.number, product: String(x.product), version: x.version, status: 'active', effectiveFrom: x.effectiveFrom, items: x.items.map((i: any) => ({ material: i.material ? String(i.material) : null, subProduct: i.subProduct ? String(i.subProduct) : null, quantity: i.quantity, wastagePercent: i.wastagePercent })) });
  const probe = explodeBom(String(b.product), 1, b.effectiveFrom, [...others.filter((o) => String(o._id) !== id).map(asDomain), asDomain(b)]);
  const circular = probe.issues.find((i) => /Circular/.test(i.message));
  if (circular) throw badRequest(circular.message);
  const g = await BillOfMaterials.findOneAndUpdate({ _id: id, status: 'draft' }, { $set: { status: 'active' } }, { returnDocument: 'after' });
  if (!g) throw conflict('This BOM was already activated');
  return getBom(id);
}
export async function obsoleteBom(id: string) {
  const g = await BillOfMaterials.findOneAndUpdate({ _id: id, status: 'active' }, { $set: { status: 'obsolete' } }, { returnDocument: 'after' });
  if (!g) throw conflict('Only an active BOM can be made obsolete');
  return getBom(id);
}

/* ---------- production plans ---------- */
export interface PlanInput { productId: string; quantity: string; startDate: Date; endDate: Date; notes: string }
const presentPlan = (p: any) => ({
  id: String(p._id), number: p.number, status: p.status, quantity: str(p.quantity, 3), unit: p.unit, startDate: p.startDate, endDate: p.endDate, notes: p.notes,
  product: { id: String(p.product?._id ?? p.product), code: p.product?.code ?? null, name: p.product?.name ?? null }, createdAt: p.createdAt,
});

function checkPlan(i: PlanInput) {
  if (dec(i.quantity).lte(0)) throw badRequest('Production quantity must be greater than zero');
  if (i.endDate.getTime() < i.startDate.getTime()) throw badRequest('The completion date cannot be before the start date');
}

export async function listPlans(q: { page: number; limit: number; status?: string; product?: string }) {
  const f: Record<string, unknown> = {};
  if (q.status) f.status = q.status;
  if (q.product) f.product = q.product;
  const [items, total] = await Promise.all([
    ProductionPlan.find(f).populate('product', 'code name').sort({ startDate: 1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    ProductionPlan.countDocuments(f),
  ]);
  return { items: items.map(presentPlan), total };
}
export async function getPlan(id: string) {
  const p = await ProductionPlan.findById(id).populate('product', 'code name').lean();
  if (!p) throw notFound('Production plan not found');
  return presentPlan(p);
}
export async function createPlan(user: UserContext, input: PlanInput) {
  checkPlan(input);
  const product = await FinishedProduct.findById(input.productId).lean();
  if (!product) throw notFound('Product not found');
  if (!product.active) throw badRequest('This product is inactive');
  const p = await ProductionPlan.create({ number: await nextNumber('PP'), product: product._id, quantity: toD128(input.quantity), unit: product.unit, startDate: input.startDate, endDate: input.endDate, notes: input.notes, createdBy: user.id });
  return getPlan(String(p._id));
}
export async function updatePlan(id: string, input: PlanInput) {
  checkPlan(input);
  const existing = await ProductionPlan.findById(id).lean();
  if (!existing) throw notFound('Production plan not found');
  if (!isPlanEditable(existing.status as PlanStatus)) throw conflict(`A ${existing.status.replace('_', ' ')} plan cannot be edited`);
  const product = await FinishedProduct.findById(input.productId).lean();
  if (!product) throw notFound('Product not found');
  const g = await ProductionPlan.findOneAndUpdate({ _id: id, status: existing.status }, { $set: { product: product._id, unit: product.unit, quantity: toD128(input.quantity), startDate: input.startDate, endDate: input.endDate, notes: input.notes } }, { returnDocument: 'after' });
  if (!g) throw conflict('The plan changed while you were editing it');
  return getPlan(id);
}
export async function setPlanStatus(id: string, to: PlanStatus) {
  const existing = await ProductionPlan.findById(id).lean();
  if (!existing) throw notFound('Production plan not found');
  if (!canPlanTransition(existing.status as PlanStatus, to)) throw conflict(`A plan cannot move from ${existing.status.replace('_', ' ')} to ${to.replace('_', ' ')}`);
  const g = await ProductionPlan.findOneAndUpdate({ _id: id, status: existing.status }, { $set: { status: to } }, { returnDocument: 'after' });
  if (!g) throw conflict('The plan status changed while you were updating it');
  return getPlan(id);
}

/* ---------- reservations ---------- */
const presentReservation = (r: any) => ({
  id: String(r._id), material: { id: String(r.material?._id ?? r.material), sku: r.material?.sku ?? null, name: r.material?.name ?? null, unit: r.material?.unit ?? null },
  quantity: str(r.quantity, 3), reason: r.reason, status: r.status, productionPlanId: r.productionPlan ? String(r.productionPlan?._id ?? r.productionPlan) : null,
  productionPlanNumber: r.productionPlan?.number ?? null, createdByName: r.createdByName, createdAt: r.createdAt, releasedAt: r.releasedAt ?? null,
});
export async function listReservations(q: { status?: string; material?: string }) {
  const f: Record<string, unknown> = { status: q.status ?? 'active' };
  if (q.material) f.material = q.material;
  return (await StockReservation.find(f).populate('material', 'sku name unit').populate('productionPlan', 'number').sort({ createdAt: -1 }).lean()).map(presentReservation);
}
/**
 * Reserves stock. The request is checked against on-hand minus active reservations at that moment. Two simultaneous
 * reservations could both pass this check; MRP treats over-reserved stock as zero available, so the effect is safe but visible.
 */
export async function createReservation(user: UserContext, i: { materialId: string; quantity: string; reason: string; productionPlanId?: string | null }) {
  if (dec(i.quantity).lte(0)) throw badRequest('Reserved quantity must be greater than zero');
  const mat = await Material.findById(i.materialId).lean();
  if (!mat) throw notFound('Material not found');
  if (i.productionPlanId && !(await ProductionPlan.exists({ _id: i.productionPlanId }))) throw notFound('Production plan not found');
  const levels = await StockLevel.find({ material: i.materialId }).lean();
  const onHand = levels.reduce((a: Decimal, l: any) => a.plus(dec(l.quantity)), new Decimal(0));
  const reserved = (await StockReservation.find({ material: i.materialId, status: 'active' }).lean()).reduce((a: Decimal, r: any) => a.plus(dec(r.quantity)), new Decimal(0));
  const free = onHand.minus(reserved);
  if (dec(i.quantity).gt(free)) throw conflict(`Only ${free.lt(0) ? '0' : free.toDecimalPlaces(3).toFixed()} ${mat.unit} is unreserved in stock`);
  const r = await StockReservation.create({ material: i.materialId, quantity: toD128(i.quantity), reason: i.reason, productionPlan: i.productionPlanId ?? null, createdBy: user.id, createdByName: user.displayName });
  return presentReservation(r.toObject());
}
export async function releaseReservation(id: string) {
  const r = await StockReservation.findOneAndUpdate({ _id: id, status: 'active' }, { $set: { status: 'released', releasedAt: new Date() } }, { returnDocument: 'after' }).lean();
  if (!r) throw conflict('Reservation not found or already released');
  return presentReservation(r);
}
