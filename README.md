# SteelProcure AI

*Intelligent Procurement. Smarter Inventory. Better Decisions.*

An AI-assisted e-procurement, inventory and MRP platform for steel manufacturing. This is an **independent demo prototype** built on synthetic data. It is not affiliated with any steel manufacturer and uses no confidential or proprietary data or branding.

## Status: Phase 3 (Purchase and Inventory) complete

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, Express + MongoDB, Firebase auth, RBAC, app shell, dashboard foundation | **Done** |
| 2 | Materials, suppliers, requisitions, approvals, RFQs, quotations, comparison | **Done** (no live-DB test yet) |
| 3 | Purchase orders, goods receipt, invoices, warehouses, stock movements | **Done** (transactions untested on a live DB) |
| 4 | Production plans, BOM, MRP engine | Not started |
| 5 | Supplier scoring, forecasting (Python ML), risk detection, assistant | Not started |
| 6 | Notifications, audit logs, reports, uploads | Not started |
| 7 | Docker deployment, health checks, backup docs | Not started |

Navigation items for later phases are visible (per role) but disabled and tagged with their phase. The overview dashboard shows real database counts only; procurement KPIs are explicitly marked "not available yet" rather than showing placeholder numbers.

### What Phase 3 includes

- **Purchase orders**: created as a *draft* from an RFQ a person already awarded (never automatically), then issued. One live PO per RFQ. Suppliers see only their own issued POs. Issuing sets the expected delivery date and moves the requisition to Ordered.
- **Goods receipt**: partial deliveries supported. Each line records accepted and rejected quantity; only *accepted* goods enter stock. Rejected goods need a reason and do not count toward the order. Accepted quantity can never exceed what is still outstanding.
- **Stock ledger**: balance per material per warehouse plus an append-only movement history (opening balance, receipt, issue, transfer in/out, adjustment). Stock can never go negative. Corrections are new adjustment entries with a mandatory reason.
- **Invoice three-way match**: PO vs accepted goods vs invoice. A mismatched invoice is recorded so it can be disputed, but cannot be verified. Verification re-runs the match against current receipts.
- **Warehouses, stock overview, reorder alerts**: alerts use each material's own safety / minimum / reorder levels.
- **Supplier performance feedback**: when a PO completes, the supplier's history (completed orders, on-time deliveries, units received/accepted) is updated, which feeds the Phase 2 scoring.

#### Phase 3 formulas and rules

- **Remaining to receive** = ordered quantity - cumulative accepted quantity. Receipt is refused if accepted > remaining.
- **PO status**: draft -> issued -> partially received -> received (every line fully accepted); a partially received PO can be short-closed; only a PO with no receipts can be cancelled.
- **On time** = the order was fully accepted on or before its expected delivery date. A short-closed order counts as completed but not on time.
- **Stock status** (most severe first): critical if stock <= safety stock; low if <= minimum; reorder if <= reorder point; a level of 0 means "not set" and is ignored.
- **Invoice match**: every billed material is on the PO; unit price equals the PO price (no tolerance); billed quantity <= accepted minus already invoiced; transport and additional charges <= the PO amounts; tax rate equals the PO rate. The invoice total is always recomputed on the server.
- **Transactions**: receipts, issues, transfers, adjustments, PO issue and short-close, and invoice verification run in MongoDB transactions, so balances, ledger rows and order state commit together or not at all. This **requires a replica set** and there is deliberately no non-transactional fallback. Receipts also use an optimistic `receiptSeq` gate, and stock decreases are conditional (`quantity >= amount`) updates.

### What Phase 2 includes

- **Catalogue**: 10 material categories, materials (SKU, unit, min/safety/reorder levels, preferred suppliers), supplier master with verification and status, history counters and bank details (bank details visible only to `suppliers:bank` holders).
- **Requisitions**: create/edit/submit/cancel with a state machine (Draft → Submitted → In Approval → Approved → RFQ Created → ...). Exact-decimal totals.
- **Approvals**: Department Manager → Procurement Manager → Finance Officer (only when total >= threshold, default 1,000,000 BDT, configurable in settings). A department-manager requester skips the department step; nobody can approve their own request. Reject / request-modification supported; full history kept.
- **RFQs and quotations**: Procurement invites verified, active suppliers only. Suppliers see only RFQs they were invited to and only their own quotation. Quotations are **sealed**: comparable only after the deadline or once the RFQ is closed.
- **Comparison and award**: side-by-side landed cost and weighted score; adjustable weights. Award is always a manual decision; choosing a lower-ranked quote requires a written justification.
- **Suppliers' own profile**: a supplier user edits only contact fields and bank info on their own linked record.

#### Formulas and business rules

- **Landed cost** = material + transport + additional charges + tax. Material = sum(quantity x unit price). Tax = taxRate% x (material + transport + additional). Each component is rounded half-up to 2 dp. Browser previews use BigInt decimal helpers that mirror the server; money is stored as Decimal128, never floats.
- **Score** (default weights): price 30, delivery 25, quality 20, lead time 15, payment 10, normalised to 100. Price/lead-time/payment are relative to the other bids; delivery and quality come from supplier history.
- **Unproven suppliers**: fewer than 5 completed orders -> neutral history score of 50 and an "unproven" flag. They are never presented as reliable.
- **Price flag**: a bid more than 20% above the material's average purchase price is flagged.
- **Concurrency**: no transactions yet. Multi-step actions use atomic conditional `findOneAndUpdate` gates (submit, approval decision, RFQ creation, award) plus unique indexes (one active RFQ per requisition; one quotation per supplier per RFQ). Transactions arrive in Phase 3 with inventory.

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

The seed is idempotent, marks every record `isDemoData`, and skips roles whose `DEMO_UID_<ROLE>` is not set. It seeds 5 departments, 3 warehouses with opening stock (chosen so every alert level appears; written once, never doubled on re-run), 10 categories, 36 materials, 10 suppliers (7 proven, 1 unproven with 2 orders, 1 unverified, 1 blocked) and demo user profiles. Supplier-role logins link to supplier records via `DEMO_UID_SUPPLIER` (SUP-0001), `DEMO_UID_SUPPLIER_2` (SUP-0002) and `DEMO_UID_SUPPLIER_3` (SUP-0003). Demo data lives in `backend/scripts/demoData.ts` and is covered by tests.

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

## Known limitations (through Phase 3)

- Backend tests mock Firebase Admin and the user repository. **Nothing has yet been run against a live MongoDB or a real Firebase project** in this build; verify with the quick start above.
- **Transactions have not been run against a real MongoDB.** The tests mock the transaction helper, so they prove the ordering and the guard conditions, not rollback behaviour. Run the quick start with the replica-set container and try a receipt, an over-issue and two concurrent receipts before relying on it.
- Not built yet: payments against verified invoices, returns of rejected goods to the supplier, supplier-side PO acknowledgement, PO amendments, attachments (Phase 6).
- Cancelling an issued PO leaves its requisition in Ordered; there is no reopen flow yet.
- Stock overview is computed in the API per request (fine for demo scale, not for very large catalogues).
- Backend: 223 tests (domain rules, route permissions/validation, mocked-model services, demo data). Atomic-gate ordering and unique indexes are untested against a real MongoDB; a failure between dependent writes could leave partial state.
- Frontend: 70 tests (navigation, guards, forms, decimal maths, comparison, approvals). Pages such as settings and overview have little direct coverage.
- No end-to-end test of supplier isolation against a running server.
- The Next.js build was verified; the app itself was not exercised in a browser.
- Express 5, Mongoose 9, TypeScript 7 and TanStack Table 8 are used. Tests transpile with SWC; type-checking is done by `tsc`.
