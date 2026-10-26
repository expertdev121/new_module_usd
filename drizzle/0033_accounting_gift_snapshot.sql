-- Gift snapshot taken when a deposit is closed, so DonorHQ can tell when a gift was changed afterwards
-- (amount, campaign, status, date). Detection only reads these columns; no trigger or change to any existing
-- table or route. deposit_transactions is a new table, so this is instant. Idempotent.
ALTER TABLE deposit_transactions ADD COLUMN IF NOT EXISTS snap_amount NUMERIC(12,2);
ALTER TABLE deposit_transactions ADD COLUMN IF NOT EXISTS snap_campaign_id INTEGER;
ALTER TABLE deposit_transactions ADD COLUMN IF NOT EXISTS snap_status VARCHAR(20);
ALTER TABLE deposit_transactions ADD COLUMN IF NOT EXISTS snap_date DATE;
ALTER TABLE deposit_transactions ADD COLUMN IF NOT EXISTS snapped_at TIMESTAMP;
