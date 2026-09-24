-- One-time role bootstrap for the Supabase showcase database (ADR-0001 D7, D11 amendment 2026-09-24).
-- Mirrors docker/postgres/init/01-roles.sh, which only runs in the local container:
--   app_owner – owns schema `app` and `pgboss`, runs migrations (`pnpm setup:deploy`)
--   app_rw    – runtime role: no superuser, no CREATEROLE/CREATEDB, NOBYPASSRLS → row-level security
--               always applies
-- Run ONCE as the Supabase `postgres` user over the session pooler (port 5432) or the direct connection,
-- never over the transaction pooler. psql prompts for both passwords without echo – they never reach the
-- command line, the process list, this file, the repository or a migration:
--
--   psql "<session-pooler URL of the postgres user>" -v ON_ERROR_STOP=1 -f scripts/supabase-bootstrap.sql
--
-- Afterwards the first migration checks the roles again and refuses to run if either could bypass RLS.
\set ON_ERROR_STOP on

-- Prompt (no echo) unless the operator already set the variables, e.g. from a secrets manager.
\if :{?owner_pw}
\else
  \prompt 'Password for app_owner: ' owner_pw
\endif
\if :{?rw_pw}
\else
  \prompt 'Password for app_rw: ' rw_pw
\endif
SELECT length(:'owner_pw') >= 16 AND length(:'rw_pw') >= 16 AS passwords_ok \gset
\if :passwords_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'both passwords must have at least 16 characters'; END $$;
\endif

SELECT current_database() AS db \gset

-- All or nothing: a failure leaves no half-created role behind.
BEGIN;

-- psql quotes :'var' as a literal and :"var" as an identifier – no string building.
CREATE ROLE app_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE ROLE app_rw    LOGIN PASSWORD :'rw_pw'    NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
GRANT CONNECT ON DATABASE :"db" TO app_owner, app_rw;
GRANT CREATE ON DATABASE :"db" TO app_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- Safety net of the export row lock (ADR-0001 D9, src/db/client.ts): set on the role, so it also holds
-- when a pooler does not pass the client's startup parameter through.
ALTER ROLE app_rw SET statement_timeout = '30s';
COMMIT;

-- Show the result without secrets: both roles must read f / f / f.
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname IN ('app_owner', 'app_rw') ORDER BY rolname;
