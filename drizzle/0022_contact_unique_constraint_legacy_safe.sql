-- Adds a UNIQUE constraint on (ghl_contact_id, location_id) for GHL-sync'd
-- contacts, WITHOUT touching the 20+ existing legacy duplicates the user
-- wants to review manually.
--
-- Strategy: add an `is_legacy_duplicate` column, tag the duplicates so the
-- partial UNIQUE index excludes them, then add the index. Future inserts
-- cannot duplicate because the constraint applies to is_legacy_duplicate=false
-- rows (the default for all new rows).
--
-- IMPORTANT — non-destructive:
--   • No data is deleted, no foreign keys altered, no row content modified
--     beyond setting the new flag.
--   • For each duplicate (ghl_contact_id, location_id) group, the OLDEST
--     row (smallest id) is left as is_legacy_duplicate=FALSE. All other
--     siblings are marked is_legacy_duplicate=TRUE.
--   • You can review and merge them later via your own cleanup process.

-- 1. Add the column. Default FALSE for every row (new and existing).
ALTER TABLE "contact"
  ADD COLUMN IF NOT EXISTS "is_legacy_duplicate" BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Tag existing duplicates. The canonical (kept) row is the one with the
--    smallest id within each (ghl_contact_id, location_id) group.
WITH ranked AS (
  SELECT
    id,
    ghl_contact_id,
    location_id,
    ROW_NUMBER() OVER (
      PARTITION BY ghl_contact_id, location_id
      ORDER BY id ASC
    ) AS rn
  FROM "contact"
  WHERE ghl_contact_id IS NOT NULL
    AND location_id IS NOT NULL
)
UPDATE "contact" SET "is_legacy_duplicate" = TRUE
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 3. Create the partial UNIQUE index. Applies only to:
--    • rows that are NOT legacy duplicates (the tagged ones are skipped)
--    • rows where both ghl_contact_id and location_id are non-null
--      (pre-GHL contacts with NULL fields are unaffected — 13,558 such rows)
CREATE UNIQUE INDEX IF NOT EXISTS "contact_ghl_location_unique"
  ON "contact" ("ghl_contact_id", "location_id")
  WHERE "is_legacy_duplicate" = FALSE
    AND "ghl_contact_id" IS NOT NULL
    AND "location_id" IS NOT NULL;

-- 4. Helper index on the flag itself, for fast filtering when you eventually
--    review the legacy duplicates.
CREATE INDEX IF NOT EXISTS "idx_contact_is_legacy_duplicate"
  ON "contact" ("is_legacy_duplicate")
  WHERE "is_legacy_duplicate" = TRUE;
