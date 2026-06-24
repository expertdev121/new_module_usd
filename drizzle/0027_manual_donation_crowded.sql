-- Migration 0027 — Extend manual_donation for Crowded payment provenance.
--
-- Mirrors the pattern from migration 0025 (which added ghl_source etc).
-- These columns identify donations that came in through a Crowded form,
-- so dashboards can filter / badge them and re-syncs can dedup.
--
-- The partial UNIQUE index on (location_id, crowded_resource_id) is the
-- keystone for idempotent webhook ingestion — receiving the same
-- payment.succeeded event twice (or a re-pull on top of a live one) is
-- a single ON CONFLICT UPDATE, not a duplicate row.
--
-- All columns nullable so existing rows continue to validate. Idempotent.

ALTER TABLE manual_donation
  ADD COLUMN IF NOT EXISTS crowded_source         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS crowded_resource_id    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS crowded_form_id        INTEGER,
  ADD COLUMN IF NOT EXISTS crowded_payment_method VARCHAR(50),
  ADD COLUMN IF NOT EXISTS crowded_fee_cents      INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS manual_donation_crowded_location_unique
  ON manual_donation (location_id, crowded_resource_id)
  WHERE location_id IS NOT NULL AND crowded_resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_manual_donation_crowded_source
  ON manual_donation (crowded_source);

CREATE INDEX IF NOT EXISTS idx_manual_donation_crowded_form_id
  ON manual_donation (crowded_form_id);
