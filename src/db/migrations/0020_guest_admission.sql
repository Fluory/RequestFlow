CREATE TABLE "identity"."guest_admission" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"client_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."guest_admission" ADD CONSTRAINT "guest_admission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "identity"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_admission_created_at_idx" ON "identity"."guest_admission" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "guest_admission_client_idx" ON "identity"."guest_admission" USING btree ("client_key","created_at");