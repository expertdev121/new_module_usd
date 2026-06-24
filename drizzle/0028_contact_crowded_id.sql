-- Migration 0028 — Add contact.crowded_contact_id (optional match precision).
--
-- Mirrors contact.ghl_contact_id added in migration 0019. When a Crowded
-- payment webhook arrives we look up the donor by:
--   1. crowded_contact_id + location_id  (best — survives email changes)
--   2. email   + location_id              (good)
--   3. mobile  + location_id              (fallback)
-- and create a new contact if no match. Without this column we'd skip
-- step 1 and always fall back to email matching.
--
-- Idempotent.

ALTER TABLE contact
  ADD COLUMN IF NOT EXISTS crowded_contact_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS contact_crowded_location_unique
  ON contact (crowded_contact_id, location_id)
  WHERE crowded_contact_id IS NOT NULL AND location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_crowded_contact_id
  ON contact (crowded_contact_id);
