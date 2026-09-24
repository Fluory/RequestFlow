CREATE TABLE "app"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"kind" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_kind_check" CHECK (kind in ('eml', 'msg', 'pdf', 'xlsx', 'docx'))
);
--> statement-breakpoint
ALTER TABLE "app"."documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "possible_duplicate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "duplicate_of_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."audit_events" ADD CONSTRAINT "audit_events_company_id_organization_id_fk" FOREIGN KEY ("company_id") REFERENCES "identity"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_company_id_organization_id_fk" FOREIGN KEY ("company_id") REFERENCES "identity"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "app"."audit_events" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "documents_company_id_idx" ON "app"."documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "documents_request_id_idx" ON "app"."documents" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "app"."requests" ADD CONSTRAINT "requests_duplicate_of_id_requests_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "app"."requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requests_company_message_id_idx" ON "app"."requests" USING btree ("company_id","message_id");--> statement-breakpoint
CREATE INDEX "requests_company_fingerprint_idx" ON "app"."requests" USING btree ("company_id","fingerprint");--> statement-breakpoint
CREATE POLICY "audit_events_tenant_isolation" ON "app"."audit_events" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "documents_tenant_isolation" ON "app"."documents" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);