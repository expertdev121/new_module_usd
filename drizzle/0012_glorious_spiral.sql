ALTER TABLE "manual_donation" ADD COLUMN "category_id" integer;--> statement-breakpoint
ALTER TABLE "manual_donation" ADD COLUMN "category_item_id" integer;--> statement-breakpoint
ALTER TABLE "manual_donation" ADD CONSTRAINT "manual_donation_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_donation" ADD CONSTRAINT "manual_donation_category_item_id_category_item_id_fk" FOREIGN KEY ("category_item_id") REFERENCES "public"."category_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_donation_category_id_idx" ON "manual_donation" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "manual_donation_category_item_id_idx" ON "manual_donation" USING btree ("category_item_id");