-- Migration 0024 — super-admin offboarding support.
--
-- Adds two minimal columns to power /admin/offboard-clients:
--
--   1. user.deleted_at — when set, blocks the user from logging in. The
--      authorize() callback in lib/auth.ts rejects the credential check if
--      this is non-null. Soft-deleting a location flips this for every
--      admin user under that location.
--
--   2. ghl_oauth_tokens.data_soft_deleted_at — a UI marker so the
--      offboarding page can list soft-deleted locations separately from
--      "Active" and "Revoked". Independent of `status` because status can
--      also be revoked for other reasons (refresh_failed, etc.) and we
--      want to distinguish admin-triggered offboarding.
--
-- All columns nullable; no data writes. Idempotent.

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_deleted_at ON "user" (deleted_at);

ALTER TABLE ghl_oauth_tokens
  ADD COLUMN IF NOT EXISTS data_soft_deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ghl_oauth_tokens_data_soft_deleted_at
  ON ghl_oauth_tokens (data_soft_deleted_at);
