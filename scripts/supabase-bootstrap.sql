-- One-time role bootstrap for the Supabase showcase database (ADR-0001 D7, D11 amendment 2026-09-24).
-- Mirrors docker/postgres/init/01-roles.sh, which only runs in the local container:
--   app_owner – owns schema `app` and `pgboss`, runs migrations (`pnpm setup:deploy`)
--   app_rw    – runtime role: no superuser, no CREATEROLE/CREATEDB, NOBYPASSRLS → row-level security
--               always applies
-- Run ONCE as the Supabase `postgres` user over the session pooler (port 5432) or the direct connection,
-- never over the transaction pooler. Passwords are supplied by the operator as psql variables – they are
-- never written into this file, the repository or a migration:
--
--   read -rs APP_OWNER_PASSWORD; read -rs APP_RW_PASSWORD
--   psql "<session-pooler URL of the postgres user>" -v ON_ERROR_STOP=1 \
--     -v owner_pw="$APP_OWNER_PASSWORD" -v rw_pw="$APP_RW_PASSWORD" -f scripts/supabase-bootstrap.sql
--
-- Afterwards the first migration checks the roles again and refuses to run if either could bypass RLS.
\set ON_ERROR_STOP on

-- Fail (exit code 3) before anything is created when a password variable is missing.
\if :{?owner_pw}
\else
  DO $$ BEGIN RAISE EXCEPTION 'psql variable owner_pw is required (-v owner_pw=...)'; END $$;
\endif
\if :{?rw_pw}
\else
  DO $$ BEGIN RAISE EXCEPTION 'psql variable rw_pw is required (-v rw_pw=...)'; END $$;
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
COMMIT;

-- Show the result without secrets: both roles must read f / f / f.
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname IN ('app_owner', 'app_rw') ORDER BY rolname;
