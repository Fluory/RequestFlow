# Operations – RequestFlow

> Runbook for the local reference runtime (ADR-0001 D11). Production operations follow with M4.

## Start and stop

| Action | Command |
|---|---|
| Start everything | `docker compose up --build` |
| Start only the backing services | `docker compose up -d postgres storage`, then `pnpm setup:deploy` |
| Stop (keep data) | `docker compose down` |
| Reset local data | `docker compose down -v` (deletes the database and bucket volumes – synthetic data only) |
| Health | `curl localhost:3000/api/health` – 503 names the failing check (`database`, `storage`, `config`) |

## Worker and AI service

- `worker` drains the `request-process` queue in a loop (30 s budget, 2 s idle poll) and supervises
  pg-boss (expiry → retry, retention). Retries: 5 with exponential backoff (30 s … 30 min); then the
  dead-letter queue moves the request to `ERROR` with a readable cause. Staff see status, attempts, the
  last cause with its stage (processing/export) and the next retry on `/requests` (filter: status,
  possible duplicate) and reprocess an `ERROR` request there – status change, new job and audit event
  in one transaction.
- The AI service runs only with the compose profile `ai` (`docker compose --profile ai up`) and needs
  Vertex AI credentials (`VERTEX_PROJECT`, ADC file via `GOOGLE_ADC_FILE`). Without it, requests stay
  in retries and end in `ERROR` ("Der KI-Dienst ist nicht erreichbar.") – by design, nothing is lost.
- The worker refuses to start without `AI_SERVICE_TOKEN`, and when `AI_SERVICE_TIMEOUT_MS ×
  UPLOAD_MAX_FILES` could outlive the job expiry (1 h) – otherwise pg-boss would redeliver a job that
  is still running (fail-closed).
- A worker that dies mid-job leaves the job active; after the expiry pg-boss maintenance
  (`supervise`, run by the worker as `app_rw`) puts it back into retry and the next attempt finishes it
  (integration test). Known gap: a request whose job vanished completely (e.g. deleted by hand) stays
  in `NEW`/`PROCESSING` – a cross-company sweep needs a privileged path and follows with #26/#28.

## Evals

- CI runs the AI eval gate in replay mode on every PR that changes `services/ai/` or `contracts/`
  (step "AI eval gate (replay)"): `cd services/ai && uv run python -m requestflow_ai.evals --replay`.
  No credentials, deterministic. It fails when a key field drops more than `EVAL_GATE_THRESHOLD`
  points (default 5) against `services/ai/evals/baseline.json`, or on an injection violation.
- After a prompt or model change, record real responses locally with `--live` (Vertex credentials,
  never in CI), review the diff of `evals/cases/*/model_response.json`, then `--update-baseline` in
  the same PR. Details: [`services/ai/README.md`](../../services/ai/README.md#evals).

## Document formats and OCR (AI service)

- The worker sends PDF, e-mail (`.eml`), Outlook `.msg`, `.xlsx` and `.docx` to the AI service. A
  broken attachment inside a `.msg` does not fail the message: it is listed with its error, the rest is
  processed.
- Scanned PDFs: OCR runs only with `AI_PDF_OCR=auto` on the AI service (default `off`) and only for
  pages without a text layer; OCR evidence is at most `uncertain` and labelled in the review. Measured
  on 4 vCPU (CPU only): about 8–9 s per scanned page, 3.5 s model load when warm; first start with
  download 35 s. Models: docling layout (164 MB, Hugging Face) and OCR models (~31 MB, fetched from
  `modelscope.cn`) – for offline or restricted networks prefetch them into the image
  (`PREFETCH_OCR_MODELS`, decision-needed in #23). Max. 10 OCR pages per document (~90 s), which stays
  below the worker's per-document timeout (`AI_SERVICE_TIMEOUT_MS`, default 120 s).
- Limits against hostile documents: OOXML ≤ 2,000 entries / 64 MiB unpacked / no entry > 1 MiB packed
  more than 100:1; XML without entity expansion; macros never read; `.msg` nesting ≤ 3, ≤ 50
  attachments.

## ERP export

- The worker also drains `request-export` (approved requests). It posts to `ERP_BASE_URL` with
  `Idempotency-Key: <requestId>` and `ERP_TIMEOUT_MS` (max 20 s – below the database statement
  timeout, since the request's row lock is held during the call); HTTP 408, 429, 500, 502, 503, 504,
  timeouts, an unreachable ERP and a body that breaks off while reading are retried (8 × 30 s … 30 min, backoff), other 4xx and a contract-breaking answer are permanent.
  The request stays `APPROVED` while retrying – the page shows attempts and the last cause – and ends in
  `ERROR` (stage `export`) when retries run out. Reprocess puts it back to `APPROVED` with a new job;
  the same key makes the ERP answer with the existing reference instead of a second record.
- Exactly once = row lock on the request (held across the time-bounded ERP call) + `unique(request_id)`
  on `request_exports` + the idempotent receiver. Keep all three (ADR-0001 D9).
- The worker refuses to start without `ERP_TOKEN`; the committed local token is refused outside
  `APP_ENV=local`. In compose the worker calls the mock inside `web` (`http://web:3000/api/erp-mock`).
- Demo of retries: `ERP_MOCK_FAULTS=503,lost` on `web` (consumed in order after each start; checked at start).
- Approval is refused while a reviewed value exceeds the ERP limits (500 chars per field) – the clerk
  corrects it first; after approval values are frozen.
- The mock keeps its keys in memory: if `web` restarts between a stored-but-unanswered call ("lost") and
  the retry, the mock creates a second record. Our side (unique export row, `EXPORTED`) is unaffected;
  a real ERP must keep its keys durably (decision-needed in #9).

## Logs and correlation

### Shared log format (web, worker, AI service)

All three write one JSON line per event to stdout with the same keys: `level` (lower-case pino label:
`debug`, `info`, `warn`, `error`, `fatal`), `time` (UTC ISO 8601 with milliseconds, `Z`), `event` (a
constant name, never free text) plus allow-listed IDs and codes only. Correlation keys: `requestId`
everywhere, `documentId`; `jobId`, `companyId` and `attempt` only in web/worker lines (the AI service
receives just `X-Request-Id`). Web/worker (pino, `src/features/observability/log.ts`) add `code`,
`status`, `durationMs`, `count`; the AI service (`services/ai/src/requestflow_ai/jsonlog.py`) keeps its
own whitelist (`status`, `latencyMs`, `errorCode`, token counts, …). Example:
`{"level":"info","time":"2026-09-24T10:00:00.123Z","event":"request_completed","requestId":"req-0001","status":200}`

- Both key sets are fixed in code; a test runs a full synthetic request (upload → export) and fails if a
  log line contains document content or personal data.
- Correlation: the request id. The worker sends it to the AI service as `X-Request-Id`. Follow one request
  with `docker compose logs web worker ai | grep <requestId>`.
- `/api/health` also reports `dependencies.aiService` (reachable or not) and `backlog` (waiting jobs per
  queue). Both are informational and never turn the status into 503 – the AI service is an optional
  compose profile.

## Deploy step

`setup` (compose) / `pnpm setup:deploy` applies the migrations as `app_owner` and creates the private
bucket. It is explicit and idempotent; `web` and `worker` start only after it succeeded. The first
migration aborts if `app_owner`/`app_rw` are missing or could bypass RLS – fix the roles
(`docker/postgres/init/01-roles.sh` runs only on an empty data directory), never the check.

## Database roles outside Docker

`docker/postgres/init/01-roles.sh` runs only in the local container. On any other PostgreSQL (showcase,
customer) an operator creates `app_owner` and `app_rw` once with the same statements (passwords from
the secret manager), before the first `setup` run; the first migration refuses to run otherwise.

## Login rate limit and client IP

Better Auth limits `/api/auth/*` per client IP (5 sign-ins/sign-ups per minute, counters in
`auth.rate_limit`). The IP comes from `AUTH_IP_HEADERS`; that header is only trustworthy when a
reverse proxy sets it and clients cannot reach the web container directly. Any deployment beyond the
local machine puts a proxy in front and lists it in `AUTH_TRUSTED_PROXIES`. A per-account limit is a
follow-up (not in the pilot).

## Invitations and account recovery

Invite-only: an admin creates an invitation on `/invite` and hands over the link
(`/signup?invitation=<id>`, 7 days valid); e-mail delivery is not part of the pilot. There is no
self-service password reset yet – recovery is an operator task (delete the user row, invite again).

User management (#30): admins see their company's users on `/users`, change roles (`admin`/`clerk`),
deactivate (sign-in blocked, all sessions ended at once) and reactivate. Every change – including an
invitation – is an audit event (`user.invited` on the invitation, `user.role_changed`, `user.deactivated`,
`user.reactivated`). The last active admin of a company can be neither demoted nor deactivated; if a
company still ends up without one, an operator re-invites an admin with `bootstrapCompany`-style SQL
(no cross-company UI). Admins cannot deactivate themselves. Better Auth's `/api/auth/organization/*`
endpoints are disabled except `set-active` (404) – every change goes through the audited module. The
`user.invited` audit event stores the role only; the invitation id points to the e-mail.

## Frequent failures

| Symptom | Cause | Action |
|---|---|---|
| `setup` exits with `role app_rw missing …` | data volume created before the init script existed | `docker compose down -v` (local only) |
| health `storage: failed` | SeaweedFS still starting or wrong S3 credentials | wait a few seconds; compare `S3_*` with `.env.example` |
| health `config: failed` | a required variable is missing | the web log names the variable (never its value) |
| request stays `Freigegeben`, page shows "Export wird wiederholt" | ERP unreachable / 5xx / timeout | check `ERP_BASE_URL`, `ERP_TOKEN` on worker and web, `ERP_MOCK_ENABLED` on web; retries continue on their own |
| request in `ERROR` with "ERP hat den Export abgelehnt (HTTP 409)" | the mock knows the key with a different body (e.g. data changed by hand) | resolve the conflict on the ERP side first (the key is fixed, a reprocess sends the same body and gets 409 again); with the real ERP: clarify with the ERP owner |

## Rollback

- Code and CI changes: revert PR on `main`.
- Migrations: forward-only; a destructive change needs its own rollback plan in its PR
  (`.claude/rules/database-migrations.md`). The first migration is additive (schema + grants) and can
  be undone locally with `docker compose down -v`.
