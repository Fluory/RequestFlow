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
  dead-letter queue moves the request to `ERROR` with a readable cause. Staff reprocess from there.
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
