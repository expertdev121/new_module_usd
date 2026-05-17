-- Adds GHL-sync metadata + sync-specific fields to the contact table.
-- All statements use ADD COLUMN IF NOT EXISTS — Postgres 9.6+ supports this.
-- Strictly additive: no columns are dropped, no existing column types change,
-- no data is modified.
--
-- After running this, the webhook handlers can:
--   • soft-delete via deleted_at
--   • record where a row came from via sync_source
--   • track the last GHL sync via last_ghl_sync_at
--   • surface GHL-specific data (tags, custom fields, DoB, granular address)
--     without breaking any existing read path (every new column is nullable
--     or has a non-breaking default)

ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "sync_source" VARCHAR(50);
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "last_ghl_sync_at" TIMESTAMPTZ;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "do_not_contact" BOOLEAN DEFAULT FALSE;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "date_of_birth" DATE;

-- Granular address columns. The existing single `address` text column is
-- preserved and untouched — these are additions for structured GHL data.
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "address1" TEXT;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "city" VARCHAR(255);
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "state" VARCHAR(255);
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "postal_code" VARCHAR(50);
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "country" VARCHAR(100);

ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "organization" TEXT;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "source" VARCHAR(255);

-- Tags as a JSONB string-array on the contact row (option (b) per Nikhil's
-- decision in the webhook task). Bypasses the normalized contact_tags/tag
-- relation — handler writes the array verbatim from the webhook payload.
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "tags" JSONB;

-- Bag for any GHL custom fields we don't have a typed column for.
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "ghl_custom_fields" JSONB;

-- A partial index on deleted_at lets us cheaply filter to live rows.
CREATE INDEX IF NOT EXISTS "idx_contact_deleted_at_null" ON "contact"("id") WHERE "deleted_at" IS NULL;
