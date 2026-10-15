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
own whitelist (`status`, `latencyMs`, `errorCode`, token counts, …), plus `excType` (exception class only,
never its message) and `logger` for records of a library (docling, httpx, uvicorn). Compact JSON like pino. Example:
`{"level":"info","time":"2026-09-24T10:00:00.123Z","event":"request_completed","requestId":"req-0001","status":200}`

- Both key sets are fixed in code; a test runs a full synthetic request (upload → export) and fails if a
  log line contains document content or personal data.
- Correlation: the request id. The worker sends it to the AI service as `X-Request-Id`. Follow one request
  with `docker compose logs web worker ai | grep <requestId>`.
- `/api/health` also reports `dependencies.aiService` and `backlog` (waiting jobs per queue). Both are
  informational and never turn the status into 503 – the AI service is an optional compose profile.
  `aiService` is `ok` (answered), `failed` (answered with an error, refused the connection, or no answer for
  more than 30 s) or `starting` (no answer within the probe's 2 s – on the showcase usually the cold start of
  the scaled-to-zero container, which the probe itself triggers; once it has started, the next call reads `ok`.
  A failed or timed-out probe is not cached, #81/#88).

## Deploy step

`setup` (compose) / `pnpm setup:deploy` applies the migrations as `app_owner` and creates the private
bucket. It is explicit and idempotent; `web` and `worker` start only after it succeeded. The first
migration aborts if `app_owner`/`app_rw` are missing or could bypass RLS – fix the roles
(`docker/postgres/init/01-roles.sh` runs only on an empty data directory), never the check.

## Database roles outside Docker

`docker/postgres/init/01-roles.sh` runs only in the local container. On any other PostgreSQL (showcase,
customer) an operator creates `app_owner` and `app_rw` once with the same statements (passwords from
the secret manager), before the first `setup` run; the first migration refuses to run otherwise. For
Supabase use `scripts/supabase-bootstrap.sql`; the whole showcase setup (Vercel + Supabase, jobs without
a worker, switch-off and rollback) is in [deployment-vercel.md](deployment-vercel.md).

## Login rate limit and client IP

Better Auth limits `/api/auth/*` per client IP (5 sign-ins/sign-ups per minute, counters in
`identity.rate_limit`). The IP comes from `AUTH_IP_HEADERS`; that header is only trustworthy when a
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

## Uptime monitor (showcase)

| Item | Value |
|---|---|
| Monitor | GitHub Actions workflow `.github/workflows/uptime.yml` – calls `GET <SHOWCASE_URL>/api/health` from outside the deployment |
| Target | repository variable `SHOWCASE_URL`, default `https://requestflow-doc-edit.vercel.app` |
| Interval | every 15 minutes (cron; GitHub may delay scheduled runs by a few minutes), plus manual start (`workflow_dispatch`) |
| Check | 20 s timeout, 2 retries; red run on timeout, non-200, non-JSON or `status != "ok"` |
| Alert recipient | role Orchestrator – GitHub's failed-workflow notification to the repository owner (check the notification settings: Actions → "Send notifications for failed workflows only"); no address is stored in the repo |
| Key figures | job summary of every run: `database`, `storage`, `aiService`, waiting jobs `request-process` / `request-export` |

- `aiService: starting` is the cold start of the scaled-to-zero AI container: shown, never an alert.
  `failed` is shown too but does not turn the run red (informational, see "Logs and correlation").
- On an alert: open the failed run, read the HTTP status and the summary table, then follow
  [Frequent failures](#frequent-failures) (`storage`, `config`); HTTP `000`/5xx without a body means the
  Vercel deployment itself is down – check the latest deployment, then [Rollback](#rollback).
- Test of the alert: start the workflow with a wrong `SHOWCASE_URL` variable (or pause the target) once and
  confirm the notification; reset the variable afterwards.
- Out of scope: error-rate alerts from log aggregation, monitoring of a customer environment.

## Incident

An incident is an unplanned event that endangers data, availability or correctness: a leaked secret,
data of one company visible to another, exports to the wrong place, a showcase that is down or
answering errors. Routine failures with a known cure stay in "Frequent failures" below.

**Steps, in this order** (whoever notices it starts; the orchestrator decides and closes):

1. **Validate.** Reproduce or confirm from logs (`requestId` correlation, "Logs and correlation"). Note
   the time it started, when it was noticed and what was observed – facts only.
2. **Assess the damage.** Which companies, requests, accounts, secrets; since when; still ongoing?
   Then answer the fixed question below.
3. **Contain** with the smallest switch that stops the damage (table below) – before searching for the
   cause.
4. **Open an issue** (label `security` if data or a secret is involved) with the facts from 1–3, without
   secrets, document content or personal data; for a security finding in a public repo, use a private
   GitHub security advisory instead.
5. **Fix** on its own branch (`claude/fix-…`) through the normal PR route – with a **regression test**
   that fails without the fix. **No auto-merge and no direct push to `main` during an incident**; a human
   merges.
6. **Lift the containment** only after the fix is deployed and checked (health, the reproduction from
   step 1).
7. **Postmortem** only for a relevant incident (personal data affected, data of another company visible,
   double export, or more than 4 h unavailable): in the issue – timeline, cause, what stopped it, what
   prevents it next time; no blame.

**Fixed question: are personal data affected?** (GDPR Art. 33) Personal data here are user accounts
(name, e-mail – also on the showcase), and on a customer system the contents of requests and
attachments (names, phone numbers, e-mail addresses of the customer's contacts). If the answer is
"yes" or "not sure":

- The clock starts when the breach becomes known: the controller notifies the competent supervisory
  authority **within 72 hours** unless the breach is unlikely to result in a risk to the persons
  (Art. 33 (1)); record the reasoning either way (Art. 33 (5)), in the issue.
- On a customer system the **customer is the controller** and RequestFlow's operator the processor:
  inform the customer's contact **without undue delay** (Art. 33 (2)) so their 72 hours can be met;
  the DPA names the route.
- Supervisory authority and contact route: **to be named by the orchestrator / customer** – for the
  reference project the showcase holds no customer data; the orchestrator, as controller for the
  showcase accounts, notifies the authority responsible for their place of business. *(Placeholder –
  fill in name, web form/address and the internal contact before the first customer system.)*
- If there is a high risk to the persons, they are informed too (Art. 34) – the controller decides.

**Switches of this system** (showcase on Vercel + Supabase; local Docker in brackets):

| Situation | Switch | Effect |
|---|---|---|
| AI token leaked or misused | Rotate `AI_SERVICE_TOKEN` in **both** Vercel projects (`requestflow-ai` and `requestflow`), redeploy both – AI project **Ready**, not skipped (`deployment-vercel.md` §3 step 6) | old token gets 401 at the AI service. A 401 is not retried: a request processed while the two projects disagree goes to `ERROR` at once – reprocess it („Erneut verarbeiten“) after both carry the new token |
| Stop all background processing | Remove `CRON_SECRET` and set `JOB_DRAIN_INLINE=false`, redeploy (`docker compose stop worker`) | drain route → 404, no jobs run; uploads stay `Neu`, approvals wait – nothing is lost (pg-boss keeps the jobs) |
| Stop calls to the model | Pause the Vercel project `requestflow-ai` (`docker compose stop ai`); provider key: delete it at the provider | no document leaves the system; requests retry (unreachable / 503) and end in `ERROR` once the attempts are used up – „nothing lost“ means: reprocess them after the pause |
| A user account is misused | `/users` → "Deaktivieren" (an admin of the same company) | all sessions of the account end at once; reactivation is possible. Refused for one's own account and for the company's last active admin – then use "Data at risk" below |
| A bad deployment | Vercel "Instant Rollback" to the previous deployment (only to a version that knows the current schema – migrations are forward-only, see "Rollback") | previous code serves within seconds |
| Data at risk, cause unclear | Pause the Supabase project | the whole showcase is down (health `database: failed`); data stays as it is |
| ERP exports go wrong | "Stop all background processing" (above); do not remove `ERP_BASE_URL` – it falls back to the local mock address | approved requests wait in `Freigegeben`; when draining resumes, each is exported once (idempotency key + unique export row, ADR-0001 D9) |

**Tabletop (2026-10-15, synthetic incident "AI token leaked in a public issue comment"):** 1. validated
– the comment shows a ≥ 24-character value starting like the token in the Vercel settings; 2. damage
– the token lets a caller send documents to `/v1/extract` and spend model quota, it gives no access to
the database or storage (the AI service holds neither, ADR-0001 D8), so no stored data are exposed;
personal data: none affected through this token → no notification, reasoning recorded; 3. contain –
rotate `AI_SERVICE_TOKEN` in both projects, redeploy, check `requestflow-ai` **Ready**, then one synthetic upload reaches *Zur Prüfung*
(`/api/health` `aiService: ok` does not prove it – the probe calls the open `/healthz` without a token);
reprocess any request that went to `ERROR` in between; delete the comment; 4. issue with time and the rotated variable's name; 5. fix – none in
code; follow-up: secret scanning on comments; 7. no postmortem (not a relevant incident). Gaps found: the
AI token row first claimed retries (corrected: a 401 is not retried) and the health check does not prove
the rotation (replaced by a synthetic upload); the authority placeholder above must be filled before a customer system.

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
