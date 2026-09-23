-- Hand-written (ADR-0001 D7, D9): forced RLS; the idempotency key IS the request id (the ERP
-- recognises a retry by it); export rows are never deleted by the runtime role.
ALTER TABLE app.request_exports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.request_exports ADD CONSTRAINT request_exports_key_is_request CHECK (idempotency_key = request_id);
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON app.request_exports FROM app_rw;
