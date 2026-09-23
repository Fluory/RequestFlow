-- Hand-written (ADR-0001 D7, D10).
-- 1) Forced RLS on the new company-owned tables (drizzle-kit emits only ENABLE).
ALTER TABLE app.documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- 2) Append-only audit: the runtime role may insert and read, never change or delete.
REVOKE UPDATE, DELETE, TRUNCATE ON app.audit_events FROM app_rw;
