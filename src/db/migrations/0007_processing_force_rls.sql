-- Hand-written (ADR-0001 D7): forced RLS on the extraction tables (drizzle-kit emits only ENABLE).
ALTER TABLE app.extraction_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.extraction_segments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.extracted_fields FORCE ROW LEVEL SECURITY;
