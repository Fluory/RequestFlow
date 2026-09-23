-- Hand-written (ADR-0001 D7, D10).
-- 1) Forced RLS on the new company-owned tables (drizzle-kit emits only ENABLE).
ALTER TABLE app.documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- 2) Append-only audit: the runtime role may insert and read, never change or delete.
REVOKE UPDATE, DELETE, TRUNCATE ON app.audit_events FROM app_rw;
--> statement-breakpoint
-- 3) Same-company references. Foreign-key checks bypass RLS, so a plain FK would let a tenant attach
--    its row to another company's request if it knew the id. Composite FKs pin company_id.
ALTER TABLE app.requests ADD CONSTRAINT requests_id_company_unique UNIQUE (id, company_id);
--> statement-breakpoint
ALTER TABLE app.documents ADD CONSTRAINT documents_request_same_company_fk
  FOREIGN KEY (request_id, company_id) REFERENCES app.requests (id, company_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE app.requests ADD CONSTRAINT requests_duplicate_same_company_fk
  FOREIGN KEY (duplicate_of_id, company_id) REFERENCES app.requests (id, company_id);
