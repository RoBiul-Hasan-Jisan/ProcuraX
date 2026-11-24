/**
 * Idempotent seed of DEMO DATA: departments, material categories, materials, suppliers and demo user profiles.
 * Safe to run repeatedly: every record is upserted on a natural key (code / sku / supplierCode / firebaseUid).
 *
 * Passwords are never handled here. Create each Firebase account first, then pass its UID via env vars, e.g.
 *   DEMO_UID_SYSTEM_ADMIN=<uid> DEMO_UID_SUPPLIER=<uid> npm run seed
 * Users without a UID are skipped. See docs/firebase-setup.md.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
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

async function main() {
  await connectDatabase();
  await ensureDefaultRoles();

  for (const d of DEPARTMENTS) await Department.updateOne({ code: d.code }, { $set: { ...d, isDemoData: true } }, { upsert: true });
  const prod = await Department.findOne({ code: 'PROD' });

  const catByCode = new Map<string, any>();
  for (const c of DEMO_CATEGORIES) {
    const doc = await MaterialCategory.findOneAndUpdate({ code: c.code }, { $set: { ...c, isDemoData: true } }, { upsert: true, new: true });
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
      { upsert: true, new: true },
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
        },
      },
      { upsert: true },
    );
  }

  // Warehouses and opening stock. Opening stock is written ONCE per material (guarded by an opening_balance ledger entry),
  // as a balance plus a matching ledger row, so re-running the seed never doubles stock and never overwrites real movements.
  const whByCode = new Map<string, any>();
  for (const w of DEMO_WAREHOUSES) whByCode.set(w.code, await Warehouse.findOneAndUpdate({ code: w.code }, { $set: { ...w, active: true, isDemoData: true } }, { upsert: true, new: true }));
  let opened = 0;
  for (const [i, mat] of DEMO_MATERIALS.entries()) {
    const doc = await Material.findOne({ sku: mat.sku }).lean();
    const { warehouse, quantity } = openingStock(mat, i);
    const wh = whByCode.get(warehouse);
    if (!doc || !wh) continue;
    if (await StockMovement.exists({ material: doc._id, warehouse: wh._id, type: 'opening_balance' })) continue;
    const level = await StockLevel.findOneAndUpdate({ material: doc._id, warehouse: wh._id }, { $inc: { quantity: toD128(quantity) }, $set: { isDemoData: true } }, { upsert: true, new: true });
    await StockMovement.create({ material: doc._id, warehouse: wh._id, type: 'opening_balance', delta: toD128(quantity), balanceAfter: level!.quantity, reason: 'DEMO opening balance', performedByName: 'Seed script', isDemoData: true });
    opened++;
  }

  const seedUser = async (uid: string, email: string, role: RoleName, extra: Record<string, unknown> = {}) => {
    await User.updateOne(
      { firebaseUid: uid },
      { $set: { email, displayName: `[DEMO] ${ROLE_LABELS[role]}`, role, status: 'active', isDemoData: true, ...extra } },
      { upsert: true },
    );
  };

  for (const role of ROLES) {
    if (role === 'supplier') continue;
    const uid = process.env[`DEMO_UID_${role.toUpperCase()}`];
    if (!uid) { console.log(`skip ${role}: set DEMO_UID_${role.toUpperCase()} to a Firebase UID to seed this user`); continue; }
    await seedUser(uid, DEMO_EMAILS[role], role, { department: PRODUCTION_ROLES.includes(role) ? prod?._id : null });
    console.log(`seeded ${role}`);
  }
  for (const link of DEMO_SUPPLIER_USER_LINKS) {
    const uid = process.env[link.env];
    if (!uid) { console.log(`skip ${link.supplierCode} login: set ${link.env}`); continue; }
    await seedUser(uid, link.email, 'supplier', { supplier: supplierByCode.get(link.supplierCode)._id, department: null });
    console.log(`seeded supplier login for ${link.supplierCode}`);
  }

  console.log(`Seeded ${DEPARTMENTS.length} departments, ${DEMO_CATEGORIES.length} categories, ${DEMO_MATERIALS.length} materials, ${DEMO_SUPPLIERS.length} suppliers, ${DEMO_WAREHOUSES.length} warehouses (${opened} new opening balances).`);
  await disconnectDatabase();
}

main().catch((e) => { console.error(e); process.exit(1); });
