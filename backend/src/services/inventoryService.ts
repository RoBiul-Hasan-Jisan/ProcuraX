import type { ClientSession } from 'mongoose';
import { Warehouse } from '../models/Warehouse';
import { StockLevel } from '../models/StockLevel';
import { StockMovement } from '../models/StockMovement';
import { Material } from '../models/Material';
import { dec, Decimal, str, toD128 } from '../domain/money';
import { signedDelta, stockStatus, shortfallToReorderPoint, type MovementType, type StockStatus } from '../domain/inventory';
import { runInTransaction } from '../utils/transaction';
import { badRequest, conflict, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';
import { audit } from './auditService';
import { notify } from './notifier';

export interface MovementInput {
  material: string; warehouse: string; type: MovementType; quantity: string; adjustmentDirection?: 'increase' | 'decrease';
  reason?: string; reference?: { kind: string; id?: string; number?: string }; user: { id: string; displayName: string };
}

/**
 * The ONLY code path that changes a stock balance. It must run inside a transaction so the balance and the ledger entry
 * commit together. Decreases are gated on `quantity >= amount` in the same atomic update, so stock can never go negative
 * even with concurrent issues.
 */
export async function applyMovement(session: ClientSession, m: MovementInput) {
  const delta = signedDelta(m.type, m.quantity, m.adjustmentDirection);
  let level: any;
  if (delta.gt(0)) {
    level = await StockLevel.findOneAndUpdate({ material: m.material, warehouse: m.warehouse }, { $inc: { quantity: toD128(delta) } }, { upsert: true, returnDocument: 'after', session });
  } else {
    level = await StockLevel.findOneAndUpdate(
      { material: m.material, warehouse: m.warehouse, quantity: { $gte: toD128(delta.abs()) } },
      { $inc: { quantity: toD128(delta) } }, { returnDocument: 'after', session },
    );
    if (!level) throw conflict('Insufficient stock in this warehouse for the requested quantity');
  }
  await StockMovement.create([{
    material: m.material, warehouse: m.warehouse, type: m.type, delta: toD128(delta), balanceAfter: level.quantity,
    reason: m.reason ?? '', reference: m.reference, performedBy: m.user.id, performedByName: m.user.displayName,
  }], { session });
  return { balanceAfter: str(level.quantity, 3) };
}

/* ---------- warehouses ---------- */
const presentWarehouse = (w: any) => ({ id: String(w._id), code: w.code, name: w.name, location: w.location, active: w.active });

export async function listWarehouses(includeInactive = false) {
  const items = await Warehouse.find(includeInactive ? {} : { active: true }).sort({ code: 1 }).lean();
  return items.map(presentWarehouse);
}
export async function createWarehouse(input: { code: string; name: string; location: string }) {
  try { return presentWarehouse(await Warehouse.create(input)); }
  catch (e: any) { if (e?.code === 11000) throw conflict('A warehouse with this code already exists'); throw e; }
}
export async function updateWarehouse(id: string, patch: { name?: string; location?: string; active?: boolean }) {
  if (patch.active === false) {
    const held = await StockLevel.find({ warehouse: id, quantity: { $gt: toD128(0) } }).limit(1).lean();
    if (held.length) throw conflict('This warehouse still holds stock. Move or issue it before deactivating.');
  }
  const w = await Warehouse.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after' }).lean();
  if (!w) throw notFound('Warehouse not found');
  return presentWarehouse(w);
}

async function assertUsable(materialId: string, warehouseId: string, needActiveWarehouse = true) {
  const [mat, wh] = await Promise.all([Material.findById(materialId).lean(), Warehouse.findById(warehouseId).lean()]);
  if (!mat) throw notFound('Material not found');
  if (!wh) throw notFound('Warehouse not found');
  if (needActiveWarehouse && !wh.active) throw badRequest('This warehouse is inactive');
}

/* ---------- manual stock operations ---------- */
export async function adjustStock(user: UserContext, i: { materialId: string; warehouseId: string; direction: 'increase' | 'decrease'; quantity: string; reason: string }) {
  await assertUsable(i.materialId, i.warehouseId, i.direction === 'increase');
  const out = await runInTransaction((s) => applyMovement(s, { material: i.materialId, warehouse: i.warehouseId, type: 'adjustment', adjustmentDirection: i.direction, quantity: i.quantity, reason: i.reason, user }));
  await audit(user, { action: 'inventory.adjusted', entityType: 'Material', entityId: i.materialId, summary: `Stock ${i.direction} of ${i.quantity}: ${i.reason}`, after: { warehouse: i.warehouseId, direction: i.direction, quantity: i.quantity, balanceAfter: out.balanceAfter } });
  if (i.direction === 'decrease') await notify.stockDecreased(i.materialId, i.quantity);
  return out;
}
export async function issueStock(user: UserContext, i: { materialId: string; warehouseId: string; quantity: string; reason: string }) {
  await assertUsable(i.materialId, i.warehouseId, false);
  const out = await runInTransaction((s) => applyMovement(s, { material: i.materialId, warehouse: i.warehouseId, type: 'issue', quantity: i.quantity, reason: i.reason, user }));
  await audit(user, { action: 'inventory.issued', entityType: 'Material', entityId: i.materialId, summary: `Issued ${i.quantity}: ${i.reason}`, after: { warehouse: i.warehouseId, quantity: i.quantity, balanceAfter: out.balanceAfter } });
  await notify.stockDecreased(i.materialId, i.quantity);
  return out;
}
export async function transferStock(user: UserContext, i: { materialId: string; fromWarehouseId: string; toWarehouseId: string; quantity: string; reason: string }) {
  if (i.fromWarehouseId === i.toWarehouseId) throw badRequest('Source and destination warehouses must differ');
  await assertUsable(i.materialId, i.fromWarehouseId, false);
  await assertUsable(i.materialId, i.toWarehouseId, true);
  const moved = await runInTransaction(async (s) => {
    const out = await applyMovement(s, { material: i.materialId, warehouse: i.fromWarehouseId, type: 'transfer_out', quantity: i.quantity, reason: i.reason, user });
    const inn = await applyMovement(s, { material: i.materialId, warehouse: i.toWarehouseId, type: 'transfer_in', quantity: i.quantity, reason: i.reason, user });
    return { from: out, to: inn };
  });
  await audit(user, { action: 'inventory.transferred', entityType: 'Material', entityId: i.materialId, summary: `Transferred ${i.quantity}: ${i.reason}`, after: { from: i.fromWarehouseId, to: i.toWarehouseId, quantity: i.quantity } });
  return moved;
}

/* ---------- read models ---------- */
const SEVERITY: Record<StockStatus, number> = { critical: 0, low: 1, reorder: 2, ok: 3 };

export async function stockOverview(filter: { search?: string; status?: StockStatus; warehouse?: string; includeZero?: boolean }) {
  const matQuery: Record<string, unknown> = { active: true };
  if (filter.search) matQuery.$or = [{ name: new RegExp(escapeRegex(filter.search), 'i') }, { sku: new RegExp(escapeRegex(filter.search), 'i') }];
  const [materials, levels, warehouses] = await Promise.all([
    Material.find(matQuery).sort({ sku: 1 }).lean(),
    StockLevel.find(filter.warehouse ? { warehouse: filter.warehouse } : {}).lean(),
    Warehouse.find().lean(),
  ]);
  const whById = new Map(warehouses.map((w) => [String(w._id), w]));
  const byMaterial = new Map<string, any[]>();
  for (const l of levels) { const k = String(l.material); byMaterial.set(k, [...(byMaterial.get(k) ?? []), l]); }

  const rows = materials.map((m) => {
    const ls = byMaterial.get(String(m._id)) ?? [];
    const total = ls.reduce((a, l) => a.plus(dec(l.quantity)), new Decimal(0));
    const levelsCfg = { safetyStock: m.safetyStock, minimumStock: m.minimumStock, reorderPoint: m.reorderPoint };
    const status = stockStatus(total, levelsCfg);
    return {
      materialId: String(m._id), sku: m.sku, name: m.name, unit: m.unit, total: str(total, 3), status, ...levelsCfg,
      shortfallToReorderPoint: str(shortfallToReorderPoint(total, m.reorderPoint), 3),
      byWarehouse: ls.map((l) => ({ warehouseId: String(l.warehouse), code: whById.get(String(l.warehouse))?.code ?? '?', quantity: str(l.quantity, 3) })),
    };
  });
  return rows
    .filter((r) => (filter.status ? r.status === filter.status : true))
    .filter((r) => (filter.includeZero === false ? dec(r.total).gt(0) : true))
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.sku.localeCompare(b.sku));
}

export async function reorderAlerts() {
  return (await stockOverview({})).filter((r) => r.status !== 'ok');
}

export async function listMovements(q: { page: number; limit: number; material?: string; warehouse?: string; type?: string }) {
  const query: Record<string, unknown> = {};
  if (q.material) query.material = q.material;
  if (q.warehouse) query.warehouse = q.warehouse;
  if (q.type) query.type = q.type;
  const [items, total] = await Promise.all([
    StockMovement.find(query).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('material', 'sku name unit').populate('warehouse', 'code name').lean(),
    StockMovement.countDocuments(query),
  ]);
  return {
    total,
    items: items.map((m: any) => ({
      id: String(m._id), type: m.type, delta: str(m.delta, 3), balanceAfter: str(m.balanceAfter, 3), reason: m.reason, createdAt: m.createdAt,
      performedByName: m.performedByName, reference: m.reference?.kind ? { kind: m.reference.kind, number: m.reference.number } : null,
      material: { id: String(m.material?._id), sku: m.material?.sku, name: m.material?.name, unit: m.material?.unit },
      warehouse: { id: String(m.warehouse?._id), code: m.warehouse?.code, name: m.warehouse?.name },
    })),
  };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
