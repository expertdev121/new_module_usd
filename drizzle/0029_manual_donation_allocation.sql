CREATE TABLE IF NOT EXISTS "manual_donation_allocation" (
	"id" serial PRIMARY KEY NOT NULL,
	"manual_donation_id" integer NOT NULL,
	"campaign_id" integer,
	"allocated_amount" numeric(10, 2) NOT NULL,
	"allocated_amount_usd" numeric(10, 2),
	"currency" "currency" NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "manual_donation_allocation" ADD CONSTRAINT "manual_donation_allocation_manual_donation_id_manual_donation_id_fk" FOREIGN KEY ("manual_donation_id") REFERENCES "public"."manual_donation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "manual_donation_allocation" ADD CONSTRAINT "manual_donation_allocation_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_donation_allocation_donation_id_idx" ON "manual_donation_allocation" ("manual_donation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_donation_allocation_campaign_id_idx" ON "manual_donation_allocation" ("campaign_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "manual_donation_allocation_unique" ON "manual_donation_allocation" ("manual_donation_id","campaign_id");
