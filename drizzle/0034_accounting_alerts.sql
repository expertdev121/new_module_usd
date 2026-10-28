-- Failure alerts for the accounting sync: an optional GoHighLevel inbound-webhook URL per organization,
-- and when the last alert went out (so a failing org is told at most once every 20 hours).
-- Additive and nullable: existing rows are untouched. Applied by .apply-accounting-migration.mjs with 0030-0033.

ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS alert_webhook_url TEXT;
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS alert_last_sent_at TIMESTAMP;
