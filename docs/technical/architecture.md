# Architecture – RequestFlow

> Living document: whoever changes the structure changes this document **in the same PR**.
> Altitude: modules/folders, not single files. Current state – plans belong in specs and ADRs.
> Guard: the reviewer role. Beyond ~3 screens it gets condensed, not extended.

## Summary

RequestFlow receives quote requests (e-mail + PDF/Excel/Word attachments), extracts structured
fields with source evidence via a stateless Python AI service, lets staff review, correct and
approve them, and exports each approved request exactly once to an ERP (mock in the pilot).
It is a TypeScript modular monolith (`web` + `worker` from one codebase) on PostgreSQL, plus the
AI service. Decisions and rationale: [ADR-0001](../decisions/ADR-0001-pilot-architecture.md).

**Current state (2026-09-23): #3 skeleton, #4 identity/tenancy, #5 intake** – runnable stack, health
endpoint, invite-only login, companies, `withTenant()` with forced RLS, upload with atomic enqueue
and duplicate flags, module boundaries enforced. Tables: [data-model.md](data-model.md). Status per module below (`skeleton` = public
`index.ts` only).

## Modules

Every new file belongs to one of these modules – otherwise add the module here first (SYSTEM.md §7).

| Module | Location | Task | Exposure | Data class | Protection | Status |
|---|---|---|---|---|---|---|
| `intake` | `src/features/intake/` | upload, duplicate fingerprint, creates request + documents | authenticated UI/route | confidential + personal | session, tenant context, size/type limits | built: upload validation (extension + signature, size), fingerprint, atomic submit |
| `documents` | `src/features/documents/` | document records, storage references, hashes | internal | confidential | tenant context | built: records, SHA-256, storage keys |
| `extraction` | `src/features/extraction/` | AI-service client, persists runs/fields/evidence | internal | confidential + personal | tenant context, contract validation | built: AI-service client (timeout, error classes), field merge, runs/segments/fields |
| `requests` | `src/features/requests/` | request aggregate, status machine | internal | confidential | tenant context | built: repository, status machine, processing state, list filters (status, possible duplicate) |
| `review` | `src/features/review/` | review UI, corrections, approve/reject | authenticated UI | confidential + personal | session, role check, audit | built: review page (fields + status badges + source view), corrections with history, approve (→ export job) / reject with reason, duplicate decision (confirm or reject as duplicate) |
| `export` | `src/features/export/` | ERP port + REST adapter, idempotency | outbound HTTP | confidential | idempotency key, unique export, timeout | built: REST adapter (timeout, error classes, contract validation), export handler under row lock, `drainExports()`, `request_exports` |
| `erp-mock` | `src/features/erp-mock/` | simulated ERP REST API | route behind flag | synthetic | disabled unless `ERP_MOCK_ENABLED` | built: idempotent receiver (replay → same reference, 409 on a different body), fault injection, bounded in-memory store, route `/api/erp-mock/v1/quote-requests` |
| `identity` | `src/features/identity/` | Better Auth, users, companies, roles | public login route | personal (staff) | rate limit, invite-only | built: Better Auth (invite-only, organization + admin plugins), `authorize()`, audited invite, user management (`/users`: roles, deactivate/reactivate, last-admin rule), seed |
| `tenancy` | `src/features/tenancy/` | `withTenant()`, RLS policies | internal | – | forced RLS, `app_rw` without BYPASSRLS | built: `withTenant()`, forced RLS on `app.*`, guard test (every `app` table: `company_id`, forced RLS, only company policies; allow-list empty) |
| `audit` | `src/features/audit/` | append-only audit events | internal | personal (staff) | INSERT/SELECT only | partial: `recordAudit()` (append-only enforced by grants) |
| `jobs` | `src/features/jobs/`, entrypoint `src/worker.ts` | pg-boss, job handlers, `drain()`, worker entrypoint | internal | IDs only | transactional enqueue | built: queues, transactional enqueue, handler, `drain()`, dead letter → ERROR, reprocess, worker loop |
| `storage` | `src/features/storage/` | `BlobStore` port + S3 adapter | internal | confidential | private bucket, access via app routes | built: S3 adapter (put/get/delete, bucket setup, ping) |
| `observability` | `src/features/observability/` | logger, health, request-list ops data | `/api/health` | IDs only | no PII in logs | partial: health aggregation (database, storage) |
| `db` | `src/db/`, deploy step `src/setup.ts` | Drizzle schema, migrations, DB roles | internal | – | migrations as owner role | built: roles check, schema `app`, default grants for `app_rw` |
| `config` | `src/config/` | typed runtime configuration, validated at start (zod) | internal | secrets (in memory only) | errors name variables, never values | built |
| `app` | `src/app/` | Next.js routes and pages; composition root `src/app/_server/` (pool, storage client) | `/`, `/login`, `/signup`, `/invite`, `/requests`, `/requests/:id`, `/api/requests`, `/api/documents/:id`, `/api/auth/*`, `/api/health`, `/api/erp-mock/v1/quote-requests` (flag) | – | calls module APIs only (dependency-cruiser) | partial: login, sign-up, invite, home, requests, review page, ERP mock route |
| AI service | `services/ai/` | docling parsing, extraction, grounding, evals | internal HTTP | confidential + personal (transient) | bearer token, stateless, no DB/storage access | partial: `POST /v1/extract` – EML + PDF (text layer) → segments, 6 header fields + line items (schema v2, prompt `extract_v2`), normalisers (German numbers, units, dates, calendar weeks → at most `uncertain`), grounding verifier, bearer auth; Vertex adapter with recorded responses (live call unverified) |
| Contracts | `contracts/` | OpenAPI: AI service, ERP export | – | – | contract tests | built: `ai-service.openapi.yaml` (generated from the service), `erp-export.openapi.yaml` (hand-written); TS types + drift tests |

## Exceptions register

Deliberately accepted risks – without an entry here a deviation counts as a defect. Global (non-tenant) tables in schema `app` additionally need an entry in `GLOBAL_APP_TABLES` (`src/features/tenancy/rls-guard.ts`) – the guard test (#29) fails otherwise.

| Exception | Why accepted | Owner | Expires |
|---|---|---|---|
| No RLS on the `auth` and `pgboss` schemas | Not company-owned business data; reachable only by server code (ADR-0001 D7) | Fluory | 2026-12-31 (review at M3) |
| Showcase without unattended retries (Vercel Hobby cron once/day) | Showcase only; production runs a worker (D2) | Fluory | when a production-like demo is needed |
| Better Auth admin plugin mounted without any holder of its admin role | ADR-0001 D6 names the plugin; decided in #30: kept – its `banned` field implements deactivation (sign-in blocked by the plugin). Nobody holds `platform-admin`, so `/api/auth/admin/*` rejects every caller (tested); user management runs through `identity` | Fluory | 2026-12-31 (review at M3) |
| Upload endpoint without a per-user rate limit | Authenticated staff only; body bounded by `Content-Length` + `UPLOAD_MAX_REQUEST_BYTES` before reading | Fluory | before any public deployment (#19) |
| `.msg` uploads checked by OLE signature only | Structure check of Outlook messages needs a CFB parser; files are served only as attachments with `nosniff` and parsed later by the stateless AI service | Fluory | with #23 (MSG parsing) |
| Gemini API free tier for local development | Synthetic data only; never showcase or customer data (D8) | Fluory | when a Vertex development budget exists |

## Data flow

```text
upload ─► intake ─► storage (S3) + requests(NEW) + job   ── one transaction
worker ─► jobs.drain ─► extraction ─► AI service (bytes in, segments + fields + evidence out)
       ─► requests(REVIEW) + fields + audit              ── one transaction
review ─► corrections + approve ─► requests(APPROVED) + export job + audit
worker ─► export ─► ERP (Idempotency-Key) ─► requests(EXPORTED)
failure at any step ─► retry with backoff ─► dead letter ─► requests(ERROR, visible cause)
```

## External services & interfaces

| Service | Purpose | Environments |
|---|---|---|
| PostgreSQL 17 | all state incl. queue and auth | local container · showcase Neon (aws-eu-central-1) |
| S3-compatible storage | original mails and attachments | local SeaweedFS · showcase Cloudflare R2 (EU jurisdiction) |
| Vertex AI (`eu` endpoint, gemini-3.5-flash) | extraction | showcase + customer; local dev may use the Gemini free tier with synthetic data |
| ERP | export target | pilot: `erp-mock`; contract `contracts/erp-export.openapi.yaml` |

No secrets in this document; every variable is documented in `.env.example`.

## Database roles

| Role | Created by | Used by | Properties |
|---|---|---|---|
| `app_owner` | `docker/postgres/init/01-roles.sh` (password from env) | migrations (`src/setup.ts`, `MIGRATION_DATABASE_URL`) | owns schema `app`; no superuser, NOBYPASSRLS |
| `app_rw` | same | web + worker (`DATABASE_URL`) | USAGE on `app`, no CREATE; DML via default privileges; no superuser, NOBYPASSRLS – RLS always applies |

The first migration refuses to run if either role is missing or could bypass RLS.
