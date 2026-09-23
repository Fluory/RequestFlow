ALTER TABLE "app"."extracted_fields" DROP CONSTRAINT "extracted_fields_run_field_unique";--> statement-breakpoint
ALTER TABLE "app"."extracted_fields" ADD COLUMN "item_index" integer;--> statement-breakpoint
ALTER TABLE "app"."extracted_fields" ADD CONSTRAINT "extracted_fields_run_field_item_unique" UNIQUE NULLS NOT DISTINCT("run_id","field_key","item_index");--> statement-breakpoint
ALTER TABLE "app"."extracted_fields" ADD CONSTRAINT "extracted_fields_item_index_check" CHECK (item_index is null or item_index >= 0);