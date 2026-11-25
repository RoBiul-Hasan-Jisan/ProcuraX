/**
 * Idempotent seed of DEMO DATA: departments, material categories, materials, suppliers and demo user profiles.
 * Safe to run repeatedly: every record is upserted on a natural key (code / sku / supplierCode / firebaseUid).
 *
 * Fully automatic: for every demo role the seed creates (or finds) the Firebase Auth user by email using the
 * Admin SDK credentials in backend/.env, then links its UID to the MongoDB profile. No manual UID copying.
 * All demo users get the same password: DEMO_PASSWORD from backend/.env (dev default below). Never use in production.
 * You can still override a user with DEMO_UID_<ROLE> if you already created the account yourself.
 */
import { getAuth } from 'firebase-admin/auth';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { getFirebaseApp } from '../src/config/firebase';
import { Department } from '../src/models/Department';
import { Material } from '../src/models/Material';
import { MaterialCategory } from '../src/models/MaterialCategory';
import { Supplier } from '../src/models/Supplier';
import { User } from '../src/models/User';
import { ensureDefaultRoles } from '../src/models/Role';
import { toD128 } from '../src/domain/money';
import { ROLES, ROLE_LABELS, type RoleName } from '../src/utils/permissions';
import { Warehouse } from '../src/models/Warehouse';
import { StockLevel } from '../src/models/StockLevel';
import { StockMovement } from '../src/models/StockMovement';
import { FinishedProduct } from '../src/models/FinishedProduct';
import { BillOfMaterials } from '../src/models/BillOfMaterials';
import { ProductionPlan } from '../src/models/ProductionPlan';
import { StockReservation } from '../src/models/StockReservation';
import { nextNumber } from '../src/models/Counter';
import { toD128p } from '../src/domain/money';
import { DEMO_BOMS, DEMO_PLANS, DEMO_PRODUCTS, DEMO_RESERVATIONS, LEAD_TIME_BY_CATEGORY, SUPPLIER_CAPACITY, consumptionHistory, priceHistory } from './demoData';
import { PriceObservation } from '../src/models/PriceObservation';
import { DEMO_CATEGORIES, DEMO_MATERIALS, DEMO_SUPPLIERS, DEMO_SUPPLIER_USER_LINKS, DEMO_WAREHOUSES, openingStock } from './demoData';

const DEPARTMENTS = [
  { code: 'PROD', name: 'Production', description: 'Melt shop and rolling mill operations' },
  { code: 'MAINT', name: 'Maintenance', description: 'Mechanical and electrical maintenance' },
  { code: 'QA', name: 'Quality Assurance', description: 'Lab testing and quality control' },
  { code: 'LOG', name: 'Logistics & Stores', description: 'Warehousing and dispatch' },
  { code: 'FIN', name: 'Finance', description: 'Budgeting and accounts payable' },
];

const DEMO_EMAILS: Record<RoleName, string> = {
  system_admin: 'admin@demo.steelprocure.example',
  procurement_manager: 'procurement@demo.steelprocure.example',
  department_manager: 'deptmanager@demo.steelprocure.example',
  inventory_officer: 'inventory@demo.steelprocure.example',
  finance_officer: 'finance@demo.steelprocure.example',
  supplier: 'supplier@demo.steelprocure.example',
  management: 'executive@demo.steelprocure.example',
};

// Roles that belong to the Production department so the requisition -> approval chain works out of the box.
const PRODUCTION_ROLES: RoleName[] = ['department_manager', 'inventory_officer'];

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo@12345';

/** Returns the Firebase UID for an email, creating the account (verified, with DEMO_PASSWORD) if needed. */
async function ensureFirebaseUser(email: string, displayName: string, overrideUid?: string): Promise<string | null> {
  if (overrideUid) return overrideUid;
  try {
    const auth = getAuth(getFirebaseApp());
    try {
      const existing = await auth.getUserByEmail(email);
      // Keep every demo account on the same password and verified, even if it already existed.
      await auth.updateUser(existing.uid, { password: DEMO_PASSWORD, emailVerified: true });
      return existing.uid;
    } catch (e: any) {
      if (e?.code !== 'auth/user-not-found') throw e;
    }
    const created = await auth.createUser({ email, password: DEMO_PASSWORD, displayName, emailVerified: true });
    return created.uid;
  } catch (e: any) {
    console.log(`could not create Firebase user ${email}: ${e?.message ?? e}`);
    return null;
  }
}

async function main() {
  await connectDatabase();
  await ensureDefaultRoles();

  for (const d of DEPARTMENTS) await Department.updateOne({ code: d.code }, { $set: { ...d, isDemoData: true } }, { upsert: true });
  const prod = await Department.findOne({ code: 'PROD' });

  const catByCode = new Map<string, any>();
  for (const c of DEMO_CATEGORIES) {
    const doc = await MaterialCategory.findOneAndUpdate({ code: c.code }, { $set: { ...c, isDemoData: true } }, { upsert: true, returnDocument: 'after' });
    catByCode.set(c.code, doc);
  }

  const supplierByCode = new Map<string, any>();
  for (const s of DEMO_SUPPLIERS) {
    const doc = await Supplier.findOneAndUpdate(
      { supplierCode: s.code },
      {
        $set: {
          supplierCode: s.code, companyName: s.name, contactPerson: s.contact, email: `${s.code.toLowerCase()}@demo.steelprocure.example`,
          phone: '+880-000-000000', address: 'DEMO ADDRESS, Bangladesh', registrationNumber: `DEMO-REG-${s.code}`, taxId: `DEMO-TIN-${s.code}`,
          materialCategories: s.categories.map((c) => catByCode.get(c)._id), paymentTerms: s.terms, paymentTermsDays: s.days,
          bankInfo: { bankName: 'DEMO BANK', accountName: s.name, accountNumber: 'DEMO-0000000000' },
          verificationStatus: s.verification, status: s.status, history: s.history, isDemoData: true,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    supplierByCode.set(s.code, doc);
  }

  // Preferred suppliers: verified + active suppliers that cover the material's category (max 2).
  for (const mat of DEMO_MATERIALS) {
    const preferred = DEMO_SUPPLIERS
      .filter((s) => s.verification === 'verified' && s.status === 'active' && s.categories.includes(mat.category))
      .slice(0, 2).map((s) => supplierByCode.get(s.code)._id);
    await Material.updateOne(
      { sku: mat.sku },
      {
        $set: {
          sku: mat.sku, name: mat.name, category: catByCode.get(mat.category)._id, description: `DEMO: ${mat.name}`, unit: mat.unit, technicalSpecs: mat.specs,
          minimumStock: mat.min, safetyStock: mat.safety, reorderPoint: mat.reorder, averagePurchasePrice: toD128(mat.avgPrice), currency: 'BDT',
          preferredSuppliers: preferred, active: true, isDemoData: true,
          leadTimeDays: LEAD_TIME_BY_CATEGORY[mat.category], supplierCapacity: SUPPLIER_CAPACITY[mat.sku] != null ? toD128(String(SUPPLIER_CAPACITY[mat.sku])) : null,
        },
      },
      { upsert: true },
    );
  }

  // Warehouses and opening stock. Opening stock is written ONCE per material (guarded by an opening_balance ledger entry),
  // as a balance plus a matching ledger row, so re-running the seed never doubles stock and never overwrites real movements.
  const whByCode = new Map<string, any>();
  for (const w of DEMO_WAREHOUSES) whByCode.set(w.code, await Warehouse.findOneAndUpdate({ code: w.code }, { $set: { ...w, active: true, isDemoData: true } }, { upsert: true, returnDocument: 'after' }));
  let opened = 0;
  for (const [i, mat] of DEMO_MATERIALS.entries()) {
    const doc = await Material.findOne({ sku: mat.sku }).lean();
    const { warehouse, quantity } = openingStock(mat, i);
    const wh = whByCode.get(warehouse);
    if (!doc || !wh) continue;
    if (await StockMovement.exists({ material: doc._id, warehouse: wh._id, type: 'opening_balance' })) continue;
    // Ledger: an opening balance 370 days ago of (current stock + everything consumed since), then 52 weekly issues to production.
    // The running balance never goes negative and ends exactly at the intended stock level.
    const hist = consumptionHistory(mat).sort((a, b) => b.daysAgo - a.daysAgo);
    const consumed = hist.reduce((a, x) => a + x.quantity, 0);
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
    let bal = Number(quantity) + consumed;
    await StockMovement.create({ material: doc._id, warehouse: wh._id, type: 'opening_balance', delta: toD128(String(bal)), balanceAfter: toD128(String(bal)), reason: 'DEMO opening balance', performedByName: 'Seed script', isDemoData: true, createdAt: at(370) });
    for (const h of hist) {
      bal -= h.quantity;
      await StockMovement.create({ material: doc._id, warehouse: wh._id, type: 'issue', delta: toD128(String(-h.quantity)), balanceAfter: toD128(String(bal)), reason: 'DEMO consumption to production', performedByName: 'Seed script', isDemoData: true, createdAt: at(h.daysAgo) });
    }
    await StockLevel.findOneAndUpdate({ material: doc._id, warehouse: wh._id }, { $set: { quantity: toD128(quantity), isDemoData: true } }, { upsert: true, returnDocument: 'after' });
    opened++;
  }

  // Phase 4: products, BOMs, plans, reservations. Each is keyed (code / product+version / externalRef) so re-running changes nothing.
  const prodByCode = new Map<string, any>();
  for (const p of DEMO_PRODUCTS) prodByCode.set(p.code, await FinishedProduct.findOneAndUpdate({ code: p.code }, { $set: { ...p, active: true, isDemoData: true } }, { upsert: true, returnDocument: 'after' }));
  const matBySku = new Map<string, any>((await Material.find({ sku: { $in: DEMO_MATERIALS.map((m) => m.sku) } }).lean()).map((m: any) => [m.sku, m]));
  let bomsMade = 0;
  for (const b of DEMO_BOMS) {
    const product = prodByCode.get(b.product);
    if (await BillOfMaterials.exists({ product: product._id, version: b.version })) continue;
    await BillOfMaterials.create({
      number: await nextNumber('BOM'), product: product._id, version: b.version, status: b.status, effectiveFrom: new Date(b.effectiveFrom), notes: b.notes, isDemoData: true,
      items: b.items.map((i) => i.sku
        ? { material: matBySku.get(i.sku)._id, name: matBySku.get(i.sku).name, sku: i.sku, unit: matBySku.get(i.sku).unit, quantity: toD128p(i.quantity, 6), wastagePercent: toD128p(i.wastage, 2) }
        : { subProduct: prodByCode.get(i.product!)._id, name: prodByCode.get(i.product!).name, sku: i.product, unit: prodByCode.get(i.product!).unit, quantity: toD128p(i.quantity, 6), wastagePercent: toD128p(i.wastage, 2) }),
    });
    bomsMade++;
  }
  // Phase 5: a year of unit-price observations per material, keyed so a re-run adds nothing.
  const priceOps = DEMO_MATERIALS.flatMap((mat) => priceHistory(mat).map((p, i) => ({
    updateOne: { filter: { externalRef: `DEMO-PRICE-${mat.sku}-${i}` }, update: { $setOnInsert: { material: matBySku.get(mat.sku)._id, unitPrice: toD128(p.price), observedAt: new Date(Date.now() - p.daysAgo * 86_400_000), source: 'demo', isDemoData: true } }, upsert: true },
  })));
  const priceResult = await PriceObservation.bulkWrite(priceOps);
  console.log(`Price history: ${priceResult.upsertedCount} new observation(s) of ${priceOps.length}.`);
  const planByRef = new Map<string, any>();
  for (const p of DEMO_PLANS) {
    let doc = await ProductionPlan.findOne({ externalRef: p.ref });
    if (!doc) {
      const start = new Date(Date.now() + p.startInDays * 86_400_000);
      start.setUTCHours(0, 0, 0, 0); // plans start at midnight UTC so MRP dates are whole days
      doc = await ProductionPlan.create({ number: await nextNumber('PP'), product: prodByCode.get(p.product)._id, quantity: toD128(p.quantity), unit: prodByCode.get(p.product).unit, startDate: start, endDate: new Date(start.getTime() + p.durationDays * 86_400_000), status: p.status, notes: p.notes, externalRef: p.ref, isDemoData: true });
    }
    planByRef.set(p.ref, doc);
  }
  for (const r of DEMO_RESERVATIONS) {
    await StockReservation.updateOne({ externalRef: r.ref }, { $setOnInsert: { material: matBySku.get(r.sku)._id, quantity: toD128(r.quantity), reason: r.reason, productionPlan: r.plan ? planByRef.get(r.plan)._id : null, status: 'active', createdByName: 'Seed script', isDemoData: true } }, { upsert: true });
  }
  console.log(`Planning: ${DEMO_PRODUCTS.length} products, ${bomsMade} new BOMs, ${DEMO_PLANS.length} plans, ${DEMO_RESERVATIONS.length} reservations.`);

  const seedUser = async (uid: string, email: string, role: RoleName, extra: Record<string, unknown> = {}) => {
    await User.updateOne(
      { firebaseUid: uid },
      { $set: { email, displayName: `[DEMO] ${ROLE_LABELS[role]}`, role, status: 'active', isDemoData: true, ...extra } },
      { upsert: true },
    );
  };

  // Demo logins: create/find the Firebase account automatically, then link its UID to the MongoDB profile.
  for (const role of ROLES) {
    if (role === 'supplier') continue;
    const uid = await ensureFirebaseUser(DEMO_EMAILS[role], `[DEMO] ${ROLE_LABELS[role]}`, process.env[`DEMO_UID_${role.toUpperCase()}`]);
    if (!uid) { console.log(`skip ${role}`); continue; }
    await seedUser(uid, DEMO_EMAILS[role], role, { department: PRODUCTION_ROLES.includes(role) ? prod?._id : null });
    console.log(`seeded ${role}: ${DEMO_EMAILS[role]}`);
  }
  for (const link of DEMO_SUPPLIER_USER_LINKS) {
    const uid = await ensureFirebaseUser(link.email, `[DEMO] Supplier ${link.supplierCode}`, process.env[link.env]);
    if (!uid) { console.log(`skip ${link.supplierCode} login`); continue; }
    await seedUser(uid, link.email, 'supplier', { supplier: supplierByCode.get(link.supplierCode)._id, department: null });
    console.log(`seeded supplier login for ${link.supplierCode}: ${link.email}`);
  }
  console.log(`\nAll demo users share the password: ${DEMO_PASSWORD}`);

  console.log(`Seeded ${DEPARTMENTS.length} departments, ${DEMO_CATEGORIES.length} categories, ${DEMO_MATERIALS.length} materials, ${DEMO_SUPPLIERS.length} suppliers, ${DEMO_WAREHOUSES.length} warehouses (${opened} new opening balances).`);
  await disconnectDatabase();
}

main().catch((e) => { console.error(e); process.exit(1); });