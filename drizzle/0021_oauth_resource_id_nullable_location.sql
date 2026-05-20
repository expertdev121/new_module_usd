-- Re-aligns ghl_oauth_tokens to the official GHL Marketplace pattern:
-- a single dictionary keyed on `resource_id`, which is EITHER a locationId
-- (sub-account install) OR a companyId (agency install). Mirrors the
-- official template's `installationObjects[resourceId]` design.
--
-- Strictly additive on data:
--   1. Add resource_id (nullable temporarily so we can backfill safely)
--   2. Backfill resource_id = COALESCE(location_id, company_id)
--   3. Drop the OLD unique constraint on location_id
--   4. Make location_id nullable (it isn't for company-level installs)
--   5. Lock in resource_id as NOT NULL + UNIQUE
--   6. Add a `resource_type` discriminator ('Location' | 'Company') for UI display
--
-- NO rows are deleted. NO existing data is modified beyond backfilling new
-- columns. The previous columns (access_token, refresh_token, status, etc.)
-- are entirely untouched.

-- 1. New columns (nullable first so step 2 backfill never fails on a constraint).
ALTER TABLE "ghl_oauth_tokens" ADD COLUMN IF NOT EXISTS "resource_id" VARCHAR(255);
ALTER TABLE "ghl_oauth_tokens" ADD COLUMN IF NOT EXISTS "resource_type" VARCHAR(50);

-- 2. Backfill resource_id for ANY pre-existing rows.
-- For historical rows, location_id was always set, so resource_id = location_id.
UPDATE "ghl_oauth_tokens"
SET "resource_id" = COALESCE("location_id", "company_id"),
    "resource_type" = CASE
      WHEN "location_id" IS NOT NULL THEN 'Location'
      ELSE 'Company'
    END
WHERE "resource_id" IS NULL;

-- 3. Drop the OLD unique constraint on location_id so we can:
--    (a) Allow NULL location_id (Company-only installs)
--    (b) Allow multiple Company-only rows that may share locationId=NULL
ALTER TABLE "ghl_oauth_tokens" DROP CONSTRAINT IF EXISTS "ghl_oauth_tokens_location_id_key";
DROP INDEX IF EXISTS "ghl_oauth_tokens_location_id_unique";

-- 4. Make location_id nullable. (Company-only installs have no location_id.)
ALTER TABLE "ghl_oauth_tokens" ALTER COLUMN "location_id" DROP NOT NULL;

-- 5. Lock resource_id in as NOT NULL + UNIQUE — this is now the primary
--    dedup key (the official template's `installationObjects[resourceId]`).
ALTER TABLE "ghl_oauth_tokens" ALTER COLUMN "resource_id" SET NOT NULL;
ALTER TABLE "ghl_oauth_tokens" ALTER COLUMN "resource_type" SET NOT NULL;

-- Use a partial CREATE UNIQUE INDEX so re-running is idempotent (DROP+ADD
-- of a named UNIQUE constraint is not idempotent in stock Postgres).
DROP INDEX IF EXISTS "ghl_oauth_tokens_resource_id_unique";
CREATE UNIQUE INDEX "ghl_oauth_tokens_resource_id_unique" ON "ghl_oauth_tokens"("resource_id");

CREATE INDEX IF NOT EXISTS "idx_ghl_oauth_tokens_resource_id" ON "ghl_oauth_tokens"("resource_id");
CREATE INDEX IF NOT EXISTS "idx_ghl_oauth_tokens_resource_type" ON "ghl_oauth_tokens"("resource_type");
