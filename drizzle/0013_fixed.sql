ALTER TABLE "audit_log" ALTER COLUMN "details" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "location_id" text;
