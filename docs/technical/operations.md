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

## Rollback

- Code and CI changes: revert PR on `main`.
- Migrations: forward-only; a destructive change needs its own rollback plan in its PR
  (`.claude/rules/database-migrations.md`). The first migration is additive (schema + grants) and can
  be undone locally with `docker compose down -v`.
