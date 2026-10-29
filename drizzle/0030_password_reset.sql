-- Password reset codes for the DonorHQ "Forgot password" flow.
-- Additive only: one new table, nothing existing is changed. Applied via
-- .apply-password-reset-migration.mjs (idempotent), like 0025-0029.
--
-- A short-lived 6-digit code is emailed (via a GHL webhook) to a user who asks
-- to reset their password. The code is stored HASHED (sha256), never in plain
-- text, with a 15-minute expiry and an attempt counter so it cannot be brute
-- forced. Rows are consumed on a successful reset and cleaned up by expiry.

CREATE TABLE IF NOT EXISTS password_reset_code (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,                 -- sha256 hex of the 6-digit code
  expires_at TIMESTAMP NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,      -- wrong-code tries; invalidated past the limit
  consumed_at TIMESTAMP,                    -- set when the code was used to reset
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_code_email_idx ON password_reset_code (lower(email));
CREATE INDEX IF NOT EXISTS password_reset_code_expires_idx ON password_reset_code (expires_at);
