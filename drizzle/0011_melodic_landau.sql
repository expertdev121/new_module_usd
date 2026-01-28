CREATE TABLE "payroc_payment" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"order_id" text NOT NULL,
	"merchant_reference" text,
	"processing_terminal_id" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" text NOT NULL,
	"transaction_type" text NOT NULL,
	"customer_email" text,
	"customer_name" text,
	"card_type" text,
	"card_last_four" varchar(4),
	"card_expiry" varchar(4),
	"approval_code" text,
	"response_code" text,
	"response_message" text,
	"transaction_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"raw_data" jsonb,
	CONSTRAINT "payroc_payment_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "payroc_webhook_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"idempotency_checked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "payroc_webhook_event_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "constituents_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "email2" text;--> statement-breakpoint
CREATE INDEX "payroc_payment_payment_id_idx" ON "payroc_payment" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payroc_payment_order_id_idx" ON "payroc_payment" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payroc_payment_merchant_reference_idx" ON "payroc_payment" USING btree ("merchant_reference");--> statement-breakpoint
CREATE INDEX "payroc_payment_status_idx" ON "payroc_payment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payroc_payment_transaction_date_idx" ON "payroc_payment" USING btree ("transaction_date");--> statement-breakpoint
CREATE INDEX "payroc_webhook_event_event_id_idx" ON "payroc_webhook_event" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "payroc_webhook_event_event_type_idx" ON "payroc_webhook_event" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "payroc_webhook_event_processed_idx" ON "payroc_webhook_event" USING btree ("processed");