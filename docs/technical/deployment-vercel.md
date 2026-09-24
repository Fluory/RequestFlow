# Showcase deployment – Vercel + Supabase

> Runbook for the operator (orchestrator). Decision: ADR-0001 D11, amendment 2026-09-24. Everything
> here uses **synthetic data only**. No secret belongs in this file, the repository, an issue or a chat –
> keep them in a password manager and the Vercel / Supabase / GCP settings.

## 0. Before you start

| Blocker | Why |
|---|---|
| #60 merged (PR #63: Better Auth schema `auth` → `identity`) | Supabase reserves the schema `auth`; the migrations fail on Supabase until then. The bootstrap script creates no schema, so it is not affected |
| AI service host chosen and running | The drain calls it; recommendation: **Google Cloud Run in the EU** (same GCP project as Vertex `eu`, existing image `services/ai`, no 300 s / package limits) |

What runs where: Vercel (Hobby) runs the Next.js app, the drain route and the ERP mock
(`/api/erp-mock`). Supabase (`eu-central-1`) holds Postgres (incl. the pg-boss queue) and the files.
There is **no worker process** – jobs run through `/api/jobs/drain` (see step 7).

## 1. Supabase project

1. Create a project in region **eu-central-1 (Frankfurt)**. Store the generated `postgres` password in
   the password manager – the app never uses it.
2. **Data API:** Project Settings → Data API: keep the exposed schemas at the defaults `public` and
   `graphql_public` (or turn the Data API off). Never add `app`, `pgboss` or `identity` – the app does not use the Data API.
3. **Storage:** create a **private** bucket `requestflow-documents` (no public access, no RLS policies
   for `anon`/`authenticated`). Storage → S3 connection: enable the S3 protocol and create an **S3 access
   key** (access key id + secret). Note the endpoint `https://<project-ref>.storage.supabase.co/storage/v1/s3`.
4. **Connection strings** (Connect dialog), host `aws-0-eu-central-1.pooler.supabase.com` (check yours):
   - transaction pooler, port **6543** – runtime (`DATABASE_URL`, user `app_rw.<project-ref>`)
   - session pooler, port **5432** – bootstrap and migrations (users `postgres.<project-ref>`, `app_owner.<project-ref>`)

## 2. Database roles (once)

Generate two strong passwords, then as the `postgres` user over the **session pooler**:

```bash
psql "postgresql://postgres.<project-ref>@<pooler-host>:5432/postgres" -v ON_ERROR_STOP=1 \
  -f scripts/supabase-bootstrap.sql
```

psql asks for both passwords without echoing them; they never appear on the command line or in the
process list.

The last output lists `app_owner` and `app_rw` with `f | f | f` (no superuser, no RLS bypass, no role
creation). The script is all-or-nothing; running it twice fails on "role already exists" – that is fine.

## 3. AI service

Deploy `services/ai` (Cloud Run EU recommended) with Vertex `eu` credentials (a service account of the
GCP project, never an API key in the repo) and a random `AI_SERVICE_TOKEN` (≥ 24 chars). The Gemini
free tier is **not** allowed for the showcase (D8). Note its HTTPS URL.

## 4. Vercel project

Import the GitHub repository (framework Next.js is set by `vercel.json`, function region `fra1`,
drain route limit 300 s, one cron). Keep **Fluid compute** enabled (the Hobby default) – without it the
300 s function limit is not available; verify it in Project Settings → Functions. Set the variables below for **Production**. Do not give Preview
deployments the showcase database – leave Preview variables empty (previews then fail closed) or use a
separate Supabase project.

| Variable | Value |
|---|---|
| `APP_ENV` | `showcase` |
| `DATABASE_URL` | `postgresql://app_rw.<project-ref>:<APP_RW_PASSWORD>@<pooler-host>:6543/postgres` (transaction pooler) |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | `https://<project-ref>.storage.supabase.co/storage/v1/s3` / `eu-central-1` / `requestflow-documents` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | the Supabase S3 access key |
| `S3_FORCE_PATH_STYLE` | `true` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `https://<your-project>.vercel.app` |
| `AUTH_IP_HEADERS` | `x-real-ip` (set by Vercel; confirm in the smoke check) |
| `AI_SERVICE_URL` / `AI_SERVICE_TOKEN` | URL from step 3 / the same token as the AI service |
| `AI_SERVICE_TIMEOUT_MS` / `UPLOAD_MAX_FILES` | `60000` / `3` – one job must fit into one 300 s run (enforced at start) |
| `ERP_BASE_URL` | `https://<your-project>.vercel.app/api/erp-mock` |
| `ERP_TOKEN` | random, ≥ 24 chars (not the local default) |
| `ERP_MOCK_ENABLED` | `true` |
| `CRON_SECRET` | `openssl rand -base64 32` – Vercel Cron sends it as `Authorization: Bearer …` |
| `JOB_DRAIN_INLINE` | `true` |
| `DEMO_MODE` | `true` |
| `UPLOAD_MAX_PER_HOUR` | e.g. `20` – uploads per person and hour (every upload starts paid AI calls); **required** with `APP_ENV=showcase` |

`.env.example` documents every variable. `MIGRATION_DATABASE_URL` and `SEED_PASSWORD` are **not** set on
Vercel – they are only used from the operator's shell (steps 5 and 6).

## 5. First migration

From a checkout on the operator's machine (`pnpm install`), export the Production variables of step 4 in
the shell plus `MIGRATION_DATABASE_URL=postgresql://app_owner.<project-ref>:<APP_OWNER_PASSWORD>@<pooler-host>:5432/postgres`
(**session** pooler), then run `pnpm setup:deploy`. It applies the migrations, installs the pg-boss
queues and checks the bucket. It is idempotent – repeat it after every release with new migrations,
**before** promoting the deployment.

## 6. Demo accounts

With the same shell variables and a strong `SEED_PASSWORD` (≥ 12 chars, password manager), `pnpm seed:demo`
creates the two synthetic companies with their admins (invite-only; see `src/seed.ts`). Hand the
accounts out only to people who may see the demo.

## 7. Jobs without a worker

- `after()`: with `JOB_DRAIN_INLINE=true`, upload, approval and "Erneut verarbeiten" drain once after the
  response – the normal path needs nothing else.
- Cron: `vercel.json` calls `GET /api/jobs/drain` **once a day** (some time within 05:00–05:59 UTC – Hobby
  crons are not minute-exact) – the Hobby maximum. It picks
  up retries with backoff that no user action triggered. Faster unattended retries need a paid plan or a
  worker (exceptions register).
- Manual: `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/jobs/drain` (GET or
  POST) returns counts only. Without the right secret → 401; without `CRON_SECRET` → 404.
- One run stops taking new jobs after 50 s (processing) + 20 s (export); a job in hand always finishes.
  An `after()` drain subtracts the time its request already used (e.g. the upload itself) from the 50 s.
  If the platform still kills a run, the job becomes visible again after its pg-boss expiry (1 h).

## 8. Smoke check

1. `GET /api/health` → 200, `database` and `storage` `ok`, `aiService` `ok`.
2. Drain route: without header → 401; with the secret → 200 JSON.
3. The banner „Demo – nur synthetische Daten" is visible on the login page.
4. Sign in as the seeded admin, upload a synthetic `.eml` (like the one in `tests/e2e/review-smoke.spec.ts`)
   → the request reaches *Zur Prüfung* within about a minute; approve it → *Exportiert* with an ERP reference.
5. Vercel function logs show `jobs.drain_run` lines (IDs and counts only). Confirm the client IP header
   (rate limit). `SHOW statement_timeout` as `app_rw` reads `30s` (set on the role by the bootstrap
   script, so it holds even if Supavisor drops the pool's startup parameter).

## 9. Switch off and roll back

- Pause the showcase: remove `CRON_SECRET` and set `JOB_DRAIN_INLINE=false` (route → 404, no drains), or
  pause the Supabase project.
- Code: Vercel "Instant Rollback" to the previous deployment. Migrations are forward-only
  (`docs/technical/operations.md` → Rollback); roll back code only to a version that knows the schema.
- Rotate a leaked secret in its settings page, then redeploy (Vercel reads variables at deploy time).

## Known limits

- The ERP mock keeps its idempotency store in memory **per function instance**, so its replay answer
  holds only within one instance. The app side (unique export row + row lock, D9) still sends each
  approved request once; keep `ERP_MOCK_FAULTS` empty on the showcase (a simulated lost answer could be
  replayed on another instance).
- Unattended retries only once a day (see 7).
