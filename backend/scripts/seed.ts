/**
 * Idempotent Phase 1 seed: DEMO DATA departments and demo user profiles.
 *
 * Passwords are never handled here. Create each Firebase account first (Firebase console or
 * Auth emulator), then provide its UID via env var, e.g.:
 *   DEMO_UID_SYSTEM_ADMIN=<firebase uid> npm run seed
 * Users without a UID are skipped. See docs/firebase-setup.md.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { Department } from '../src/models/Department';
import { User } from '../src/models/User';
import { ensureDefaultRoles } from '../src/models/Role';
import { ROLES, ROLE_LABELS, type RoleName } from '../src/utils/permissions';

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

async function main() {
  await connectDatabase();
  await ensureDefaultRoles();

  for (const d of DEPARTMENTS) {
    await Department.updateOne({ code: d.code }, { $set: { ...d, isDemoData: true } }, { upsert: true });
  }
  const prod = await Department.findOne({ code: 'PROD' });

  for (const role of ROLES) {
    const uid = process.env[`DEMO_UID_${role.toUpperCase()}`];
    if (!uid) {
      console.log(`skip ${role}: set DEMO_UID_${role.toUpperCase()} to a Firebase UID to seed this user`);
      continue;
    }
    await User.updateOne(
      { firebaseUid: uid },
      {
        $set: {
          email: DEMO_EMAILS[role],
          displayName: `[DEMO] ${ROLE_LABELS[role]}`,
          role,
          status: 'active',
          department: role === 'department_manager' ? prod?._id : null,
          isDemoData: true,
        },
      },
      { upsert: true },
    );
    console.log(`seeded ${role}`);
  }
  console.log(`Departments seeded: ${DEPARTMENTS.length}`);
  await disconnectDatabase();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
