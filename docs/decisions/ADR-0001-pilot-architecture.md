# ADR-0001 · Pilot architecture baseline

- **Status:** Accepted – 2026-09-22 by Fluory (orchestrator); every decision D1–D11 was confirmed individually
- **Deviation from the draft:** D8 – the orchestrator chose a Python AI service from day 1 instead of
  the drafted recommendation (full TypeScript); the draft recommendation is kept as alternative 1 in D8
- **Deciders:** Fluory (orchestrator) · drafted by a Claude session
- **Inputs:** `docs/input/2026-09-22-kundenanfrage.md` (customer request), `PROJECT-START.md` (discovery)
- **Facts verified:** 2026-09-22 against official docs, registries and provider terms (sources at the end).
  Statements without a source are marked *heuristic* or *to verify*.

| Decision | Topic | Confirmed |
|---|---|---|
| D1 | Application architecture: TS modular monolith + stateless Python AI service | ✔ 2026-09-22 |
| D2 | Runtime: Node.js 24 + Python 3.13; `web`/`worker` from one codebase; `drain()` | ✔ 2026-09-22 |
| D3 | Database: PostgreSQL 17 + Drizzle; Neon Frankfurt for the showcase | ✔ 2026-09-22 |
| D4 | Queue: pg-boss 12 with transactional enqueue | ✔ 2026-09-22 (challenged) |
| D5 | Object storage: S3 API – SeaweedFS / R2 EU / customer's choice | ✔ 2026-09-22 (challenged) |
| D6 | Authentication: Better Auth, pinned, minimal plugins | ✔ 2026-09-22 (challenged) |
| D7 | Tenant isolation: repository scoping + forced RLS | ✔ 2026-09-22 (challenged) |
| D8 | AI & documents: Python AI service (FastAPI + docling + Vertex `eu`) | ✔ 2026-09-22 (challenged, deviates from draft) |
| D9 | Integrations: upload in the pilot, ERP mock with idempotency contract | ✔ 2026-09-22 |
| D10 | Observability: JSON logs without PII, transactional audit, health | ✔ 2026-09-22 |
| D11 | Deployment: Docker Compose; Vercel showcase after acceptance | ✔ 2026-09-22 |

## Context

A mid-sized machine-building company (reference case, treated as a real customer) receives
20–50 quote requests per day by e-mail. The relevant data sits in the mail body or in PDF,
Excel and Word attachments. Staff copy it by hand into an internal order overview.

The pilot must cover, end to end: **receive/upload → process documents → extract → review and
correct → approve → export via a (simulated) REST interface** – with a realistic path to
production. Load is tiny (~1,000 requests/month); correctness, traceability and data protection
dominate, not throughput. Scope confirmed by the orchestrator: **~13 working days, complete core**
(see the budget check).

Runtime targets:

| Target | Purpose | Data |
|---|---|---|
| Local Docker Compose | Reference runtime, production-like, reproducible by any reviewer | synthetic |
| Vercel showcase (Hobby) | Public demo, after pilot acceptance | synthetic only |
| Customer environment (later) | Production: EU cloud or on-prem – unknown today | real |

## Decision drivers (from the customer request)

| # | Driver |
|---|---|
| DR1 | The AI must not invent data; unclear values are flagged; each value shows its source (document + location) |
| DR2 | Staff review, correct, approve or reject |
| DR3 | A request is never exported to the ERP twice |
| DR4 | No request is lost when the AI or another external service is down; retry later; error visible |
| DR5 | Users see only data of their own company (several subsidiaries later) |
| DR6 | Traceable history of who changed or approved what |
| DR7 | Duplicate requests are detected |
| DR8 | Extraction quality is measurable; regressions after prompt/model changes are caught |
| DR9 | Short pilot; clean implementation, extensibility, traceable operation |
| DR10 | GDPR: EU processing, few processors, DPA chain including the LLM provider (add-on `datenschutz`) |

## Overview

```text
Browser ──► web (Next.js, Node 24) ──► PostgreSQL 17 ─┬─ app schema    (RLS per company)
               │  upload, review, approve              ├─ auth schema   (Better Auth)
               │  enqueue job IN SAME TRANSACTION       ├─ pgboss schema (queue)
               ▼                                        └─ audit_events  (append-only)
         Object storage (S3 API, private)
               ▲
worker (same TS codebase) ── pg-boss fetch ──► POST /v1/extract (bytes) ──► ai-service (Python, stateless)
               │     persists result in one transaction ◄── segments + fields + evidence ──┘  docling → Gemini (Vertex "eu") → grounding check
               │
               └── on approval ──► ERP adapter ──HTTP + Idempotency-Key──► ERP mock (REST)
```

Request states: `NEW → PROCESSING → REVIEW → APPROVED → EXPORTED`, plus `REJECTED` (end state after
review) and `ERROR` (with the failed stage `processing | export`, the cause and the next retry).

---

## D1 · Application architecture

**Problem.** One developer, a short pilot, and several features that must stay separable
(intake, parsing, extraction, review, export). A production rollout comes later.

**Decision.** A **modular monolith in TypeScript** on Next.js (App Router), plus **one stateless
Python AI service** (D8).

**Repository layout.**
- `src/` – the TS app.
- `services/ai/` – the Python service.
- `contracts/` – OpenAPI contracts for the AI service and the ERP.

**How the TS app is organised.**
- Feature modules live under `src/features/<module>/`, each with one public entry file
  (`index.ts`).
- dependency-cruiser checks the boundaries in `verify`.
- The domain core is pure TypeScript and built test-first: status machine, duplicate fingerprint,
  field normalisation for display and export.
- UI components and route handlers call module APIs and never touch the database directly.

| Module | Responsibility |
|---|---|
| `intake` | upload, later mailbox adapters; creates request + documents; duplicate fingerprint |
| `documents` | document records, storage references, hashes |
| `extraction` | AI-service client (generated from the OpenAPI contract); persists runs, fields and evidence |
| `requests` | request aggregate, status machine, transitions |
| `review` | review UI, corrections, approve/reject |
| `export` | ERP port, REST adapter, idempotency |
| `erp-mock` | simulated ERP REST API (dev/showcase only, behind a flag) |
| `identity` | Better Auth setup, users, companies (organisations), roles |
| `tenancy` | tenant context, `withTenant()` transaction wrapper, RLS policies |
| `audit` | append-only audit events |
| `jobs` | pg-boss setup, job definitions, `drain()`, worker entrypoint |
| `storage` | `BlobStore` port + S3 adapter |
| `observability` | logger, health check, ops data for the request list |

The Python service has its own packages: `parsing`, `extraction`, `grounding`, `api`, plus `evals/`.
It is one deployable with one purpose, not a second domain.

**Alternatives.**
1. *Separate API (Hono/NestJS) + SPA* – explicit API contract and an independent frontend, but two
   deployables, duplicated types and a slower first slice.
2. *Microservices (intake / extraction / export)* – independent scaling is irrelevant at 50
   requests/day. Distributed transactions would work against DR3/DR4.

**Trade-offs.** A monolith can be misused as a "big ball of mud"; the module boundaries and the
architecture check prevent that. Scaling happens per process type (`web`, `worker`, `ai`), not per
module.

**Rationale.** It is the fastest structure that still keeps modules replaceable (SYSTEM.md §14:
modular monolith first). The only split, the AI service, follows a real difference in technology.

**Pilot cost.** Foundation: about 1 day (repo, Docker Compose, TS CI, module skeleton). *Heuristic.*
**Revisit when** a module needs its own scaling, release cycle or security boundary, or other
clients need a public API.

---

## D2 · Runtime

**Problem.** Jobs such as parsing, LLM calls and export take seconds to minutes and must survive
failures. The app runs as long-lived containers (Docker/on-prem) *and* on serverless Vercel.

**Decision.** **Node.js 24 LTS** for the TS app, with **one codebase and two entrypoints**:
- `web` – the Next.js server.
- `worker` – a long-running pg-boss consumer.

**Python 3.13** runs the AI service (FastAPI/uvicorn, dependencies managed with `uv`).

Job handlers are plain functions. A shared `drain({ maxMs })` processes available jobs until its
time budget is used up. Who calls it depends on the runtime:

| Runtime | Who calls `drain()` |
|---|---|
| Docker / production | the `worker` process in a loop |
| Vercel showcase | `after()` right after enqueueing (bounded by the 300 s function limit on Hobby), an authenticated "retry now" action, and one daily cron sweep (Hobby cron: at most once per day) |

**Alternatives.**
1. *Vercel Workflow* (GA since 2026-04-16, durable steps) – elegant on Vercel, but it ties the
   durability layer to a platform runtime and adds a second queue model next to Postgres.
2. *Bun* – faster start-up, but a compatibility risk with pg-boss, and no need for it.

**Trade-offs.** On the showcase, retries with backoff are only picked up when something triggers
`drain()`. Timely unattended retries exist only where the worker runs (Docker/production). This is
recorded in the exceptions register (`docs/technical/architecture.md`), not hidden.

**Rationale.** The same job code runs in both environments, and production behaviour (a real worker)
is the default.

**Pilot cost.** About 0.5 day for `drain()` (the Vercel triggers come with the showcase). *Heuristic.*
**Revisit when** the showcase needs unattended retries → Vercel Queues/Workflow as a push trigger,
or a small always-on worker host.

---

## D3 · Database

**Problem.** Requests, extraction results, corrections, audit, auth and jobs need consistent,
transactional storage with tenant isolation, both locally and on the showcase.

**Decision.** **PostgreSQL 17** (pg-boss needs ≥ 13) with **Drizzle ORM** and drizzle-kit SQL
migrations that are checked in and reviewed. One database holds everything, in separate schemas:
`app`, `auth`, `pgboss` and the audit table. **Only the TS app connects to the database**; the AI
service has no database access.

| Environment | Database |
|---|---|
| Local | `postgres:17` container |
| Showcase | **Neon Free** in `aws-eu-central-1` (Frankfurt) via the Vercel Marketplace. 0.5 GB is enough because files are not stored in the database. |
| Production | managed PostgreSQL in the EU or on-prem, with PITR and a rehearsed restore (add-on `datenbank`) |

**Alternatives.**
1. *Supabase* (Postgres + Auth + Storage) – bundled services, but we would only use Postgres, and
   its API surface adds exposure we don't need.
2. *Prisma instead of Drizzle* – mature developer experience, but Drizzle stays closer to SQL,
   declares RLS policies in the schema (`pgPolicy`) and has a verified pg-boss helper
   (`fromDrizzle(tx, sql)`).

**Trade-offs.** Neon's pooler runs PgBouncer in transaction mode, which drops session `SET` and
LISTEN/NOTIFY. We therefore only use transaction-local settings (`set_config(..., true)`), and
pg-boss polls instead of using LISTEN/NOTIFY – both compatible. Neon scales to zero after 5
minutes, so the first showcase request after idle is slower.

**Rationale.** One transactional store is the precondition for DR3/DR4 (D4) and DR5 (D7).

**Pilot cost.** About 0.5 day on top of the foundation (schema, migrations, database roles). *Heuristic.*
**Revisit when** reporting or read load grows (add a read replica), or the customer mandates a
specific database platform.

---

## D4 · Queue / background processing — *challenged: pg-boss vs. Redis*

**Problem.** DR4 (never lose a request, retry, visible error) and DR3 (never export twice) require
durable jobs. The critical failure is a **dual write**: the status change is committed but the
job is lost, or the reverse.

**Decision.** **pg-boss 12** (PostgreSQL ≥ 13, Node ≥ 22.12):

- **Transactional enqueue.** The job is inserted in the *same transaction* as the status change,
  via the `db` option with `fromDrizzle(tx, sql)`. That gives a transactional outbox without a
  separate outbox table.
- **Retries.** `retryLimit`, `retryBackoff`, `retryDelayMax`. Exhausted jobs go to a `deadLetter`
  queue, and the request moves to `ERROR` with a visible cause and a manual "reprocess" action.
- **One job per request at a time.** `singletonKey = requestId`.
- **At-least-once delivery.** Every handler is idempotent (D9 covers the export).
- **Polling, not LISTEN/NOTIFY** (default 2 s). This works through the transaction-mode pooler.
- **Serverless mode.** On Vercel, pg-boss runs with `supervise/schedule/migrate: false`; `drain()`
  runs the maintenance explicitly. *Exact maintenance API to verify during implementation.*
- **Calls to the AI service** happen inside the job with a timeout. A timeout or a 5xx is a normal
  job failure and is retried with backoff.

**Alternatives.**
1. *BullMQ + Redis* – mature, fast, good dashboards. But the enqueue cannot join the Postgres
   transaction, so the dual-write risk returns and needs an outbox table plus a relay anyway. It
   adds a Redis service in Docker and a hosted Redis for Vercel, and BullMQ workers are
   long-running, which does not match serverless. Its throughput headroom is irrelevant at 50/day.
2. *Vercel Queues* (public beta since 2026-02-27, at-least-once) – managed and push-based, but the
   same dual-write issue, beta status, and not available on-prem.

**Trade-offs.** Polling adds up to about 2 s latency and a little database load (irrelevant here).
There is no BullBoard-style dashboard; request states plus pg-boss tables feed the status, attempts
and error shown in the request list, which DR4 requires anyway.

**Rationale.** It is the only option where "saved" and "queued" are one atomic fact, with zero
extra infrastructure. Because pg-boss is Node-only, only the TS worker consumes jobs; the Python
service is called and never polls.

**Pilot cost.** About 1 day including retry and dead-letter tests. *Heuristic.*
**Revisit when** load is sustained above roughly 100 jobs/s, cross-service fan-out is needed, or
the customer platform standardises on a broker. *Heuristic threshold.*

---

## D5 · Object storage — *challenged: S3-compatible provider*

**Problem.** Original mails and attachments are confidential (they contain personal data in real
use). They must be stored privately, served only to authorised users of the right company,
portable to on-prem, and runnable locally and on Vercel.

**Decision.** **S3 API** via `@aws-sdk/client-s3` behind a `BlobStore` port:

- The bucket is private only.
- Object keys are `{companyId}/{requestId}/{documentId}`.
- Files are served only through authenticated app routes that check tenant and role. There are
  never public URLs.
- A SHA-256 hash is stored per file (duplicates, integrity).
- The AI service never receives storage credentials: the worker streams the bytes to it.

| Environment | Provider | Why |
|---|---|---|
| Local | **SeaweedFS** (Apache-2.0, S3 gateway, very active) | MinIO is out – see below |
| Showcase | **Cloudflare R2**, bucket in the **EU jurisdiction** | 10 GB free, no egress cost, S3 core API; *EU jurisdiction on the free plan: medium confidence → verify at setup* |
| Production | customer's choice via config: Hetzner Object Storage (DE, from €6.49/month), AWS S3 `eu-central-1`, or on-prem S3 | same adapter |

**Alternatives.**
1. *Vercel Blob, private* (GA 2026-06-30, EU region selectable, signed URLs) – zero configuration
   on Vercel, but it has its own SDK and no S3 API. That is not portable to on-prem and would need a
   second adapter. Kept as the fallback if R2's EU jurisdiction is unavailable on the free plan.
2. *Postgres `bytea`* – simplest and transactional, but Neon Free has 0.5 GB, backups bloat, and
   there is no production path.

*Rejected:* **MinIO**. The community edition went source-only in October 2025 and into maintenance
mode in December 2025; the repo is archived, and `minio/minio` was removed from Docker Hub
(~2026-09-12). Garage (AGPL-3.0, S3 subset) is a viable local alternative. RustFS reached 1.0 only on
2026-09-16, which is too young.

**Trade-offs.** R2 has no versioning or object lock. The pilot does not need them; production
retention or legal hold may, in which case choose an S3 backend with versioning.

**Rationale.** One API everywhere; the provider is configuration, not code.

**Pilot cost.** About 0.5 day. *Heuristic.*
**Revisit when** the customer requires WORM/retention, on-prem storage, or a specific provider.

---

## D6 · Authentication — *challenged: Better Auth vs. managed auth*

**Problem.** Several staff need login and simple user management. Companies (subsidiaries) must
map to tenants. Data should stay in the EU, and the local Docker demo should run without external
accounts. The production target is most likely the customer's own identity provider – *assumption:
Microsoft 365 / Entra ID, to confirm with the customer*.

**Decision.** **Better Auth** (MIT), pinned to **≥ 1.7.5**, with `@better-auth/drizzle-adapter`.
Sessions are stored in our database, in the `auth` schema.

- **Pilot scope:** e-mail + password, invite-only (no public sign-up).
- **Plugins:** `organization` plugin (organisation = company = tenant) and `admin` plugin (user
  management, used via an invite form and a seed script – no role-admin UI in the pilot).
- **Rate limiting:** the built-in rate limit, with database storage so it works on serverless.
- **Minimal plugin surface:** no magic link, SSO or SCIM in the pilot. These are the areas with
  2025–2026 advisories.
- **CI:** `pnpm audit` fails the build on high/critical findings.
- **Production path:** Entra ID through `@better-auth/sso` (OIDC), which brings MFA and user
  lifecycle from the customer's identity provider.

**Alternatives.**
1. *Clerk* – fastest, with organisations and SSO built in. But **no regional data residency** (US
   infrastructure, EU transfers via the Data Privacy Framework). Priced per user/org/SSO
   connection. It cannot run on-prem, and the local demo would depend on an external service.
2. *WorkOS AuthKit* – strong enterprise SSO, but its DPA names the USA as the storage location, and
   SSO costs $125 per connection.
3. *Self-hosted identity provider (Keycloak/Zitadel)* – standards-based and EU/on-prem capable, but
   one more service to run and harden. Too heavy for the pilot.

**Trade-offs.** We own the auth configuration: password policy, session lifetime, cookies/CSRF and
rate limits. That becomes a security-review item. The library had several advisories in 2025–2026,
including in the organisation and SSO plugins, which we mitigate by pinning, running audits, using
a minimal plugin set and watching advisories. Better Auth joined Vercel on 2026-07-07 and stays
MIT; watch for platform coupling.

**Rationale.** It is the only option that is EU-resident by construction, runs offline in Docker,
maps tenants natively (organisations) and has a documented path to Entra ID.

**Pilot cost.** About 0.5 day: invite form, seed script, roles. *Heuristic.*
**Revisit when** real rollout happens (make Entra SSO mandatory), or if advisories keep hitting the
plugins we use. The fallback is OIDC-only against the customer's identity provider, or Keycloak.

---

## D7 · Authorization and tenant isolation — *challenged: application-level vs. RLS*

**Problem.** DR5 requires that users see only their company's data. The classic failure is one
forgotten `WHERE company_id = …` → a cross-tenant data leak.

**Decision.** **Two layers, one mechanism.**

1. **Application layer.** Every data access goes through module repositories that require a
   `TenantContext`. The `companyId` comes from the session's active organisation, never from
   client input. Role checks run through one `authorize(actor, action, resource)` function per
   module. Pilot roles: `admin` (user management plus everything) and `clerk` (process requests).
2. **Database layer.**
   - Rows: every company-owned table has a `company_id` column, with **RLS enabled and forced** and
     the policy `company_id = current_setting('app.company_id')::uuid`.
   - Roles: the app connects as `app_rw`, which is neither table owner nor able to bypass RLS
     (`NOBYPASSRLS`). Migrations run as the owner role.
   - `withTenant(companyId, fn)`: opens a transaction, calls
     `set_config('app.company_id', $1, true)` (transaction-local, so it is safe with the pooler),
     then runs `fn`.
   - Jobs: the payload carries `companyId`, and the handler runs inside `withTenant` and re-checks
     the request row.
   - The AI service receives no tenant data beyond opaque IDs.
3. **Exception.** Better Auth tables (`auth`) and the queue (`pgboss`) are not company-owned
   business data. They live in separate schemas that only server code reaches. This deviates from
   the global rule "RLS on every table"; the rule's intent (database-enforced tenant isolation) is
   met for all business data. → exceptions register in `docs/technical/architecture.md`.

**Alternatives.**
1. *Application-level filtering only* – simplest and works with any pooler, but a single missing
   filter leaks data, and only tests would catch it.
2. *Schema or database per tenant* – strongest isolation, but migrations run N times. That is
   overkill for "possibly several subsidiaries".

**Trade-offs.** RLS costs about 0.5–1 day (roles, policies, wrapper, tests). "Why is this list
empty?" is harder to debug. Every query must run inside `withTenant`, which the repository API
enforces (no raw database client is exported). **Proof:** integration tests with two tenants that
try cross-tenant reads and writes, both through the repositories and as raw SQL under `app_rw`.

**Rationale.** Defence in depth for the customer's most explicit security requirement, at a cost
the pilot can carry.

**Pilot cost.** About 1 day. *Heuristic.*
**Revisit when** there are many tenants with differing retention or residency needs → schema or
database per tenant.

---

## D8 · AI and document processing — *challenged: full TypeScript vs. Python AI service*

**Problem.** DR1 (nothing invented, source visible) and DR8 (measurable quality) are the core of
the product. Inputs are the mail body plus PDF, XLSX and DOCX attachments, `.msg` files and
possibly scans and table-heavy PDFs.

**Decision.** A separate, **stateless Python AI service** (`services/ai/`, Python 3.13, FastAPI)
owns *parse → extract → verify* and the evals. Its pipeline has four steps.

1. **Parse to segments with stable locators** using **docling** (MIT, LF AI & Data).
   - Formats: PDF (layout, reading order, tables, OCR for scans), DOCX, XLSX, and mail formats as
     listed in the docling docs.
   - *To verify at implementation:* EML/MSG coverage. The fallback for EML is the Python standard
     library `email` package.
   - Locators come from docling's provenance data: page + bounding box, table cell, sheet cell,
     paragraph, mail body line.
2. **Extract** via the Google Gen AI SDK against **Vertex AI** (renamed "Gemini Enterprise Agent
   Platform" on 2026-04-22), multi-region endpoint **`eu`**, model **`gemini-3.5-flash`**.
   - It is available in `eu` and `europe-west3`; the Gemini 2.5 models retire on 2026-10-20.
   - Structured output (`responseSchema`) is derived from pydantic models. For each field it
     returns `value | null`, `status` (`found | uncertain | missing`) and evidence
     `{ segmentId, quote }`.
   - *To verify at implementation:* the exact SDK configuration for the `eu` endpoint.
3. **Verify grounding (deterministic, test-first).** The quote must occur (normalised) in the cited
   segment, and the value must be consistent with the quote (numbers, units and dates normalised).
   Otherwise the status becomes **`unverified`**, which forces human attention. **The model never
   has the final say on "found"** – DR1 is enforced by code, not by prompt wording.
4. **Return** the segments, fields and run metadata (model ID, prompt version, schema version,
   tokens, latency).

**Service contract and boundaries:**
- The contract is **OpenAPI 3.1** in `contracts/ai-service.openapi.yaml`; the TS client and types
  are generated from it.
- The TS worker sends the document bytes plus opaque IDs and persists the response in *its*
  transaction.
- The AI service has **no database, no storage credentials and no tenant logic** – only model
  credentials.
- Internal authentication: a bearer token in the pilot; IAM/OIDC in production.
- Prompts are versioned files inside the service.

**Model and provider:**
- **Data use:** Google Cloud terms say no training on customer data. For production, request the
  zero-data-retention exemption.
- **Authentication:** locally, application default credentials; on a hosted showcase, Workload
  Identity Federation (Vercel OIDC or the Cloud Run service identity, depending on where the
  service runs).
- **Gemini API free tier – local development with synthetic data only.** Its terms allow human
  review and product improvement of free-tier content, and state: *"You may use only Paid Services
  when making API Clients available to users in the EEA, Switzerland, or the UK."* The showcase
  therefore uses Vertex (paid). Cost is capped by rate limits, upload limits and a GCP budget alert.
- **Avoid:** PyMuPDF / pymupdf4llm (AGPL-3.0 – a licensing problem for a closed customer product).

**Prompt injection.** Document text is data inside delimiters. The model has no tools, and its
output is constrained by the schema. The only high-impact action (the ERP export) requires human
approval (add-on `ki-rag`). The eval set contains injection cases.

**Evals** (DR8, add-on `ki-rag`):
- **Cases:** `services/ai/evals/` holds synthetic cases (mail + attachments + `expected.json`),
  starting with 15 cases weighted toward known weaknesses (tables, scans, missing values,
  injection).
- **Runner:** a pytest-driven runner executes the **production pipeline** (parse → extract →
  verify).
- **Metrics per field:**
  - accuracy of found values
  - precision/recall of "missing"
  - grounding pass rate
  - false-found rate (the hallucination indicator)
- **Gate:** a committed baseline file. The CI gate fails when a key field drops by more than *x*
  points; *x* is set with the customer. It runs on changes under `services/ai/` or with the
  `verify-full` label.

**Alternatives.**
1. *Full TypeScript pipeline* (the drafted recommendation: unpdf, SheetJS from its CDN, mammoth,
   postal-mime, AI SDK v7). One language, and about 2 days cheaper. **Not chosen by the
   orchestrator:** document quality – tables, scans, `.msg` – is the product's core from day 1,
   and a later migration to docling would re-do the parsing layer.
2. *A Python service that also consumes jobs and reads the database* – pg-boss is Node-only, so this
   needs a second queue library and a second place for tenancy and security. Rejected in favour of
   the stateless service.
3. *Native PDF input to Gemini, no own parsing* (supported, 15 MB inline) – the source is only a page
   the model claims, not verifiable against text, so it breaks DR1 enforcement. Kept as a fallback
   for pages where docling finds no text; visual evidence there is always `uncertain`.
4. *promptfoo for evals* (MIT, OpenAI-owned since 2026-03, supports Vertex) – it evaluates prompt +
   model, not our parser and verifier code path. Not used in the pilot.

**Trade-offs.**
- Two languages and toolchains: pnpm/Vitest and uv/ruff/pyright/pytest.
- A service contract that must stay in sync, mitigated by generated TS types and contract tests.
- A larger container image because of docling's models. *Size unverified.*
- CPU latency of OCR and table models. *Unverified – measure in the pilot.*
- The showcase host of the AI service is open (see D11).

**Rationale.** The strongest document handling from day 1. The security and tenancy surface stays
in one place because the service is stateless.

**Pilot cost.** About 5.25 days: service skeleton + CI chain + contract 1.5, docling parsing to
segments 1, extraction + verifier 1.5, eval runner + 15 cases 0.75, worker integration (client,
timeouts, error mapping) 0.5. *Heuristic.*
**Revisit when** docling's latency or footprint is unacceptable → a lighter parser per format
(e.g. pdfplumber, MIT), or when GPU inference becomes necessary.

---

## D9 · External integrations

**Problem.** Requests arrive from a mailbox or an upload. Approved data must reach the ERP exactly
once (DR3), and the pilot uses a simulated REST ERP.

**Decision.**

**Intake:**
- **Pilot:** web upload (`.eml`/`.msg` or loose PDF/XLSX/DOCX files) through an `IntakeSource` port.
- **After the pilot:** a mailbox adapter. For production that is most likely Microsoft Graph for an
  M365 mailbox. *Depends on the customer's mail system; open question.*

**Duplicates (DR7):**
- Exact duplicates are detected via the `Message-ID` header and the SHA-256 of the raw mail/files.
- Near-duplicate hints (same sender, similar subject) come after the pilot.
- Nothing is silently discarded; staff decide.

**ERP:**
- An `ErpExporter` port with an **OpenAPI 3.1 contract** in `contracts/erp-export.openapi.yaml`:
  `POST /v1/quote-requests` with header `Idempotency-Key: <requestId>`.
- **The ERP mock** stores idempotency keys: a repeated call returns the *same* ERP reference,
  never a duplicate. Failure injection (5xx, timeout) is configurable to demonstrate retry.
- **Exactly once** comes from three things together:
  - at-least-once jobs (D4)
  - `unique(request_id)` on the export record plus the `APPROVED → EXPORTED` transition under a row
    lock
  - an idempotent receiver
- **Timeouts** on every outbound call (AI service, ERP).
- **Pilot:** the mock is a module (`erp-mock`) inside the same app behind a flag, called over HTTP
  via a configured base URL, so switching to the real ERP is a configuration change.

**Alternatives.**
1. *File-based export (CSV/XML drop)* – often available for ERP systems that lack a REST API
  (*heuristic*). It would be a second adapter behind the same port.
2. *Writing directly into the ERP database* – rejected, because it bypasses the ERP's business
   logic.
3. *ERP mock as a separate service/container* – a more realistic boundary, but one more deployable.
   Not worth it for the pilot.

**Trade-offs.** A mock proves the contract and the idempotency, not the real ERP's semantics. The
real mapping is a post-pilot work package, together with the customer.

**Pilot cost.** About 1.25 days: upload + exact-duplicate check 0.25 (0.75 together with D5 in the
budget table), export + idempotency + mock + contract tests 1. *Heuristic.*
**Revisit when** the ERP is known (REST / file / middleware) and the mail system is known (Graph /
IMAP / Exchange on-prem).

---

## D10 · Observability

**Problem.** "Traceable operation" (DR9) and "error visible for the employee" (DR4), without
leaking personal data into logs.

**Decision.**
- **Logs:** structured JSON – `pino` in TS, JSON logging in the AI service – with correlation IDs
  (`requestId`, `jobId`, `companyId`) propagated to the AI service. **No document content or
  personal data**, only IDs.
- **Business audit:** the `audit_events` table (DR6) is written in the **same transaction** as the
  change and holds who, when, what, old and new values. The app role has only `INSERT`/`SELECT` on
  it, so append-only is enforced by the database.
- **Operator visibility:**
  - status, attempts, last error and next retry per request, shown in the request list
  - `GET /api/health` (database, storage, queue backlog, AI service reachability)
- **LLM usage per run:** model, prompt version, tokens, latency.
- **Showcase:** platform logs.
- **Production:** OpenTelemetry export to the customer's stack, or error tracking in an EU region.

**Alternatives.**
1. *A full OpenTelemetry stack now* – too heavy for the pilot.
2. *Langfuse* (LLM tracing, self-hostable) – later, if prompt debugging needs traces.

**Trade-offs.** There is no central error tracking and no separate ops page during the pilot;
errors surface in the request list, the health endpoint and the logs.

**Rationale.** It covers what the customer asked for – visible errors, history and quality – with
the data we store anyway.

**Pilot cost.** About 0.25 day (no separate ops page in the pilot). *Heuristic.*
**Revisit when** the production rollout happens (alerting and on-call are needed; add-on `betrieb`).

---

## D11 · Deployment

**Problem.** The same system must run locally in a reproducible way, as a public showcase, and
later in an unknown customer environment.

**Decision.**

| Environment | Setup |
|---|---|
| **Local** | `docker compose up` starts `postgres:17`, SeaweedFS, `web`, `worker` and `ai`. There are two images: the TS app (Next.js standalone output, two commands) and the Python AI service. `.env.example` documents every variable; secrets never go into the repo. |
| **Showcase** (after pilot acceptance) | TS app on Vercel (Hobby) + Neon (Frankfurt, via the Marketplace) + R2 (EU) + Vertex `eu`. Demo accounts are invite-only, data is synthetic only, a banner says "Demo – synthetic data only", and upload limits plus rate limits cap costs. **The AI service host is decided by a spike:** a Vercel Python Function (5 GB package limit, 300 s max on Hobby; whether docling fits is unverified) or Google Cloud Run in the EU (same GCP project as Vertex). |
| **CI** | GitHub Actions from the framework template. TS `verify` = lint + typecheck + unit and integration tests (Postgres service container) + architecture check + build + `pnpm audit`. A Python job = ruff + pyright + pytest, targeted at `services/ai/` and `contracts/`. Evals and the contract check run on relevant paths or the `verify-full` label. Docker images are built only when the Dockerfiles or the compose file change. |
| **Production path** | The same images in the customer's EU cloud or on-prem (Compose or Kubernetes); managed PostgreSQL with PITR; versioned object storage; worker and AI service as their own deployments; Entra SSO; Vertex `eu` with zero data retention. |

**Alternatives.**
1. *Showcase on Fly.io/Railway/Hetzner with the real containers* – closest to production, but it
   costs money every month and adds ops effort, and the orchestrator chose Vercel.
2. *Vercel only, no Docker* – loses the on-prem path and the offline reproducibility.

**Trade-offs.** There are three build artefacts (the Vercel build and two images); CI covers them
path-targeted. The showcase deviates from production on retries (D2); that is recorded in the
exceptions register (`docs/technical/architecture.md`).

**Rationale.** Reviewers can run everything with one command; production uses the same images.

**Pilot cost.** Local setup is part of the foundation. The showcase is about 1 day after
acceptance, including the AI-service hosting spike. *Heuristic.*
**Revisit when** the customer environment is known.

---

## Summary of the challenged decisions

| # | Question | Verdict | Decisive argument |
|---|---|---|---|
| 1 | Full TS vs. Python AI service | **Python AI service from day 1**, stateless, called by the TS worker (orchestrator decision; the draft recommended full TS) | docling handles tables, scans and `.msg` from day 1; security, tenancy and the queue stay in TS because the service holds no state |
| 2 | pg-boss vs. Redis queue | **pg-boss** | A transactional enqueue removes the dual-write risk behind DR3/DR4; no extra infrastructure |
| 3 | Better Auth vs. managed auth | **Better Auth** (pinned, minimal plugins) | Clerk and WorkOS offer no EU residency; runs offline; organisations = tenants; path to Entra SSO |
| 4 | App-level vs. RLS | **Both** – repository scoping + forced RLS | One forgotten filter must not become a leak; the cost is about 1 day |
| 5 | S3-compatible provider | **S3 API**: SeaweedFS locally, R2 EU for the showcase, the customer's choice in production | MinIO is dead; Vercel Blob is not S3 |

## Consequences

**Positive**
- DR1, DR3, DR4 and DR5 are enforced by mechanisms (verifier, transaction, idempotency, RLS), not
  by conventions.
- Every external dependency sits behind a port or contract: model, storage, ERP, intake, AI
  service.
- The local demo needs nothing but Docker plus model credentials.

**Negative / accepted**
- There are two toolchains and a service contract to maintain.
- On the showcase, retries are only picked up when something triggers `drain()`.
- We own the auth configuration and have to watch the Better Auth advisories.
- The AI service's showcase host and container footprint are unverified; a spike is due before the
  showcase.
- The pilot takes ~13 days, not 10 (confirmed by the orchestrator).

## Pilot budget check (heuristic, solo developer)

| Work package | Decision | Days |
|---|---|---|
| Foundation: repo, Docker Compose, TS CI, module skeleton | D1, D11 | 1 |
| AI service foundation: FastAPI skeleton, Python CI, OpenAPI contract, generated TS client | D8 | 1.5 |
| Database schema, migrations, database roles | D3 | 0.5 |
| Auth, companies, roles (invite form + seed, no role-admin UI) | D6 | 0.5 |
| Tenant isolation: RLS, `withTenant`, cross-tenant tests | D7 | 1 |
| Intake upload, object storage, exact-duplicate check | D5, D9 | 0.75 |
| Jobs: status machine, pg-boss, retry, dead-letter, `drain()` | D2, D4 | 1.5 |
| Parsing to segments with docling | D8 | 1 |
| Extraction + grounding verifier | D8 | 1.5 |
| Worker ↔ AI service integration (client, timeouts, error mapping) | D8 | 0.5 |
| Review UI: value beside its highlighted source, corrections, approve/reject, history | DR2, DR6 | 1.5 |
| Export + ERP mock + idempotency + contract tests | D9 | 1 |
| Eval runner + 15 synthetic cases + CI gate | D8 | 0.75 |
| Observability: logs, health, status/errors in the request list | D10 | 0.25 |
| **Pilot total (confirmed scope)** | | **≈ 13** (13.25) |
| Showcase deployment incl. AI-service hosting spike – after acceptance | D11 | 1 |

**Out of the pilot, planned afterwards:** the showcase, near-duplicate hints, the role-admin UI, a
separate ops page, the IMAP/Graph mailbox import and the real ERP mapping. Security (D6/D7), the
grounding verifier (D8) and exactly-once export (D9) are **not** cut: they are the customer's
explicit requirements.

## Exceptions register entries (recorded in `docs/technical/architecture.md`)

| Exception | Why accepted | Expires |
|---|---|---|
| Showcase: no unattended retries (Hobby cron once/day) | Showcase only; production runs a worker | when a production-like demo is needed |
| No RLS on the `auth`/`pgboss` schemas | Not tenant business data; only server code has access | on review at M3 |
| Gemini free tier for local development | Synthetic data only; never in showcase or production | when the Vertex budget is set up for development |

## Open points

**Customer input needed**
- The real mail system (M365/Graph, Exchange on-prem, IMAP) and the ERP (product, interface type,
  target fields).
- A sample set of real, anonymised requests: share of scans, languages, table-heavy PDFs.
- The permitted AI provider and region; whether a zero-data-retention exemption is required.
- Retention periods for original documents and audit data.
- Identity provider for production (Entra ID?), MFA requirement.
- Acceptance thresholds per key field for the eval gate.

**To verify during implementation**
- pg-boss maintenance API for serverless `drain()`.
- docling EML/MSG coverage and its provenance granularity for XLSX cells.
- Google Gen AI SDK configuration for the Vertex `eu` endpoint.
- R2 EU jurisdiction on the free plan.
- The AI-service showcase host (spike).

## Sources (verified 2026-09-22)

- pg-boss: github.com/timgit/pg-boss · pgboss.io/api/jobs · pgboss.io/api/adapters · pgboss.io/api/constructor
- Vercel: vercel.com/docs/cron-jobs/usage-and-pricing · vercel.com/docs/functions/limitations ·
  nextjs.org/docs/app/api-reference/functions/after · vercel.com/changelog/vercel-queues-now-in-public-beta ·
  vercel.com/docs/workflows/pricing · vercel.com/docs/vercel-blob · vercel.com/docs/oidc/gcp
- Neon: neon.com/docs/introduction/plans · neon.com/docs/introduction/regions · neon.com/docs/connect/connection-pooling
- MinIO: github.com/minio/minio · stablebuild.com/blog/minio-images-disappeared-from-docker-hub
- Storage: developers.cloudflare.com/r2/pricing · developers.cloudflare.com/r2/reference/data-location ·
  docs.hetzner.com/storage/object-storage/overview
- Better Auth: better-auth.com/docs/plugins/organization · /docs/plugins/admin · /docs/plugins/sso ·
  /docs/adapters/drizzle · /docs/concepts/rate-limit · github.com/better-auth/better-auth/security/advisories ·
  better-auth.com/blog/authjs-joins-better-auth · better-auth.com/blog/better-auth-joins-vercel
- Managed auth: clerk.com/security · clerk.com/pricing · workos.com/legal/data-processing-addendum · workos.com/pricing
- Gemini/Vertex: ai.google.dev/gemini-api/terms · docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency ·
  …/docs/learn/model-versions · …/docs/data-governance · …/multimodal/document-understanding
- AI SDK (alternative 1 in D8): ai-sdk.dev/docs/migration-guides/migration-guide-6-0 · migration-guide-7-0
- Parsing: github.com/docling-project/docling · pypi.org/project/PyMuPDF · pypi.org/project/pdfplumber ·
  npm registry (alternative 1: unpdf, mammoth, postal-mime, @kenjiuno/msgreader) · docs.sheetjs.com
- promptfoo: github.com/promptfoo/promptfoo · promptfoo.dev/docs/providers/vertex
