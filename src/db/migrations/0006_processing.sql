CREATE TABLE "app"."extracted_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"value" text,
	"status" text NOT NULL,
	"model_status" text,
	"reason" text,
	"document_id" uuid,
	"segment_id" text,
	"quote" text,
	CONSTRAINT "extracted_fields_run_field_unique" UNIQUE("run_id","field_key"),
	CONSTRAINT "extracted_fields_status_check" CHECK (status in ('found', 'uncertain', 'missing', 'unverified')),
	CONSTRAINT "extracted_fields_found_has_evidence" CHECK (status <> 'found' or (quote is not null and segment_id is not null))
);
--> statement-breakpoint
ALTER TABLE "app"."extracted_fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"job_id" text NOT NULL,
	"model_id" text,
	"prompt_version" text,
	"schema_version" text,
	"total_tokens" integer,
	"latency_ms" integer,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_runs_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "extraction_runs_id_company_unique" UNIQUE("id","company_id")
);
--> statement-breakpoint
ALTER TABLE "app"."extraction_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."extraction_segments" (
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"segment_id" text NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"locator" jsonb NOT NULL,
	CONSTRAINT "extraction_segments_pk" PRIMARY KEY("run_id","document_id","segment_id")
);
--> statement-breakpoint
ALTER TABLE "app"."extraction_segments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "error_stage" text;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."extracted_fields" ADD CONSTRAINT "extracted_fields_run_same_company_fk" FOREIGN KEY ("run_id","company_id") REFERENCES "app"."extraction_runs"("id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."extraction_runs" ADD CONSTRAINT "extraction_runs_company_id_organization_id_fk" FOREIGN KEY ("company_id") REFERENCES "identity"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."extraction_runs" ADD CONSTRAINT "extraction_runs_request_same_company_fk" FOREIGN KEY ("request_id","company_id") REFERENCES "app"."requests"("id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."extraction_segments" ADD CONSTRAINT "extraction_segments_run_same_company_fk" FOREIGN KEY ("run_id","company_id") REFERENCES "app"."extraction_runs"("id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extracted_fields_request_idx" ON "app"."extracted_fields" USING btree ("company_id","request_id");--> statement-breakpoint
CREATE INDEX "extraction_runs_request_idx" ON "app"."extraction_runs" USING btree ("company_id","request_id","created_at");--> statement-breakpoint
CREATE POLICY "extracted_fields_tenant_isolation" ON "app"."extracted_fields" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "extraction_runs_tenant_isolation" ON "app"."extraction_runs" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "extraction_segments_tenant_isolation" ON "app"."extraction_segments" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);