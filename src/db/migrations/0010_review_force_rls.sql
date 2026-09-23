-- Hand-written (ADR-0001 D7, D10): forced RLS; corrections are append-only for the runtime role.
ALTER TABLE app.field_corrections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.field_corrections FROM app_rw;
