-- Migration 0025 — payment pull from GHL into manual_donation.
--
-- Adds three columns + one partial UNIQUE index that together make the
-- backfill idempotent and the data traceable:
--
--   1. ghl_source — discriminator for where the row came from:
--        'ghl_transaction' | 'ghl_invoice' | 'ghl_order' | 'ghl_subscription'
--        NULL → DonorHQ-native (manual entry, CSV upload, etc.)
--
--   2. ghl_resource_id — the GHL ID of the source object (transaction ID,
--      invoice ID, order ID, subscription charge ID). Lets us look the
--      original up + dedup on re-pull.
--
--   3. ghl_payment_method — card / ach / cash / etc. straight from GHL's
--      payment_method field. Goes into the existing payment_method TEXT
--      field too for display, but kept distinct for filtering.
--
-- The partial UNIQUE index (location_id, ghl_resource_id) WHERE both NOT
-- NULL is the dedup keystone — re-running the backfill is a no-op for
-- already-imported rows.  Mirrors the contact_ghl_location_unique pattern.
-- Because manual_donation has no location_id directly, we add one
-- (denormalized — the contact's location). This avoids cross-location
-- collisions on the same GHL resource ID and avoids a join on every
-- ON CONFLICT lookup.
--
-- All columns nullable so existing rows continue to validate. Idempotent.

ALTER TABLE manual_donation
  ADD COLUMN IF NOT EXISTS ghl_source         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ghl_resource_id    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ghl_payment_method VARCHAR(50),
  ADD COLUMN IF NOT EXISTS location_id        TEXT;

-- Index for the dedup lookup. Partial unique so DonorHQ-native rows
-- (ghl_resource_id IS NULL) don't fight for the index.
CREATE UNIQUE INDEX IF NOT EXISTS manual_donation_ghl_location_unique
  ON manual_donation (location_id, ghl_resource_id)
  WHERE location_id IS NOT NULL AND ghl_resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_manual_donation_ghl_source
  ON manual_donation (ghl_source);

CREATE INDEX IF NOT EXISTS idx_manual_donation_location_id
  ON manual_donation (location_id);
