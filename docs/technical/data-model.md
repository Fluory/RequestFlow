# Data model – RequestFlow

> Living document: whoever adds or changes a table updates this file **in the same PR**.
> Source of truth: `src/db/schema/` + `src/db/migrations/`. Classification per the `datenschutz` add-on:
> public / internal / confidential / personal.

## Schemas

| Schema | Owner | Runtime access (`app_rw`) | Tenant isolation |
|---|---|---|---|
| `app` | `app_owner` | DML via default privileges, no CREATE | every table: `company_id` + RLS **enabled and forced**, policy `<table>_tenant_isolation` |
| `auth` | `app_owner` | DML on all tables, no CREATE | none – Better Auth data, server code only (exceptions register) |
| `drizzle` | `app_owner` | none | migration journal |

Tenant policy (all `app` tables): `company_id = nullif(current_setting('app.company_id', true), '')::uuid`
for `USING` and `WITH CHECK`. `withTenant()` sets `app.company_id` transaction-locally; without it a
query sees zero rows and every write fails.

## Tables

### `app.requests` – request aggregate (#4, extended by #5/#7)

| Column | Type | Notes | Class |
|---|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` | internal |
| `company_id` | uuid FK → `auth.organization.id` | tenant key, `ON DELETE RESTRICT` | internal |
| `status` | text | `NEW · PROCESSING · REVIEW · APPROVED · EXPORTED · REJECTED · ERROR` (check constraint) | internal |
| `created_at` | timestamptz | | internal |

Purpose: one quote request per row. Retention: open question for the customer (ADR-0001 open points).

### `auth.*` – Better Auth 1.7.5 (generated with the Better Auth CLI, timestamps with time zone)

| Table | Content | Class | Purpose |
|---|---|---|---|
| `user` | name, e-mail, global role (`user`), ban fields | personal (staff) | login identity |
| `account` | password hash (credential provider) | confidential | authentication |
| `session` | token, expiry, IP, user agent, `active_organization_id` | personal (staff) | session; carries the active company |
| `verification` | verification tokens | confidential | e-mail verification (unused in the pilot) |
| `organization` | company name, slug | internal | company = tenant |
| `member` | user ↔ company, company role `admin`/`clerk` | internal | membership + role |
| `invitation` | e-mail, company, role, status, expiry, inviter | personal (staff) | invite-only sign-up |
| `rate_limit` | key (IP + path), counter | personal (IP) | built-in rate limit, database storage |

A system user `system@requestflow.invalid` (no password account, no membership) is the inviter of each
company's first admin; it can never obtain a session.

## Relations

```text
auth.organization 1─n auth.member n─1 auth.user 1─n auth.session / auth.account
auth.organization 1─n auth.invitation
auth.organization 1─n app.requests            (company_id)
```
