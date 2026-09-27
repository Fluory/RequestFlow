# Showcase deployment – Vercel + Supabase

> Runbook for the operator (orchestrator). Decision: ADR-0001 D11, amendment 2026-09-24. Everything
> here uses **synthetic data only**. No secret belongs in this file, the repository, an issue or a chat –
> keep them in a password manager and the Vercel / Supabase / GCP settings.

## 0. Before you start

| Blocker | Why |
|---|---|
| AI service running (§3) | The drain calls it. Showcase decision 2026-09-26 (ADR-0001 D11 amendment, #67): a second **Vercel** project with a Gemini API key (temporary exception). Fallback if the Vercel spike fails: Google Cloud Run in the EU with Vertex `eu` |

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

## 3. AI service (second Vercel project, container)

1. Import the same GitHub repository as a **second Vercel project**: framework **`container`**, Root
   Directory **`services/ai`**. Vercel builds `services/ai/Dockerfile.vercel` (same build as
   `Dockerfile`) and runs it on Vercel Functions (container images, beta). A plain Python function does
   not fit: the bundle is 1386 MB against the 500 MB function limit (ADR-0001 D11 amendment 2026-09-26).
2. Deployment Protection: **Vercel Authentication for preview deployments only** – the web app calls the
   production URL server-side; the API itself is protected by `AI_SERVICE_TOKEN`.
3. Variables (**Production**). Every secret – here `AI_SERVICE_TOKEN` and `GEMINI_API_KEY` – is added as
   **sensitive** (`vercel env add <NAME> production --sensitive`, value on stdin), so nobody can read it
   back in the dashboard:

   | Variable | Value |
   |---|---|
   | `PORT` | `8080` – the image runs as a non-root user, which cannot bind Vercel's default port 80 |
   | `AI_SERVICE_TOKEN` | random, ≥ 24 chars – the **same** value as `AI_SERVICE_TOKEN` in the web app |
   | `AI_ALLOW_GEMINI_API_DEV` | `true` |
   | `GEMINI_API_KEY` | the orchestrator's key – the orchestrator pipes it in from a file they created themselves; never in a chat, the repo or an issue |
   | `AI_PDF_PIPELINE` / `AI_PDF_OCR` | `textlines` / `off` – no model downloads on the showcase |
   | `AI_MODEL_TIMEOUT_SECONDS` | `45` – budget of one model call including retries; it must stay below the web app's `AI_SERVICE_TIMEOUT_MS` (60 s) minus parsing, or the worker gives up while the model still runs |

   `VERTEX_PROJECT` stays **unset**: together with `AI_ALLOW_GEMINI_API_DEV=true` the service refuses to start.
4. **Exception (ADR-0001 D11 amendment 2026-09-26, exceptions register):** the Gemini API free tier is only
   allowed while the showcase is invite-only for the orchestrator with synthetic data. Before anyone else
   gets a demo account (at the latest 2026-10-31): enable billing for the key (paid tier) or switch to
   Vertex `eu` (`VERTEX_PROJECT`, service account, `AI_ALLOW_GEMINI_API_DEV` removed).
5. `GET <ai-url>/healthz` → 200. The production URL → `AI_SERVICE_URL` of the web app (§4).
   Instances scale to zero after 5 minutes without traffic (vercel.com/docs/functions/container-images,
   verified 2026-09-27); the first call after that pays a cold start (measured about 5.6 s).

## 4. Vercel project

Import the GitHub repository (framework Next.js is set by `vercel.json`, function region `fra1`,
drain route limit 300 s, one cron). Keep **Fluid compute** enabled (the Hobby default) – without it the
300 s function limit is not available; verify it in Project Settings → Functions. Set the variables below for **Production**. Do not give Preview
deployments the showcase database – leave Preview variables empty (previews then fail closed) or use a
separate Supabase project. Add every secret (`DATABASE_URL`, the S3 keys, `BETTER_AUTH_SECRET`,
`AI_SERVICE_TOKEN`, `ERP_TOKEN`, `CRON_SECRET`) as **sensitive**, as in §3.

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

Then `pnpm seed:samples` (same variables and `SEED_PASSWORD`) prepares per company one sample to review and one
approved sample that it exports right away through the normal export path to the configured ERP (the ERP mock
route; if it is not reachable, the export is queued and the next drain retries it) (#71). Their extraction replays answers recorded
once with `pnpm samples:record` (`src/features/samples/data/`) – no model call, so the samples work even while the
model provider is overloaded. List and detail label them „Vorbereitetes Beispiel – aufgezeichnete KI-Antwort“. The
step is idempotent: repeat it whenever visitors have decided the samples, and it adds only what is missing.

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
- Pause the AI service: pause the Vercel project `requestflow-ai`; uploads then end in a visible
  processing error with retries instead of reaching the model.
- When the Gemini free-tier exception expires (ADR-0001 D11 amendment 2026-09-26, at the latest
  2026-10-31): delete the key in Google AI Studio, remove `GEMINI_API_KEY` and `AI_ALLOW_GEMINI_API_DEV`
  from `requestflow-ai`, then switch to the paid tier or Vertex `eu` (§3 step 4) and redeploy.
- Remove the showcase completely: delete both Vercel projects (`requestflow`, `requestflow-ai`) and the
  Supabase project – all data is synthetic, nothing has to be kept.

## Known limits

- The ERP mock keeps its idempotency store in memory **per function instance**, so its replay answer
  holds only within one instance. The app side (unique export row + row lock, D9) still sends each
  approved request once; keep `ERP_MOCK_FAULTS` empty on the showcase (a simulated lost answer could be
  replayed on another instance).
- Unattended retries only once a day (see 7).
