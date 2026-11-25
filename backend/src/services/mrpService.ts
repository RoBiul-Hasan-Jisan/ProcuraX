import { ProductionPlan } from '../models/ProductionPlan';
import { BillOfMaterials } from '../models/BillOfMaterials';
import { FinishedProduct } from '../models/FinishedProduct';
import { Material } from '../models/Material';
import { StockLevel } from '../models/StockLevel';
import { StockMovement } from '../models/StockMovement';
import { StockReservation } from '../models/StockReservation';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { MRPRun } from '../models/MRPRun';
import { MRPResult } from '../models/MRPResult';
import { nextNumber } from '../models/Counter';
import { getSetting, putSetting } from '../models/Setting';
import { dec, Decimal, str } from '../domain/money';
import { explodeBom, type Bom } from '../domain/bom';
import { addDays, DEFAULT_URGENCY, planMaterial, type Demand, type Receipt, type UrgencyConfig } from '../domain/mrp';
import { DEFAULT_REORDER_POLICY, recommendReorder, type ReorderPolicy } from '../domain/reorder';
import { COUNTS_FOR_MRP } from '../domain/productionPlan';
import { badRequest, notFound } from '../utils/apiResponse';
import type { UserContext } from '../types/express';

export interface MrpSettings { horizonDays: number; defaultLeadTimeDays: number; urgency: UrgencyConfig; reorder: ReorderPolicy }
export const DEFAULT_MRP_SETTINGS: MrpSettings = { horizonDays: 30, defaultLeadTimeDays: 14, urgency: DEFAULT_URGENCY, reorder: DEFAULT_REORDER_POLICY };

export const getMrpSettings = async (): Promise<MrpSettings> => ({ ...DEFAULT_MRP_SETTINGS, ...(await getSetting<Partial<MrpSettings>>('mrp', {})) });
export async function setMrpSettings(v: MrpSettings) { await putSetting('mrp', v); return getMrpSettings(); }

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const sum = (xs: any[], pick: (x: any) => any = (x) => x) => xs.reduce((a: Decimal, x) => a.plus(dec(pick(x))), new Decimal(0));
const f3 = (d: Decimal) => d.toDecimalPlaces(3).toFixed();

const toDomainBom = (b: any): Bom => ({
  id: String(b._id), number: b.number, product: String(b.product), version: b.version, status: b.status, effectiveFrom: b.effectiveFrom,
  items: b.items.map((i: any) => ({ material: i.material ? String(i.material) : null, subProduct: i.subProduct ? String(i.subProduct) : null, quantity: i.quantity, wastagePercent: i.wastagePercent })),
});

/** Lowest-numbered preferred supplier that is active and verified; never an unverified or blocked one. */
function pickSupplier(m: any): { supplier: { id: string; name: string } | null; note: string | null } {
  const prefs = (m.preferredSuppliers ?? []).filter((s: any) => s?._id);
  if (!prefs.length) return { supplier: null, note: 'No preferred supplier is set for this material' };
  const ok = prefs.find((s: any) => s.status === 'active' && s.verificationStatus === 'verified');
  if (!ok) return { supplier: null, note: 'No preferred supplier is currently active and verified' };
  return { supplier: { id: String(ok._id), name: ok.companyName }, note: null };
}

/** Everything one run reads, gathered once so the calculation itself is a pure function of this snapshot. */
async function loadWorld(materialIds: string[]) {
  const [levels, reservations, orders] = await Promise.all([
    StockLevel.find({ material: { $in: materialIds } }).lean(),
    StockReservation.find({ material: { $in: materialIds }, status: 'active' }).lean(),
    PurchaseOrder.find({ status: { $in: ['issued', 'partially_received'] }, 'lines.material': { $in: materialIds } }).lean(),
  ]);
  return { levels, reservations, orders };
}

export async function runMrp(user: UserContext, input: { planIds: string[]; horizonDays: number }) {
  const settings = await getMrpSettings();
  const today = startOfDay(new Date());
  const plans = await ProductionPlan.find({ _id: { $in: input.planIds } }).populate('product', 'code name unit').lean();
  if (plans.length !== new Set(input.planIds).size) throw badRequest('One or more production plans do not exist');
  const stale = plans.filter((p: any) => !COUNTS_FOR_MRP.includes(p.status));
  if (stale.length) throw badRequest(`Plans that are completed or cancelled cannot be included: ${stale.map((p: any) => p.number).join(', ')}`);

  const cutoff = addDays(today, input.horizonDays);
  const included = plans.filter((p: any) => p.startDate.getTime() <= cutoff.getTime());
  const excludedPlans = plans.filter((p: any) => !included.includes(p)).map((p: any) => ({ plan: p.number, reason: `Starts after the ${input.horizonDays}-day planning horizon` }));
  if (!included.length) throw badRequest('None of the selected plans start inside the planning horizon');

  const [boms, products] = await Promise.all([BillOfMaterials.find({ status: 'active' }).lean(), FinishedProduct.find().lean()]);
  const domainBoms = boms.map(toDomainBom);
  const pname = new Map(products.map((p: any) => [String(p._id), p.name]));
  const names = (id: string) => pname.get(id) ?? id;

  const issues: { plan: string; message: string }[] = [];
  const demandsByMaterial = new Map<string, (Demand & { plan: string })[]>();
  const bomUsed: Record<string, { number: string; version: number }> = {};
  for (const p of included as any[]) {
    const ex = explodeBom(String(p.product._id), p.quantity, p.startDate, domainBoms, names);
    for (const i of ex.issues) issues.push({ plan: p.number, message: i.message });
    for (const r of ex.requirements) {
      bomUsed[`${p.number}:${r.bom.number}`] = { number: r.bom.number, version: r.bom.version };
      const list = demandsByMaterial.get(r.material) ?? [];
      list.push({ date: p.startDate, gross: r.gross, adjusted: r.adjusted, source: p.number, plan: p.number, path: r.path });
      demandsByMaterial.set(r.material, list);
    }
  }

  const materialIds = [...demandsByMaterial.keys()];
  const planIdsInRun = new Set(included.map((p: any) => String(p._id)));
  const [materials, world] = await Promise.all([
    Material.find({ _id: { $in: materialIds } }).populate('category', 'name').populate('preferredSuppliers', 'companyName status verificationStatus').lean(),
    loadWorld(materialIds),
  ]);
  const matById = new Map(materials.map((m: any) => [String(m._id), m]));

  const rows = materialIds.map((id) => {
    const m: any = matById.get(id);
    const demands = demandsByMaterial.get(id)!;
    const onHand = sum(world.levels.filter((l: any) => String(l.material) === id), (l) => l.quantity);
    const res = world.reservations.filter((r: any) => String(r.material) === id);
    const forPlans = res.filter((r: any) => r.productionPlan && planIdsInRun.has(String(r.productionPlan)));
    const other = res.filter((r: any) => !forPlans.includes(r));
    const receipts: (Receipt)[] = [];
    for (const po of world.orders as any[]) {
      for (const l of po.lines) {
        if (String(l.material) !== id) continue;
        const outstanding = Decimal.max(0, dec(l.quantity).minus(dec(l.acceptedQty)));
        if (outstanding.gt(0) && po.expectedDeliveryDate) receipts.push({ date: po.expectedDeliveryDate, quantity: outstanding, reference: po.number });
      }
    }
    const leadAssumed = !(m.leadTimeDays > 0);
    const lead = leadAssumed ? settings.defaultLeadTimeDays : m.leadTimeDays;
    const plan = planMaterial({
      demands, onHand, reservedOther: sum(other, (r) => r.quantity), safetyStock: m.safetyStock, receipts, leadTimeDays: lead, today,
      supplierCapacity: m.supplierCapacity ? dec(m.supplierCapacity) : null, urgency: settings.urgency,
    });
    const sup = pickSupplier(m);
    const price = m.averagePurchasePrice ? dec(m.averagePurchasePrice) : null;
    const explanation = [
      ...demands.map((d) => `${d.plan}: ${str(d.gross, 3)} gross, ${str(d.adjusted, 3)} after wastage, needed ${d.date.toISOString().slice(0, 10)} (${d.path.join(' > ')}).`),
      ...(leadAssumed ? [`No lead time is set for this material; the default of ${settings.defaultLeadTimeDays} days was assumed.`] : []),
      ...(forPlans.length ? [`${f3(sum(forPlans, (r) => r.quantity))} reserved for plans in this run is not deducted again: it is the same demand.`] : []),
      ...plan.explanation,
      ...(sup.note ? [sup.note + '.'] : []),
    ];
    return {
      material: m._id, sku: m.sku, name: m.name, category: m.category?.name ?? '', unit: m.unit, ...pick(plan),
      reservedForPlans: f3(sum(forPlans, (r) => r.quantity)), leadTimeDays: lead, leadTimeAssumed: leadAssumed,
      preferredSupplier: sup.supplier, supplierNote: sup.note, supplierCapacity: m.supplierCapacity ? str(m.supplierCapacity, 3) : null,
      estimatedCost: price && dec(plan.netRequirement).gt(0) ? dec(plan.netRequirement).mul(price).toDecimalPlaces(2).toFixed(2) : null,
      demands: demands.map((d) => ({ plan: d.plan, date: d.date, gross: str(d.gross, 3), adjusted: str(d.adjusted, 3), path: d.path })),
      receipts: receipts.map((r) => ({ reference: r.reference, date: r.date, quantity: f3(dec(r.quantity)) })), explanation,
    };
  });

  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  rows.sort((a, b) => (rank[a.urgency ?? ''] ?? 4) - (rank[b.urgency ?? ''] ?? 4) || a.name.localeCompare(b.name));
  const summary = {
    materials: rows.length, withShortage: rows.filter((r) => dec(r.netRequirement).gt(0)).length, covered: rows.filter((r) => dec(r.netRequirement).lte(0)).length,
    critical: rows.filter((r) => r.urgency === 'critical').length, high: rows.filter((r) => r.urgency === 'high').length,
    medium: rows.filter((r) => r.urgency === 'medium').length, low: rows.filter((r) => r.urgency === 'low').length,
    capacityWarnings: rows.filter((r) => r.exceedsSupplierCapacity).length, noEligibleSupplier: rows.filter((r) => !r.preferredSupplier && dec(r.netRequirement).gt(0)).length,
    estimatedCost: sum(rows.filter((r) => r.estimatedCost), (r) => r.estimatedCost).toFixed(2),
    estimatedCostNote: 'Net requirement x each material\'s average purchase price. Materials without a price are not included.',
  };
  const run = await MRPRun.create({
    number: await nextNumber('MRP'), runDate: new Date(), horizonDays: input.horizonDays, plans: included.map((p: any) => p._id),
    inputs: {
      today, settings,
      plans: included.map((p: any) => ({ id: String(p._id), number: p.number, product: p.product.name, quantity: str(p.quantity, 3), unit: p.unit, startDate: p.startDate, endDate: p.endDate, status: p.status })),
      excludedPlans, bomsUsed: Object.values(bomUsed).filter((v, i, a) => a.findIndex((x) => x.number === v.number) === i),
    },
    issues, summary, status: issues.length ? 'completed_with_issues' : 'completed', createdBy: user.id, createdByName: user.displayName,
  });
  try {
    await MRPResult.insertMany(rows.map((r) => ({ ...r, run: run._id })));
  } catch (e) {
    await MRPRun.deleteOne({ _id: run._id }); // never leave a run without its results
    throw e;
  }
  return getRun(String(run._id));
}

function pick(p: ReturnType<typeof planMaterial>) {
  return {
    grossRequirement: p.grossRequirement, adjustedRequirement: p.adjustedRequirement, onHand: p.onHand, reservedOther: p.reservedOther, available: p.available,
    scheduledReceiptsTotal: p.scheduledReceiptsTotal, scheduledReceiptsUsed: p.scheduledReceiptsUsed, safetyStock: p.safetyStock, netRequirement: p.netRequirement,
    plannedOrders: p.plannedOrders, firstNeedDate: p.firstNeedDate, urgency: p.urgency, exceedsSupplierCapacity: p.exceedsSupplierCapacity,
    ordersNeededForCapacity: p.ordersNeededForCapacity, lateReceipts: p.lateReceipts,
  };
}

const presentRun = (r: any) => ({
  id: String(r._id), number: r.number, runDate: r.runDate, horizonDays: r.horizonDays, status: r.status, createdByName: r.createdByName,
  summary: r.summary, issues: r.issues ?? [], inputs: r.inputs,
});

export async function listRuns(q: { page: number; limit: number }) {
  const [items, total] = await Promise.all([MRPRun.find().sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), MRPRun.countDocuments()]);
  return { items: items.map(presentRun).map(({ inputs, ...rest }) => ({ ...rest, planCount: inputs?.plans?.length ?? 0 })), total };
}

export async function getRun(id: string) {
  const run = await MRPRun.findById(id).lean();
  if (!run) throw notFound('MRP run not found');
  const results = await MRPResult.find({ run: id }).lean();
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  results.sort((a: any, b: any) => (rank[a.urgency ?? ''] ?? 4) - (rank[b.urgency ?? ''] ?? 4) || a.name.localeCompare(b.name));
  return { ...presentRun(run), results: results.map((r: any) => ({ ...r, id: String(r._id), material: String(r.material), run: undefined, _id: undefined, __v: undefined })) };
}

/** Reorder recommendations for every active material, from the recorded issue history and open purchase orders. */
export async function reorderRecommendations(onlyNeeded: boolean) {
  const settings = await getMrpSettings();
  const today = startOfDay(new Date());
  const since = addDays(today, -settings.reorder.lookbackDays);
  const materials = await Material.find({ active: true }).populate('category', 'name').populate('preferredSuppliers', 'companyName status verificationStatus').sort({ name: 1 }).lean();
  const ids = materials.map((m: any) => m._id);
  const [levels, reservations, orders, usage] = await Promise.all([
    StockLevel.find({ material: { $in: ids } }).lean(),
    StockReservation.find({ material: { $in: ids }, status: 'active' }).lean(),
    PurchaseOrder.find({ status: { $in: ['issued', 'partially_received'] } }).lean(),
    StockMovement.aggregate([{ $match: { type: 'issue', createdAt: { $gte: since }, material: { $in: ids } } }, { $group: { _id: '$material', total: { $sum: '$delta' } } }]),
  ]);
  const used = new Map<string, Decimal>(usage.map((u: any) => [String(u._id), dec(u.total).abs()]));
  const out = materials.map((m: any) => {
    const id = String(m._id);
    const onHand = sum(levels.filter((l: any) => String(l.material) === id), (l) => l.quantity);
    const reserved = sum(reservations.filter((r: any) => String(r.material) === id), (r) => r.quantity);
    let onOrder = new Decimal(0);
    for (const po of orders as any[]) for (const l of po.lines) if (String(l.material) === id) onOrder = onOrder.plus(Decimal.max(0, dec(l.quantity).minus(dec(l.acceptedQty))));
    const lead = m.leadTimeDays > 0 ? m.leadTimeDays : settings.defaultLeadTimeDays;
    const rec = recommendReorder({
      consumedInLookback: used.get(id) ?? 0, available: Decimal.max(0, onHand.minus(reserved)), onOrder, safetyStock: m.safetyStock,
      configuredReorderPoint: m.reorderPoint, leadTimeDays: lead, today, policy: settings.reorder,
    });
    const sup = pickSupplier(m);
    return {
      materialId: id, sku: m.sku, name: m.name, category: m.category?.name ?? '', unit: m.unit, onHand: f3(onHand), reserved: f3(reserved), onOrder: f3(onOrder),
      leadTimeDays: lead, leadTimeAssumed: !(m.leadTimeDays > 0), preferredSupplier: sup.supplier, supplierNote: sup.note, ...rec,
    };
  });
  return onlyNeeded ? out.filter((r) => r.reorderNow) : out;
}
