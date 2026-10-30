-- Failure alerts for the accounting sync: the addresses to email (sent through one shared GoHighLevel workflow),
-- an optional per-organization GoHighLevel inbound-webhook URL, and when the last alert went out
-- (so a failing org is told at most once every 20 hours).
-- Additive and nullable: existing rows are untouched. Applied by .apply-accounting-migration.mjs with 0030-0034.

ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS alert_emails TEXT;           -- comma-separated, at most 3
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS alert_emails_verified TEXT;  -- the addresses that confirmed the test email
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS alert_webhook_url TEXT;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS alert_last_sent_at TIMESTAMP;
