-- Hand-written (ADR-0001 D7).
-- 1) The runtime role may use the Better Auth tables (schema `auth`, no RLS – exceptions register),
--    but never create objects there.
GRANT USAGE ON SCHEMA auth TO app_rw;
--> statement-breakpoint
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
--> statement-breakpoint
-- 2) Forced RLS: drizzle-kit emits only ENABLE. FORCE makes the policy apply to the table owner too,
--    so no role except a superuser ever reads company data without `app.company_id`.
ALTER TABLE app.requests FORCE ROW LEVEL SECURITY;
