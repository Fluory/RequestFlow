# Data model – RequestFlow

> Living document: whoever adds or changes a table updates this file **in the same PR**.
> Source of truth: `src/db/schema/` + `src/db/migrations/`. Classification per the `datenschutz` add-on:
> public / internal / confidential / personal.

## Schemas

| Schema | Owner | Runtime access (`app_rw`) | Tenant isolation |
|---|---|---|---|
| `app` | `app_owner` | DML via default privileges, no CREATE | every table: `company_id` + RLS **enabled and forced**, policy `<table>_tenant_isolation` |
| `auth` | `app_owner` | DML on all tables, no CREATE | none – Better Auth data, server code only (exceptions register) |
| `pgboss` | `app_owner` (deploy step installs schema + queues) | DML only | none – job queue, IDs only (exceptions register) |
| `drizzle` | `app_owner` | none | migration journal |

Tenant policy (all `app` tables): `company_id = nullif(current_setting('app.company_id', true), '')::uuid`
for `USING` and `WITH CHECK`. `withTenant()` sets `app.company_id` transaction-locally; without it a
query sees zero rows and every write fails.

## Tables

### `app.requests` – request aggregate (#4, extended by #5/#7/#8)

| Column | Type | Notes | Class |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | internal |
| `company_id` | uuid FK → `auth.organization.id` | tenant key, `ON DELETE RESTRICT` | internal |
| `status` | text | `NEW · PROCESSING · REVIEW · APPROVED · EXPORTED · REJECTED · ERROR` (check constraint) | internal |
| `created_at` | timestamptz | | internal |
| `source` | text | `upload` (mailbox later) | internal |
| `created_by` | uuid | uploading user | personal (staff) |
| `subject` | text | mail subject or first file name, max 300 chars | confidential |
| `message_id` | text | `Message-ID` of an uploaded mail – duplicate key | personal |
| `fingerprint` | text | SHA-256 over the sorted file hashes – duplicate key | internal |
| `possible_duplicate` / `duplicate_of_id` | boolean / uuid | exact duplicate within the company; composite FK `(duplicate_of_id, company_id)` | internal |
| `error_stage`, `error_message` | text | `processing`/`export`; readable cause for staff – no stack traces, hosts or document content | internal |
| `attempts`, `next_retry_at` | int, timestamptz | processing attempts; next retry while pg-boss retries | internal |
| `rejection_reason` | text | free-text reason of a rejection, max 1000 chars (refused above, not cut – review module); also in the `request.rejected` audit event | confidential |

Unique `(id, company_id)` so child tables can pin the company with composite foreign keys (FK checks
bypass RLS). Purpose: one quote request per row. Retention: open question for the customer (ADR-0001 open points).

### `app.extraction_runs`, `app.extraction_segments`, `app.extracted_fields` – processing results (#7)

| Table | Content | Class | Notes |
|---|---|---|---|
| `extraction_runs` | one row per processing job: model, prompt + schema version, tokens, latency, per-document metadata (or why a document was skipped) | internal | unique `job_id` → a redelivered job is a no-op |
| `extraction_segments` | segment text + locator (page/bbox, mail line) per document | confidential + personal | source view of the review UI |
| `extracted_fields` | one merged value per header field (`item_index` null) and one row per line-item field (`item_index` = position in the run, #22): value, status (`found` only with a verified quote – check constraint), model status, reason, document, segment, quote; unique `(run_id, field_key, item_index)` NULLS NOT DISTINCT | confidential + personal | original extraction – never overwritten; corrections live in `field_corrections` |

All three: `company_id`, forced RLS, composite FKs to the run and request of the same company;
`extracted_fields` evidence `(run_id, document_id, segment_id)` must reference a stored segment.

### `app.field_corrections` – manual corrections from the review (#8)

| Column | Type | Notes | Class |
|---|---|---|---|
| `id`, `company_id`, `request_id` | uuid | composite FK `(request_id, company_id)` → `requests` | internal |
| `field_key` | text | `company` · `contact_person` · `requested_delivery_date` | internal |
| `old_value`, `new_value` | text | value before / after; the newest row is the current value | confidential + personal |
| `corrected_by`, `created_at` | uuid, timestamptz | who and when; no FK to `auth.user` (like `audit_events.actor_user_id`) – the history must survive a user's removal | personal (staff) |

Append-only: forced RLS, `app_rw` has INSERT/SELECT only (UPDATE/DELETE/TRUNCATE revoked) – the
history is the correction audit. The page shows a corrected value as `korrigiert`, never as `found`
(its proof is this history, not a quote). Purpose: traceable corrections before export. Retention: with the
request. Corrected values and rejection reasons are also copied into the append-only `audit_events` – they
cannot be deleted per request there; this joins the open retention question (ADR-0001 open points).

### `app.request_exports` – one export record per request (#9)

| Column | Type | Notes | Class |
|---|---|---|---|
| `id`, `company_id`, `request_id` | uuid | `unique(request_id)`; composite FK `(request_id, company_id)` → `requests` | internal |
| `idempotency_key` | uuid | always = `request_id` (check constraint); sent as `Idempotency-Key` | internal |
| `status` | text | `pending` · `succeeded` (check: succeeded ⇒ reference + time) | internal |
| `erp_reference`, `exported_at` | text, timestamptz | the ERP's reference and when | internal |
| `attempts`, `last_error` | int, text | ERP calls so far; readable cause of the last failure (no hosts, no payload) | internal |

Forced RLS; `app_rw` may not DELETE/TRUNCATE. The payload itself is not stored – it is rebuilt from the
reviewed values (frozen after approval). Purpose: exactly-once export and its proof. Retention: with the request.

### `app.documents` – originals of a request (#5)

| Column | Type | Notes | Class |
|---|---|---|---|
| `id`, `company_id`, `request_id` | uuid | composite FK `(request_id, company_id)` → `requests` | internal |
| `filename`, `content_type`, `kind` | text | kind `eml · msg · pdf · xlsx · docx` | confidential |
| `size_bytes`, `sha256` | bigint, text | SHA-256 of the raw bytes (integrity, duplicates) | internal |
| `storage_key` | text | `{companyId}/{requestId}/{documentId}` in the private bucket | internal |

The bytes (confidential + personal) live only in object storage; served via `GET /api/documents/:id`.

### `app.audit_events` – append-only business audit (#5, ADR-0001 D10)

| Column | Type | Notes | Class |
|---|---|---|---|
| `company_id`, `entity_type`, `entity_id` | | what changed | internal |
| `actor_user_id` | uuid | who | personal (staff) |
| `action`, `data` | text, jsonb | e.g. `request.uploaded`; old/new values later – no document content | internal/confidential |

`app_rw` has INSERT and SELECT only (UPDATE/DELETE/TRUNCATE revoked). Written in the same transaction
as the change.

### `auth.*` – Better Auth 1.7.5 (generated with the Better Auth CLI, timestamps with time zone)

| Table | Content | Class | Purpose |
|---|---|---|---|
| `user` | name, e-mail, global role (`user`), ban fields – `banned` = deactivated by a company admin (#30; blocks sign-in) | personal (staff) | login identity |
| `account` | password hash (credential provider) | confidential | authentication |
| `session` | token, expiry, IP, user agent, `active_organization_id` | personal (staff) | session; carries the active company |
| `verification` | verification tokens | confidential | e-mail verification (unused in the pilot) |
| `organization` | company name, slug | internal | company = tenant |
| `member` | user ↔ company, company role `admin`/`clerk`; unique `user_id` (one company per user) | internal | membership + role |
| `invitation` | e-mail, company, role, status, expiry, inviter; the random `id` is the sign-up token (link) | personal (staff) | invite-only sign-up |
| `rate_limit` | key (IP + path), counter | personal (IP) | built-in rate limit, database storage |

A system user `system@requestflow.invalid` (no password account, no membership) is the inviter of each
company's first admin; it can never obtain a session.

## Relations

```text
auth.organization 1─n auth.member n─1 auth.user 1─n auth.session / auth.account
auth.organization 1─n auth.invitation
auth.organization 1─n app.requests            (company_id)
app.requests      1─n app.documents           (request_id, company_id)
app.requests      0─1 app.requests            (duplicate_of_id, company_id)
app.requests      1─n app.extraction_runs     (request_id, company_id) 1─n segments / fields
app.requests      1─n app.field_corrections   (request_id, company_id)
app.requests      1─1 app.request_exports     (request_id, company_id)
app.*             1─n app.audit_events        (entity_type, entity_id – no FK, append-only)
```
