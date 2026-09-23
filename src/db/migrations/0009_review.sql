CREATE TABLE "app"."field_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"corrected_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."field_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "app"."field_corrections" ADD CONSTRAINT "field_corrections_request_same_company_fk" FOREIGN KEY ("request_id","company_id") REFERENCES "app"."requests"("id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_corrections_request_idx" ON "app"."field_corrections" USING btree ("company_id","request_id","field_key","created_at");--> statement-breakpoint
CREATE POLICY "field_corrections_tenant_isolation" ON "app"."field_corrections" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);