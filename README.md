# SteelProcure AI

*Intelligent Procurement. Smarter Inventory. Better Decisions.*

An AI-assisted e-procurement, inventory and MRP platform for steel manufacturing. This is an **independent demo prototype** built on synthetic data. It is not affiliated with any steel manufacturer and uses no confidential or proprietary data or branding.

## Status: Phase 1 (Foundation) complete

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, Express + MongoDB, Firebase auth, RBAC, app shell, dashboard foundation | **Done** |
| 2 | Materials, suppliers, requisitions, approvals, RFQs, quotations, comparison | Not started |
| 3 | Purchase orders, goods receipt, invoices, warehouses, stock movements | Not started |
| 4 | Production plans, BOM, MRP engine | Not started |
| 5 | Supplier scoring, forecasting (Python ML), risk detection, assistant | Not started |
| 6 | Notifications, audit logs, reports, uploads | Not started |
| 7 | Docker deployment, health checks, backup docs | Not started |

Navigation items for later phases are visible (per role) but disabled and tagged with their phase. The overview dashboard shows real database counts only; procurement KPIs are explicitly marked "not available yet" rather than showing placeholder numbers.

### What Phase 1 includes

- **Auth**: Firebase Authentication (email/password, Google, password reset, logout, persisted session). The backend verifies Firebase ID tokens with the Admin SDK. There is no custom JWT, no app-issued tokens, and no passwords in MongoDB.
- **Profile + RBAC**: user profile, role, status and permissions live in MongoDB. Roles map to permissions in a `roles` collection (seeded from defaults in `backend/src/utils/permissions.ts`). The client can never choose its own role.
- **Middleware chain**: `verifyFirebaseAuth` → `loadUserProfile` → `requireActiveAccount` → `requireRole` / `requirePermission`.
- **Account lifecycle**: new sign-ups become `pending` with no role; an administrator activates them and assigns a role in **Settings → User Management**.
- **App shell**: collapsible sidebar, mobile drawer, breadcrumbs, permission-filtered global page search, user menu, protected routes with loading/error/empty states.
- **API**: `/api/v1` with consistent JSON envelope, Zod validation, rate limiting, Helmet, CORS allow-list, request IDs, operator-injection sanitisation, and no stack-trace leakage.

## Quick start

Prerequisites: Node 20+, Docker (for MongoDB), a Firebase project (see [docs/firebase-setup.md](docs/firebase-setup.md)).

```bash
# 1. MongoDB as a single-node replica set (needed for transactions in later phases)
docker compose up -d mongo

# 2. Backend
cd backend
cp .env.example .env        # fill in Firebase Admin values, BOOTSTRAP_ADMIN_EMAIL
npm install
npm run dev                 # http://localhost:5000  (health: /health)

# 3. Frontend
cd ../frontend
cp .env.example .env.local  # fill in Firebase web config
npm install
npm run dev                 # http://localhost:3000
```

Set `BOOTSTRAP_ADMIN_EMAIL` to your own email. The first time that **verified** account signs in it is provisioned as System Administrator. Everyone else starts `pending`.

### Demo data

```bash
cd backend
DEMO_UID_SYSTEM_ADMIN=<firebase uid> DEMO_UID_PROCUREMENT_MANAGER=<uid> npm run seed
```

The seed is idempotent, marks every record `isDemoData`, and skips roles whose `DEMO_UID_<ROLE>` is not set. Phase 1 seeds 5 departments and the demo user profiles. Richer connected data (materials, suppliers, POs, consumption history) arrives with the phases that need it.

## Tests

```bash
cd backend  && npm test && npm run typecheck
cd frontend && npm test && npm run typecheck && npm run lint
```

## Architecture notes

- `backend/` Express + TypeScript + Mongoose (routes → middleware → services → repositories → models).
- `frontend/` Next.js App Router + Tailwind. Route groups: `(auth)` public, `(app)` protected.
- `ml/` Python ML service (scaffold only until Phase 5).
- Roles: system_admin, procurement_manager, department_manager, inventory_officer, finance_officer, supplier, management.

## Known limitations (Phase 1)

- Backend tests mock Firebase Admin and the user repository. **Nothing has yet been run against a live MongoDB or a real Firebase project** in this build; verify with the quick start above.
- Frontend tests cover navigation filtering, route guarding and form validation. The settings page and overview page have no automated tests yet.
- The Next.js build was verified; the app itself was not exercised in a browser.
- Express 5, Mongoose 9, TypeScript 7 and TanStack Table 8 are used. Tests transpile with SWC; type-checking is done by `tsc`.
