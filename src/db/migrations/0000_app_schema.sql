-- First migration (ADR-0001 D3/D7). Runs as `app_owner`.
-- The roles themselves are created by docker/postgres/init/01-roles.sh (passwords from env, never
-- in the repository). This migration refuses to run unless both roles exist with the required
-- properties, so a misconfigured database fails loudly instead of silently bypassing RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner' AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'role app_owner missing or allowed to bypass RLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole) THEN
    RAISE EXCEPTION 'role app_rw missing, superuser, able to create roles or allowed to bypass RLS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
     WHERE m.member = 'app_rw'::regrole AND (r.rolsuper OR r.rolbypassrls OR r.rolname = 'app_owner')
  ) THEN
    RAISE EXCEPTION 'app_rw must not inherit app_owner, superuser or BYPASSRLS';
  END IF;
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION 'migrations must run as app_owner, not %', current_user;
  END IF;
END
$$;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_owner;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
-- app_rw may use the schema but never create objects in it (only migrations change the schema).
GRANT USAGE ON SCHEMA app TO app_rw;
--> statement-breakpoint
-- Every table/sequence app_owner creates later is usable by app_rw; row access stays under RLS.
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO app_rw;
