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

**Current state (2026-09-22): foundation only – no module is built yet.** Status per module below.

## Modules

Every new file belongs to one of these modules – otherwise add the module here first (SYSTEM.md §7).

| Module | Location | Task | Exposure | Data class | Protection | Status |
|---|---|---|---|---|---|---|
| `intake` | `src/features/intake/` | upload, duplicate fingerprint, creates request + documents | authenticated UI/route | confidential + personal | session, tenant context, size/type limits | planned |
| `documents` | `src/features/documents/` | document records, storage references, hashes | internal | confidential | tenant context | planned |
| `extraction` | `src/features/extraction/` | AI-service client, persists runs/fields/evidence | internal | confidential + personal | tenant context, contract validation | planned |
| `requests` | `src/features/requests/` | request aggregate, status machine | internal | confidential | tenant context | planned |
| `review` | `src/features/review/` | review UI, corrections, approve/reject | authenticated UI | confidential + personal | session, role check, audit | planned |
| `export` | `src/features/export/` | ERP port + REST adapter, idempotency | outbound HTTP | confidential | idempotency key, unique export, timeout | planned |
| `erp-mock` | `src/features/erp-mock/` | simulated ERP REST API | route behind flag | synthetic | disabled unless `ERP_MOCK_ENABLED` | planned |
| `identity` | `src/features/identity/` | Better Auth, users, companies, roles | public login route | personal (staff) | rate limit, invite-only | planned |
| `tenancy` | `src/features/tenancy/` | `withTenant()`, RLS policies | internal | – | forced RLS, `app_rw` without BYPASSRLS | planned |
| `audit` | `src/features/audit/` | append-only audit events | internal | personal (staff) | INSERT/SELECT only | planned |
| `jobs` | `src/features/jobs/` | pg-boss, job handlers, `drain()`, worker entrypoint | internal | IDs only | transactional enqueue | planned |
| `storage` | `src/features/storage/` | `BlobStore` port + S3 adapter | internal | confidential | private bucket, access via app routes | planned |
| `observability` | `src/features/observability/` | logger, health, request-list ops data | `/api/health` | IDs only | no PII in logs | planned |
| `db` | `src/db/` | Drizzle schema, migrations, DB roles | internal | – | migrations as owner role | planned |
| `config` | `src/config/` | typed runtime configuration, validated at start (zod) | internal | secrets (in memory only) | errors name variables, never values | planned |
| AI service | `services/ai/` | docling parsing, extraction, grounding, evals | internal HTTP | confidential + personal (transient) | bearer token, stateless, no DB/storage access | planned |
| Contracts | `contracts/` | OpenAPI: AI service, ERP export | – | – | contract tests | planned |

## Exceptions register

Deliberately accepted risks – without an entry here a deviation counts as a defect.

| Exception | Why accepted | Owner | Expires |
|---|---|---|---|
| No RLS on the `auth` and `pgboss` schemas | Not company-owned business data; reachable only by server code (ADR-0001 D7) | Fluory | 2026-12-31 (review at M3) |
| Showcase without unattended retries (Vercel Hobby cron once/day) | Showcase only; production runs a worker (D2) | Fluory | when a production-like demo is needed |
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
| ERP | export target | pilot: `erp-mock`; contract `contracts/erp-export.openapi.yaml` (planned) |

No secrets in this document; configuration lives in `.env.example` (created with the first code issue).
