-- Adds revocation + connection-status metadata to ghl_oauth_tokens.
-- Strictly additive: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS only.
--
-- New columns:
--   status          — 'active' | 'revoked' | 'needs_reinstall'
--   revoked_at      — when AppUninstall fired (or admin clicked Disconnect)
--   revoked_reason  — 'user_uninstalled' | 'admin_disconnected' | 'refresh_failed' | ...
--
-- The connections page filters on these. getValidAccessToken() refuses to
-- refresh when status != 'active'.

ALTER TABLE "ghl_oauth_tokens" ADD COLUMN IF NOT EXISTS "status" VARCHAR(50) NOT NULL DEFAULT 'active';
ALTER TABLE "ghl_oauth_tokens" ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMPTZ;
ALTER TABLE "ghl_oauth_tokens" ADD COLUMN IF NOT EXISTS "revoked_reason" TEXT;

CREATE INDEX IF NOT EXISTS "idx_ghl_oauth_tokens_status" ON "ghl_oauth_tokens"("status");
