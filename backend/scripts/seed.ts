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
import { DEMO_CATEGORIES, DEMO_MATERIALS, DEMO_SUPPLIERS, DEMO_SUPPLIER_USER_LINKS } from './demoData';

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


const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@12345';

/** Returns the Firebase UID for an email, creating the account (verified, with DEMO_PASSWORD) if needed. */
async function ensureFirebaseUser(email: string, displayName: string, overrideUid?: string): Promise<string | null> {
  if (overrideUid) return overrideUid;
  try {
    const auth = getAuth(getFirebaseApp());
    try {
      const existing = await auth.getUserByEmail(email);
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
        },
      },
      { upsert: true },
    );
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

  console.log(`Seeded ${DEPARTMENTS.length} departments, ${DEMO_CATEGORIES.length} categories, ${DEMO_MATERIALS.length} materials, ${DEMO_SUPPLIERS.length} suppliers.`);
  await disconnectDatabase();
}

main().catch((e) => { console.error(e); process.exit(1); });