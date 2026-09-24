CREATE TABLE "app"."request_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"erp_reference" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exported_at" timestamp with time zone,
	CONSTRAINT "request_exports_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "request_exports_status_check" CHECK (status in ('pending', 'succeeded')),
	CONSTRAINT "request_exports_succeeded_has_reference" CHECK (status <> 'succeeded' or (erp_reference is not null and exported_at is not null))
);
--> statement-breakpoint
ALTER TABLE "app"."request_exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."request_exports" ADD CONSTRAINT "request_exports_company_id_organization_id_fk" FOREIGN KEY ("company_id") REFERENCES "identity"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_exports" ADD CONSTRAINT "request_exports_request_same_company_fk" FOREIGN KEY ("request_id","company_id") REFERENCES "app"."requests"("id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "request_exports_tenant_isolation" ON "app"."request_exports" AS PERMISSIVE FOR ALL TO public USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid) WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid);