CREATE TYPE "public"."campaign_status" AS ENUM('active', 'inactive', 'completed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"location_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "campaign_status" DEFAULT 'active' NOT NULL,
	"location_id" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_donation" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"amount_usd" numeric(10, 2),
	"exchange_rate" numeric(10, 4),
	"payment_date" date NOT NULL,
	"received_date" date,
	"check_date" date,
	"account_id" integer,
	"campaign_id" integer,
	"payment_method" text,
	"method_detail" text,
	"payment_status" "payment_status" DEFAULT 'completed' NOT NULL,
	"reference_number" text,
	"check_number" text,
	"receipt_number" text,
	"receipt_type" "receipt_type",
	"receipt_issued" boolean DEFAULT false NOT NULL,
	"solicitor_id" integer,
	"bonus_percentage" numeric(5, 2),
	"bonus_amount" numeric(10, 2),
	"bonus_rule_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category" DROP CONSTRAINT "category_name_unique";--> statement-breakpoint
ALTER TABLE "tag" DROP CONSTRAINT "tag_name_unique";--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_email_unique";--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_changed_by_contact_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "user_email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "details" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "timestamp" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "category_group" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "category_item" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "contact_roles" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "payment_method_details" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "relationships" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "solicitor" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "student_roles" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "tag" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_donation" ADD CONSTRAINT "manual_donation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_donation" ADD CONSTRAINT "manual_donation_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_donation" ADD CONSTRAINT "manual_donation_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_donation" ADD CONSTRAINT "manual_donation_solicitor_id_solicitor_id_fk" FOREIGN KEY ("solicitor_id") REFERENCES "public"."solicitor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_donation" ADD CONSTRAINT "manual_donation_bonus_rule_id_bonus_rule_id_fk" FOREIGN KEY ("bonus_rule_id") REFERENCES "public"."bonus_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_donation_contact_id_idx" ON "manual_donation" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "manual_donation_payment_date_idx" ON "manual_donation" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX "manual_donation_status_idx" ON "manual_donation" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "manual_donation_reference_idx" ON "manual_donation" USING btree ("reference_number");--> statement-breakpoint
CREATE INDEX "manual_donation_solicitor_id_idx" ON "manual_donation" USING btree ("solicitor_id");--> statement-breakpoint
CREATE INDEX "manual_donation_currency_idx" ON "manual_donation" USING btree ("currency");--> statement-breakpoint
CREATE INDEX "manual_donation_campaign_id_idx" ON "manual_donation" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "table_name";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "record_id";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "field_name";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "old_value";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "new_value";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "changed_by";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "changed_at";