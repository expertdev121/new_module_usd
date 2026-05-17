-- New tables for inbound GHL Marketplace webhooks.
-- Strictly additive: all statements use IF NOT EXISTS. No existing tables are touched.
--
-- Tables:
--   ghl_webhook_events  — idempotency + audit log for every webhook GHL fires at us
--   ghl_sync_writes     — outbound write tracker, used by handlers to skip echo events
--   ghl_invoice_events  — lightweight log for InvoicePaid events (full processing wired later)

CREATE TABLE IF NOT EXISTS "ghl_webhook_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "webhook_id" VARCHAR(255) UNIQUE NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "location_id" VARCHAR(255),
  "company_id" VARCHAR(255),
  "ghl_timestamp" TIMESTAMPTZ,
  "payload" JSONB NOT NULL,
  "signature_valid" BOOLEAN NOT NULL DEFAULT FALSE,
  "processing_status" VARCHAR(50) NOT NULL DEFAULT 'received',
  "processing_error" TEXT,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processed_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "idx_ghl_webhook_events_webhook_id" ON "ghl_webhook_events"("webhook_id");
CREATE INDEX IF NOT EXISTS "idx_ghl_webhook_events_location_id" ON "ghl_webhook_events"("location_id");
CREATE INDEX IF NOT EXISTS "idx_ghl_webhook_events_event_type" ON "ghl_webhook_events"("event_type");
CREATE INDEX IF NOT EXISTS "idx_ghl_webhook_events_status" ON "ghl_webhook_events"("processing_status");

CREATE TABLE IF NOT EXISTS "ghl_sync_writes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "location_id" VARCHAR(255) NOT NULL,
  "ghl_contact_id" VARCHAR(255) NOT NULL,
  "written_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '60 seconds')
);

CREATE INDEX IF NOT EXISTS "idx_ghl_sync_writes_lookup" ON "ghl_sync_writes"("location_id", "ghl_contact_id", "expires_at");

CREATE TABLE IF NOT EXISTS "ghl_invoice_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_id" VARCHAR(255),
  "contact_id" VARCHAR(255),
  "location_id" VARCHAR(255),
  "amount" NUMERIC(12, 2),
  "currency" VARCHAR(10),
  "paid_at" TIMESTAMPTZ,
  "payload" JSONB NOT NULL,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_ghl_invoice_events_invoice_id" ON "ghl_invoice_events"("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_ghl_invoice_events_location_id" ON "ghl_invoice_events"("location_id");
