-- Hand-written (ADR-0001 D7).
-- 1) The runtime role may use the Better Auth tables (schema `identity` – named `auth` until #60 –, no RLS – exceptions register),
--    but never create objects there.
GRANT USAGE ON SCHEMA identity TO app_rw;
--> statement-breakpoint
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA identity GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
--> statement-breakpoint
-- 2) Forced RLS: drizzle-kit emits only ENABLE. FORCE makes the policy apply to the table owner too,
--    so no role except a superuser ever reads company data without `app.company_id`.
ALTER TABLE app.requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- 3) One company per user in the pilot: the session hook and getActor resolve THE membership.
CREATE UNIQUE INDEX member_one_company_per_user ON identity.member (user_id);
