# Deployment

SteelProcure AI is a demo prototype with synthetic data. These notes get it running somewhere other than your laptop; they are not a security review. Read "What is not covered" before putting real business data in it.

## Option A: Docker Compose (recommended)

Runs MongoDB (as a replica set, which stock transactions need), the ML service, the API and the web app.

```bash
cp .env.production.example .env          # fill in every value; never commit .env
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml ps          # wait for "healthy"
```

Startup refuses to proceed if a required value is missing (Compose) or if the API is in production with a placeholder `ML_INTERNAL_KEY`, no Firebase credentials, or a non-https `FRONTEND_URL` (the API itself).

Optional demo data (synthetic, idempotent; do not run against a real database):

```bash
docker compose -f docker-compose.prod.yml --env-file .env --profile tools run --rm seed
```

### How the pieces connect

| Service | Reachable from | Notes |
|---|---|---|
| `mongo` | other containers only | Not published. Network is `internal` (no outbound internet). |
| `ml` | backend only | Needs the `X-Internal-Key` secret. Not published. |
| `backend` | host `127.0.0.1:5000` | The browser calls it directly, so it needs a public HTTPS address. |
| `frontend` | host `127.0.0.1:3000` | |

Ports bind to `127.0.0.1` so a reverse proxy on the same host does TLS. Set `PUBLISH_ADDRESS=0.0.0.0` only if you know why.

### Reverse proxy and TLS

Put any TLS-terminating proxy in front. Caddy example (certificates are automatic):

```
app.example.com { reverse_proxy 127.0.0.1:3000 }
api.example.com { reverse_proxy 127.0.0.1:5000 }
```

With nginx, set `client_max_body_size` to at least `MAX_UPLOAD_MB` (nginx defaults to 1 MB and would reject document uploads) and pass `X-Forwarded-For`. The API trusts exactly one proxy hop.

### Firebase checklist

1. Add your app domain (`app.example.com`) under Firebase Console -> Authentication -> Settings -> **Authorized domains**, or sign-in will fail.
2. Server credentials (`FIREBASE_PRIVATE_KEY` and friends) go in `.env` only. Keep the key on one line, single-quoted, with literal `\n`.
3. The `NEXT_PUBLIC_*` values are compiled into the web bundle. **Changing any of them means rebuilding the frontend image** (`up -d --build frontend`).
4. `BOOTSTRAP_ADMIN_EMAIL` is provisioned as System Administrator the first time that *verified* account signs in. Everyone else starts pending.

### Operating it

```bash
docker compose -f docker-compose.prod.yml logs -f backend     # logs
curl -s http://127.0.0.1:5000/health                         # {"status":"ok","database":"connected"}; 503 if the database is down
docker compose -f docker-compose.prod.yml up -d --build      # update after pulling new code
docker compose -f docker-compose.prod.yml down                # stop (data volumes are kept; add -v ONLY to destroy data)
```

Containers run as non-root with all Linux capabilities dropped (MongoDB excepted), restart unless stopped, and shut down gracefully on `docker stop` (in-flight requests finish, then the database connection closes).

Health checks: backend `/health` (reports database state), frontend `/login`, ML `/health`, MongoDB replica-set status.

## Option B: no Docker

1. Create a free MongoDB Atlas cluster (already a replica set, so transactions work) and put its connection string in `backend/.env` as `MONGODB_URI`.
2. Backend: `cd backend && cp .env.example .env && npm ci && npm run dev` (or `npm run build && npm start`).
3. ML service: `cd ml && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && python main.py`. Use the same `ML_INTERNAL_KEY` as the backend.
4. Frontend: `cd frontend && cp .env.example .env.local && npm ci && npm run dev`.

## What is not covered

- **MongoDB has no authentication in the Compose stack.** It is isolated on a private network, which is reasonable for a demo on one host. For real data, use MongoDB authentication with a key file, or a managed database (Atlas), and keep the audit collection insert-only for the application user (see the README).
- **Uploads are on a local Docker volume** (`uploads_data`). Only the `local` storage driver exists. Back the volume up; it holds confidential documents.
- **No central log shipping, metrics or alerting.** `docker logs` only.
- **Single host, single instance.** No load balancing or high availability. Do not run two API containers against the same uploads volume on different machines.
- **Secrets live in a `.env` file on the host.** Restrict its permissions (`chmod 600 .env`) or use your platform's secret store.
- **The images were not built or run in the environment where this was written** (no Docker daemon there). See the README for exactly what was and was not verified.
