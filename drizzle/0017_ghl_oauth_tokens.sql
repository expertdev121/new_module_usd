-- Stores GHL OAuth tokens per GHL location (sub-account).
-- Inserted/updated by the OAuth callback at app/api/oauth/ghl/callback.
-- Read + refreshed by lib/ghl/get-access-token.ts.
--
-- IMPORTANT: This migration is NOT auto-run. Apply manually:
--   psql "$DATABASE_URL" -f drizzle/0017_ghl_oauth_tokens.sql

CREATE TABLE IF NOT EXISTS "ghl_oauth_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "location_id" VARCHAR(255) UNIQUE NOT NULL,
  "company_id" VARCHAR(255) NOT NULL,
  "user_id" VARCHAR(255),
  "access_token" TEXT NOT NULL,
  "refresh_token" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "scope" TEXT,
  "token_type" VARCHAR(50) DEFAULT 'Bearer',
  "user_type" VARCHAR(50),
  "location_name" VARCHAR(255),
  "company_name" VARCHAR(255),
  "is_whitelabel_company" BOOLEAN DEFAULT FALSE,
  "donor_hq_user_id" UUID,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_ghl_oauth_tokens_location_id" ON "ghl_oauth_tokens"("location_id");
CREATE INDEX IF NOT EXISTS "idx_ghl_oauth_tokens_company_id" ON "ghl_oauth_tokens"("company_id");
