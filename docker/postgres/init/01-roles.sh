#!/usr/bin/env bash
# Creates the two application roles on first start of an empty data directory (ADR-0001 D7).
# Passwords come from the environment – never from the repository or a migration.
#   app_owner – owns schema `app`, runs migrations
#   app_rw    – runtime role: no superuser, no BYPASSRLS, so row-level security always applies
set -euo pipefail
: "${APP_OWNER_PASSWORD:?APP_OWNER_PASSWORD is required}"
: "${APP_RW_PASSWORD:?APP_RW_PASSWORD is required}"

# psql quotes :'var' as a literal and :"var" as an identifier – no string building in bash.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$APP_OWNER_PASSWORD" -v rw_pw="$APP_RW_PASSWORD" -v db="$POSTGRES_DB" <<'SQL'
CREATE ROLE app_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE ROLE app_rw    LOGIN PASSWORD :'rw_pw'    NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
GRANT CONNECT ON DATABASE :"db" TO app_owner, app_rw;
GRANT CREATE ON DATABASE :"db" TO app_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
