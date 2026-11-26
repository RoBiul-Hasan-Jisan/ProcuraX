# ProcuraX – detailed phase notes, formulas and rules

*Intelligent Procurement. Smarter Inventory. Better Decisions.*

An AI-assisted e-procurement, inventory and MRP platform for steel manufacturing. This is an **independent demo prototype** built on synthetic data. It is not affiliated with any steel manufacturer and uses no confidential or proprietary data or branding.

## Status: Phase 8 (demo data, built-in ML, rename) on top of Phase 7

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, Express + MongoDB, Firebase auth, RBAC, app shell, dashboard foundation | **Done** |
| 2 | Materials, suppliers, requisitions, approvals, RFQs, quotations, comparison | **Done** (no live-DB test yet) |
| 3 | Purchase orders, goods receipt, invoices, warehouses, stock movements | **Done** (transactions untested on a live DB) |
| 4 | Production plans, BOM, MRP engine, reorder recommendations | **Done** (not run on a live DB or in a browser) |
| 5 | Demand and price forecasting (Python ML), risk detection, data-grounded assistant, supplier performance | **Done** (not run on a live DB or in a browser) |
| 6 | Notifications, audit logs, 12 reports with CSV/Excel/PDF export, document uploads | **Done** (not run on a live DB or in a browser) |
| 7 | Docker deployment, health checks, backup docs | **Done** (images not built or run here; see below) |

Navigation items for later phases are visible (per role) but disabled and tagged with their phase. The overview dashboard shows real database counts only; procurement KPIs are explicitly marked "not available yet" rather than showing placeholder numbers.

### What Phase 8 changes

- **Renamed to ProcuraX** in the UI, page titles, API messages, exports, docs and package names. Deliberately *not* renamed: the MongoDB database name `steelprocure` and the demo e-mail domain `@demo.steelprocure.example`, so existing databases, backups and your Firebase demo accounts keep working.
- **Demo data for every screen.** `npm run seed` (idempotent, run it again safely) now also creates 19 DEMO-R01..R19 requisitions covering each workflow stage: draft, waiting for department / procurement / finance approval, modification requested, rejected, **two approved requisitions with no RFQ** (fills "Create RFQ"), two open RFQs the supplier logins can quote on, a closed RFQ with 3 sealed quotes, an awarded RFQ without a PO, a draft PO, issued POs (one overdue), a **partially received PO with a rejection**, and fully received POs with a pending, a verified and a disputed invoice. It also adds stock receipts to the ledger, about 20 notifications, an MRP run, risk scan and forecasts. Awards are recorded as a person's decision, never automatic. The seed skips the workflow part with a message if the demo users do not exist yet.
- **ML without any API or cost.** A built-in forecaster (moving average, exponential smoothing with rolling backtest, linear price trend) runs inside the backend. `ML_MODE=auto` (default) uses it when `ML_INTERNAL_KEY` is empty and falls back to it if the Python service is down; `builtin` never calls the service; `service` requires it. Random forest and XGBoost exist only in the Python service and show as "skipped" in builtin mode. On one test series the built-in numbers matched the Python service's to rounding.
- **Next.js "instant navigation" errors fixed** by turning Cache Components off in `next.config.ts` (the app is client-rendered behind Firebase login, so it gains nothing from it). Remove the `export const instant` line if you still have it in `app/page.tsx`.

**Not verified in this environment:** the seed was tested against an in-memory fake of the models, **not a real MongoDB or Firebase**; the UI was not opened in a browser; Docker images were not built. Run `npm run seed` once and check the screens.

### What Phase 7 includes

- **Docker**: a Dockerfile for the backend, frontend and ML service (multi-stage, non-root users, health checks), and `docker-compose.prod.yml` for the full stack (MongoDB replica set, ML, API, web). `docker-compose.yml` is unchanged and still gives you MongoDB only for development. See [docs/deployment.md](docs/deployment.md).
- **Safer startup**: in production the API refuses to start with a placeholder `ML_INTERNAL_KEY`, missing Firebase credentials or a non-https `FRONTEND_URL`; Compose refuses to start with required values missing. The API shuts down gracefully on SIGTERM.
- **Backups**: `scripts/backup.sh` and `scripts/restore.sh` for MongoDB plus the uploaded documents; see [docs/backup-restore.md](docs/backup-restore.md). A no-Docker path (MongoDB Atlas) is documented too.
- **Fixes found while preparing this**: `npm run build` used to emit `dist/src/server.js` while `npm start` ran `dist/server.js`, so a production start would have failed. A separate `tsconfig.build.json` now builds only `src` to `dist/`. The ML requirements are split into `requirements.txt` (runtime) and `requirements-dev.txt` (adds pytest and httpx). Stray `.whl` files from an earlier experiment were removed from `backend/`.

**What was verified in this environment, and what was not**
- Verified: `docker compose config` accepts both compose files, interpolates the Firebase key without mangling it, fails fast on a missing secret, and excludes the `seed` service unless `--profile tools` is given. The compiled backend starts with production dependencies only and reaches the database connection. The Next.js standalone build serves pages and static files. The ML service runs from a clean environment with only the runtime requirements (health, key check and a real forecast call). The shell scripts pass `bash -n`. 5 new tests cover the production-config guard.
- **Not verified**: no Docker daemon was available, so **no image was built and no container was started**. The Dockerfiles, the Compose startup order, the MongoDB replica-set initialisation under Compose, the container health checks, graceful shutdown and the backup and restore scripts have not been run. Treat the first `docker compose up --build` as the real test. The ML image uses Python 3.12; the checks above ran on 3.13.

### What Phase 6 includes

- **Notifications**: persisted per recipient, created by backend events (requisition submitted/decided, approval needed, RFQ published, quotation received, supplier awarded, PO issued, goods received, invoice verified/disputed, low and critical stock, risk alerts). Recipients are resolved on the server by role, department, permission or linked supplier; the person who caused the event is not notified. A condition that persists (low stock, a risk alert) uses a `dedupeKey`, so it raises one notice, not one per scan; low-stock notices fire only when the level gets worse. Quotation notices never name the supplier or price (sealed bids). A person can only list or mark their own. The header bell polls every 60 s and on window focus; a `/notifications` page lists everything. Links are followed only if they are in-app paths.
- **Audit log**: append-only record of 31 actions (requisition, approval, RFQ, quotation, award, PO, receipt, invoice, inventory, user changes, MRP runs, risk reviews, forecasts, documents, scoring weights, report exports). Each entry has user, role, action, record, before/after, time, request id and IP. Secrets, tokens and anything that looks like a bank/account field are redacted. Quotation prices are not written to the log. Only `audit:view` (System Administrator by default) can read it, through read-only endpoints; there is no write, edit or delete route and the model refuses updates and deletes.
- **Reports** (`/reports`): 12 reports, each with its own filter set (date range, department, supplier, material, category, warehouse, PO status) and on-screen table, totals and notes. Exports (CSV, Excel, PDF) are generated on the server by re-running the report with the same filters and permission checks, are never stored, and each export is written to the audit log.

  | Report | Needs `reports:financial` |
  |---|---|
  | Monthly Procurement Expenditure, Department-wise Spending, Inventory Valuation, Purchase Order, Invoice Discrepancy, Supplier Quotation Comparison | Yes |
  | Supplier Performance, Material Consumption, Warehouse Stock, Delayed Delivery, MRP Planning, Forecast Performance | No (`reports:view`) |

  Financial reports are hidden from the list for roles without the permission and refused by the service (HTTP 403), not just hidden.
- **Documents**: upload, list, download and delete on supplier profiles, quotations, requisitions, purchase orders, goods receipts and invoices. Files are checked by **content** (magic bytes) as well as extension and size; allowed: PDF, PNG, JPG, DOCX, XLSX, CSV, TXT; default limit 10 MB (`MAX_UPLOAD_MB`), 20 per record. The stored name is generated by the server (`<type>/<uuid>.<ext>`); the user's file name is display-only. Access is checked on **every** download against the record the file belongs to. Downloads are `attachment`, `nosniff`, `no-store`. Metadata (uploader, size, SHA-256, record) is in MongoDB; bytes go through a storage adapter (local disk by default, `UPLOAD_DIR`, kept out of Git; the adapter interface is `put/get/remove` so S3 or similar can be added). Delete is a soft delete plus removal of the file and is audited.
- **Supplier Evaluation page**: edits the quotation scoring weights (`suppliers:evaluate`); the change is audited with before and after.

**Document access rules.** A supplier sees and adds documents only on their own records. A supplier can attach to their own quotation only while it is submitted and the RFQ is open, and to their own issued or partially received PO (delivery documents); they cannot see draft POs or anyone else's. **Quotation attachments are sealed like quotations:** staff cannot list or download them until the RFQ is past its deadline or closed. A record you cannot see reads as "not found" rather than "forbidden". Requisition documents follow requisition visibility.

**Report rules and formulas.**
- Spend is **committed** spend: the value of issued, partially received, received and closed purchase orders by issue month. It is not cash paid. Drafts and cancelled orders are excluded.
- Department spending uses the department of the requisition behind each PO. Share % = department total / grand total x 100.
- Inventory value = on-hand x material average purchase price (an estimate, no FIFO/LIFO). Rows without a price are shown unvalued and left out of the total, with a note.
- Material consumption = sum of stock **issue** movements. Transfers and adjustments are not consumption.
- Delayed delivery: open POs are measured against today; received POs against their last receipt date; days late = whole days after the expected date.
- Quotation comparison lists only RFQs past their deadline (or closed). "Price rank" orders by total landed cost and is explicitly not a recommendation.
- Forecast performance compares a stored demand forecast with actual issues over **fully elapsed weeks** only: error = forecast - actual; weighted error = sum |error| / sum actual. Forecasts with no elapsed week yet are not scored.
- Amounts are exact decimals end to end. In Excel exports, amounts are written as numbers (so they can be summed) and text as text.
- CSV/Excel cells that start with `= + - @` tab or CR get a leading apostrophe so they cannot run as formulas.

### What Phase 5 includes

- **ML service (`ml/`, Python)**: a separate FastAPI service. The Express backend sends it a time series and gets a forecast back; it never touches the database, inventory or approvals. Requests need the shared `X-Internal-Key`. If the service is down, forecast buttons report it as unavailable and nothing else is affected.
- **Demand forecasting**: weekly consumption (stock issued to production) is forecast over 7, 30, 60 and 90 days. Models: moving average, simple exponential smoothing, random forest and XGBoost. Each is scored by **rolling-origin backtesting** (one week ahead, expanding window, no shuffling, never trained on the week it predicts) and the lowest RMSE wins. MAE, RMSE and MAPE are shown per model; MAPE is shown as "n/a" when any test actual is zero. Models that need more history than exists are listed as skipped with the reason.
- **Price trend**: a linear trend of unit price over time with an 80% prediction interval and percentage change. Needs 6 observations over 60 days.
- **Risk detection**: ten explainable rules (below) raise alerts that a person acknowledges, investigates, resolves or dismisses. Closing needs a written note; history is kept; alerts can be assigned to a reviewer who holds `risks:review`.
- **Assistant**: classifies a question with keyword rules, runs a fixed backend query, and returns a card with the answer, a table, the records used, how it was calculated, caveats, and a label saying whether it is actual data, a forecast, or unavailable. No external AI service and no free-form queries. Spend questions need `reports:financial`.
- **Supplier performance**: recorded on-time and quality history; unproven suppliers (fewer than 5 orders) show no score.
- **Pages**: Demand Forecasting, Forecast Analytics, Risk Detection, AI Procurement Assistant, Supplier Performance.

#### Phase 5 rules and formulas

- **Weekly series**: 7-day buckets ending on the forecast date; days with no record count as zero; a partly covered oldest bucket is dropped; records after the end date are ignored.
- **Forecast total** for a horizon sums the weekly forecasts, scaling the last partial week. **Range** = point +/- 1.2816 x residual std (x sqrt(weeks) for totals), a normal approximation from backtest errors. It is indicative, not a guarantee.
- **Eligibility** (weeks of history): moving average 6, exponential smoothing 8, random forest 20, XGBoost 30. Fewer than 8 weeks, or no consumption, returns "insufficient data" and no numbers.
- **Robust z-score** = 0.6745 x (x - median) / MAD over at least 8 baseline points; none when MAD is 0.
- **Risk rules and thresholds**: abnormal consumption (latest week, |z| >= 3.5; high at 6); price increase (latest vs median of previous 12, medium 10%, high 20%, critical 40%); high quotation (vs the material's average price, 20/35/60%); duplicate requisition (same department, same lines and quantities, within 7 days); duplicate invoice (same supplier and number ignoring format, or same total and date); unusual adjustment (|change| vs prior balance, 20% medium, 50% high); delayed PO (1-3 days low, 4-14 medium, 15-30 high, 31+ critical); supplier quality (last 3 receipts' acceptance at least 10 points below earlier and under 95%); supplier delivery (on-time under 80%/60% with at least 5 orders); repeated mismatches (3+ failed matches in 90 days).
- **No accusations**: alert text describes a pattern and a next step; it never asserts wrongdoing. A re-scan never reopens or duplicates an alert (each condition has a stable key).
- **Model version** `2026.11-1` is stored with every forecast. Models are re-fitted on each request rather than saved as artifacts.

Run the ML service: `cd ml && ML_INTERNAL_KEY=<secret> python3 main.py` and set the same `ML_INTERNAL_KEY` and `ML_SERVICE_URL` in `backend/.env`. Tests: `cd ml && python3 -m pytest`.

### What Phase 4 includes

- **Finished products and bills of materials**: versioned BOMs (draft, active, obsolete) with an effective date. Only draft BOMs can be edited; activating one runs a circular-reference check. Items are raw materials or in-house sub-products (multi-level, max depth 6). Quantities are per 1 unit of the product, up to 6 decimals.
- **Production plans**: planned, confirmed, in progress, completed, cancelled. Planned, confirmed and in-progress plans count toward MRP.
- **Stock reservations**: hold stock for a plan or for another purpose; checked against unreserved stock. Backend routes exist, but there is no UI for them yet.
- **MRP run**: choose plans and a horizon, run, and the inputs and results are saved. Includes a material-wise table, planned orders with release and arrival dates, an explanation per material, previous runs, CSV export and PDF export (browser print).
- **Reorder recommendations**: from consumption history, independent of production plans.
- **Settings**: horizon, default lead time, urgency thresholds and reorder policy under `/settings/mrp`.

#### Phase 4 formulas and rules

- **Gross requirement** = plan quantity x BOM quantity. **Adjusted** = gross x (1 + wastage% / 100). A sub-product's adjusted quantity becomes the parent quantity for its own BOM.
- **BOM selection**: active BOMs effective on or before the plan start date; newest effective date wins, then highest version. A missing BOM is reported, never guessed.
- **Available** = on hand - reserved for purposes other than a selected plan. Reservations tied to a plan in the run are not subtracted twice.
- **Netting** is time-phased and lot-for-lot: demands are taken in date order; available stock and scheduled receipts (open PO quantity due on or before the need date) cover them first; any shortfall plus safety stock becomes a planned order, rounded up to 3 dp.
- **Dates**: release = need date - lead time, never earlier than today; arrival = release + lead time. If the arrival is after the need date the order is flagged late with days late. Lead time is the material's own value, else the default in settings.
- **Supplier capacity**: a planned order above a material's `supplierCapacity` is flagged.
- **Urgency**: high if the need date is within 3 days (or late), medium within 10, else low. Thresholds are configurable.
- **Reorder point** = average daily use x lead time + safety stock. Order when (available + on order) <= reorder point. Suggested quantity = reorder point + coverage days x daily use - position (defaults: 90-day look-back, 30-day coverage). With no consumption history the basis is shown as "configured".
- **Demo data**: 4 products (including an in-house billet), 5 BOMs (including two versions of one product and a multi-level one), 4 plans (one short-notice, one beyond the default horizon), 2 reservations, lead times by category, supplier capacities for 3 materials, and 13 weeks of consumption history written as ledger entries that end exactly at current stock.

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

The seed is idempotent, marks every record `isDemoData`, and skips roles whose `DEMO_UID_<ROLE>` is not set. It also seeds the Phase 4 planning data described above and, for Phase 5, 52 weeks of consumption history written as ledger entries and 14 price observations per material (one material has a planted price jump and one a planted consumption spike so risk detection has something to find). It seeds 5 departments, 3 warehouses with opening stock (chosen so every alert level appears; written once, never doubled on re-run), 10 categories, 36 materials, 10 suppliers (7 proven, 1 unproven with 2 orders, 1 unverified, 1 blocked) and demo user profiles. Supplier-role logins link to supplier records via `DEMO_UID_SUPPLIER` (SUP-0001), `DEMO_UID_SUPPLIER_2` (SUP-0002) and `DEMO_UID_SUPPLIER_3` (SUP-0003). Demo data lives in `backend/scripts/demoData.ts` and is covered by tests.

## Tests

```bash
cd backend  && npm test && npm run typecheck && npm run build
cd frontend && npm test && npm run typecheck && npm run lint
```

## Architecture notes

- `backend/` Express + TypeScript + Mongoose (routes → middleware → services → repositories → models).
- `frontend/` Next.js App Router + Tailwind. Route groups: `(auth)` public, `(app)` protected.
- `ml/` Python ML service (forecasting; no database access).
- Roles: system_admin, procurement_manager, department_manager, inventory_officer, finance_officer, supplier, management.

## Known limitations (through Phase 7)

- Phase 7: MongoDB in the Compose stack has no authentication (private network only). Single host, no log shipping or alerting, only the local uploads driver. Details in [docs/deployment.md](docs/deployment.md).
- Phase 7: a backup is only proven by a restore; practise it. Backups are consistent per collection, not a cross-collection snapshot.

- Phase 6: nothing has run against a live MongoDB, a real Firebase project or in a browser. Uploads were tested with an in-memory/temp-dir adapter, never through a real browser file picker.
- Phase 6 audit: an audit entry is written right after the business change, **not in the same transaction**. A crash between the two could lose an entry (failures are logged, never swallowed silently); conversely an entry is never written for a change that failed. The append-only guarantee is enforced in the application. **In production also restrict the database user so it can only insert and find on the `auditlogs` collection.**
- Phase 6 notifications: there is no separate PO approval step, so the "PO issued" notice goes out on issue. Delayed-delivery, supplier-performance and similar scheduled notices are not generated (there is no scheduler); the types exist but only event-driven ones are raised. Polling, not push.
- Phase 6 documents: only the local storage driver is implemented. There is no virus scanning; content sniffing blocks disguised executables but is not antivirus. Staff have no UI to view a supplier's quotation attachments from the comparison page yet (the API allows it once the RFQ is opened). Deleting a record's file is by the uploader, a procurement manager or an administrator.
- Phase 6 reports: capped at 5,000 rows (a note says so). PDF is a plain table layout, not a designed document. Department managers see only non-financial reports and are not narrowed to their own department. Report queries are indexed by date and status but were not load-tested.
- Phase 6 tests: pdfkit is mapped to its bundled build in Jest only (its font dependency is ESM-only in Jest's sandbox); production Node loads the real package and a PDF was generated that way once.


- Backend tests mock Firebase Admin and the user repository. **Nothing has yet been run against a live MongoDB or a real Firebase project** in this build; verify with the quick start above.
- **Transactions have not been run against a real MongoDB.** The tests mock the transaction helper, so they prove the ordering and the guard conditions, not rollback behaviour. Run the quick start with the replica-set container and try a receipt, an over-issue and two concurrent receipts before relying on it.
- Not built yet: payments against verified invoices, returns of rejected goods to the supplier, supplier-side PO acknowledgement, PO amendments, attachments (Phase 6).
- Cancelling an issued PO leaves its requisition in Ordered; there is no reopen flow yet.
- Stock overview is computed in the API per request (fine for demo scale, not for very large catalogues).
- Phase 5: nothing has run against a live MongoDB or in a browser. The Python service and the Node client **were** run together over HTTP once on seeded-shape data (all four models evaluated, wrong key refused), but the backend services that save forecasts and alerts were tested only with mocked models.
- Phase 5 not built: Isolation Forest (anomaly detection is statistical and rule-based), saved model artifacts, scheduled forecast or scan jobs (both run on demand), a local language model (alert notifications and the Supplier Evaluation page were added in Phase 6).
- Phase 5: alerts for conditions that later clear (for example a delayed PO that arrives) stay open until a person closes them. Procurement spend in the assistant is committed spend from issued POs, not payments. Price history comes from recorded observations and issued POs; the demo data supplies a year of observations.
- Phase 5: forecasts use short, synthetic demo history; accuracy figures describe that data only. A forecast is a prediction and can be wrong.
- Phase 4: the MRP service, seed and every Phase 3 transaction have not run against a live MongoDB. The UI has never been opened in a browser.
- Phase 4: an in-progress plan counts at its full quantity (no credit for work already issued). Two simultaneous reservations can both pass the free-stock check. PDF export is browser print-to-PDF, not server-generated. Consumption history in the seed is about 90 days; a full year arrives with forecasting in Phase 5.
- Backend: 569 tests (domain rules, route permissions/validation, mocked-model services, demo data). Atomic-gate ordering and unique indexes are untested against a real MongoDB; a failure between dependent writes could leave partial state.
- Frontend: 138 tests (13 files); ML: 18 pytest tests (navigation, guards, forms, decimal maths, comparison, approvals). Pages such as settings and overview have little direct coverage.
- No end-to-end test of supplier isolation against a running server.
- The Next.js build was verified; the app itself was not exercised in a browser.
- Express 5, Mongoose 9, TypeScript 7 and TanStack Table 8 are used. Tests transpile with SWC; type-checking is done by `tsc`.
