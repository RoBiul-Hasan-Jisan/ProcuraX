# ProcuraX – System Architecture

## 1. Big picture

```mermaid
flowchart LR
  U[Browser<br/>7 role types] -->|HTTPS| FE[Frontend<br/>Next.js 16 on Vercel]
  FE -->|Firebase JS SDK: sign in| FB[(Firebase Auth)]
  FE -->|REST /api/v1 + ID token| BE[Backend API<br/>Express 5 on Render]
  BE -->|verify ID token| FB
  BE --> DB[(MongoDB Atlas<br/>replica set)]
  BE --> FC[Built-in forecaster<br/>TypeScript, in-process]
  BE -.optional.-> ML[Python ML service<br/>FastAPI, RF / XGBoost]
  BE --> FS[(Document storage<br/>local disk)]
```

* The **frontend** never talks to MongoDB. It signs in with Firebase, then sends the Firebase ID token to the API.
* The **backend** verifies the token, loads the user and role **from MongoDB**, and checks the permission on every route. A role sent by the client is ignored.
* **Forecasting** runs inside the backend (free, offline). The Python service is optional (`ML_MODE=auto|builtin|service`).

## 2. Request pipeline (backend)

```mermaid
flowchart LR
  R[Request] --> H[helmet, CORS, rate limit] --> V[verifyFirebaseAuth] --> L[loadUserProfile<br/>role + permissions from DB] --> P[requirePermission] --> Z[zod validation] --> S[Service<br/>business rules] --> M[(Mongoose models)]
  S --> A[Audit log]
  S --> N[Notifications]
  S --> E[Response envelope]
```

Layers: `routes` (HTTP only) → `services` (rules, transactions) → `domain` (pure functions, no database, heavily tested) → `models`. Audit entries and notifications are written after the business change commits.

## 3. Procurement workflow

```mermaid
flowchart TD
  A[Requisition: Draft] --> B[Submitted]
  B --> C{Approval chain}
  C -->|Dept manager| D[Procurement manager]
  D -->|total > 1,000,000| F[Finance officer]
  D --> G[Approved]
  F --> G
  C -->|reject / modify| X[Rejected / Modification requested]
  G --> H[RFQ created, suppliers invited]
  H --> I[Sealed quotations until deadline]
  I --> J[Closed: compare by landed cost]
  J --> K[Human award + justification]
  K --> L[Draft PO] --> M[Issued PO]
  M --> N[Goods receipt: accepted / rejected]
  N --> O[Stock updated + ledger entry]
  N --> P[Supplier invoice] --> Q{Three-way match}
  Q -->|ok| R[Verified]
  Q -->|mismatch| S[Disputed]
```

## 4. Data model (main collections)

```mermaid
erDiagram
  User ||--o| Supplier : "linked (supplier role)"
  User }o--|| Role : has
  User }o--o| Department : in
  PurchaseRequisition ||--o| ApprovalRequest : has
  ApprovalRequest ||--o{ ApprovalHistory : logs
  PurchaseRequisition ||--o| RFQ : "one active"
  RFQ ||--o{ SupplierQuotation : receives
  RFQ ||--o| PurchaseOrder : awards
  PurchaseOrder ||--o{ GoodsReceipt : receives
  PurchaseOrder ||--o{ Invoice : billed
  GoodsReceipt ||--o{ StockMovement : creates
  Material ||--o{ StockLevel : "per warehouse"
  StockLevel }o--|| Warehouse : in
  Material ||--o{ BOM : "used in"
  ProductionPlan ||--o{ MRPRun : drives
  Material ||--o{ DemandForecast : forecast
```

Other collections: `Notification`, `AuditLog` (append-only), `DocumentFile`, `RiskAlert`, `PriceHistory`, `ConsumptionHistory`, `Counter` (document numbers), `Settings`.

## 5. Roles and what they can do

| Role | Main abilities |
|---|---|
| System Administrator | Everything: users, departments, settings, audit, all master data and workflow |
| Procurement Manager | Approve requisitions, run RFQs, compare and award, POs, supplier management, MRP, risk review |
| Department Manager | Create and approve requisitions for their department, view POs and stock |
| Inventory Officer | Materials, warehouses, goods receipt, stock issue/transfer/adjust, production plans, BOM |
| Finance Officer | Approve high-value requisitions, verify or dispute invoices, financial reports, bank details |
| Supplier | See only RFQs they are invited to, submit sealed quotes, see their own POs and profile |
| Management | Read-only dashboards, stock, forecasts, intelligence and reports |

Permissions are stored in MongoDB (`roles` collection) and enforced by the backend; the UI only hides what the backend would refuse.

## 6. Security rules built in

* No custom JWT and no stored passwords (Firebase handles identity).
* Backend enforces permissions; the client role is never trusted.
* Sealed bids: quotes are hidden from other suppliers and from staff until the RFQ deadline.
* Supplier award is always a manual human decision with a written justification.
* Exact decimal money (`decimal.js`, Decimal128).
* A supplier with fewer than 5 completed orders is never scored as reliable.
* Append-only audit log with secret redaction; notifications never reveal supplier or price.
* Production start refuses placeholder secrets, missing Firebase credentials or a non-https frontend URL.

## 7. Forecasting

```mermaid
flowchart LR
  H[Consumption history] --> W[Weekly buckets] --> B[Rolling-origin backtest] --> S[Lowest RMSE wins] --> F[Forecast 7/30/60/90 days + 80% band]
  W -->|< 8 weeks| I[insufficient_data]
```

Built-in: moving average, exponential smoothing, linear price trend. Optional Python service adds random forest and XGBoost. Every result is labelled as a forecast, with the model version.

## 8. Deployment topology

| Part | Where | Notes |
|---|---|---|
| Frontend | Vercel | `NEXT_PUBLIC_*` variables baked in at build time |
| Backend | Render web service | `ML_MODE=builtin`; free plan sleeps when idle |
| Database | MongoDB Atlas | replica set is required for transactions |
| Auth | Firebase | add the Vercel domain to Authorized domains |
| ML (optional) | second Render service | not needed for the demo |

See [deployment.md](deployment.md) for Docker and [backup-restore.md](backup-restore.md).
