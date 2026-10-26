-- Accounting sync (QuickBooks first). See "DonorHQ Accounting Build Plan".
-- Applied manually via .apply-accounting-migration.mjs (idempotent), like 0025-0029.
-- Tenant scope is location_id (text), matching the rest of the schema.
-- Gifts are manual_donation rows; deposits group them 1:N via deposit_transactions.

CREATE TABLE IF NOT EXISTS accounting_settings (
  id SERIAL PRIMARY KEY,
  location_id TEXT NOT NULL UNIQUE,
  system VARCHAR(32) NOT NULL DEFAULT 'quickbooks_online',   -- quickbooks_online | generic_csv
  basis VARCHAR(16) NOT NULL DEFAULT 'cash',                  -- cash | accrual
  -- Gifts dated before this are never exported ("new donations only").
  start_date DATE,
  unmapped_account_id INTEGER,
  entry_type VARCHAR(16) NOT NULL DEFAULT 'deposit',          -- deposit | journal_entry
  auto_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,           -- nightly job opt-in
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT accounting_settings_basis_chk CHECK (basis IN ('cash','accrual')),
  CONSTRAINT accounting_settings_entry_type_chk CHECK (entry_type IN ('deposit','journal_entry'))
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id SERIAL PRIMARY KEY,
  location_id TEXT NOT NULL,
  external_id TEXT,                                           -- QuickBooks Id once connected
  number TEXT,
  name TEXT NOT NULL,
  type TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ledger_accounts_location_idx ON ledger_accounts (location_id);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_external_unique
  ON ledger_accounts (location_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger_dimensions (                -- QuickBooks classes
  id SERIAL PRIMARY KEY,
  location_id TEXT NOT NULL,
  external_id TEXT,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ledger_dimensions_location_idx ON ledger_dimensions (location_id);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_dimensions_external_unique
  ON ledger_dimensions (location_id, external_id) WHERE external_id IS NOT NULL;

-- Fund = campaign (decided with Nikhil, 2026-10-22). One row per campaign.
CREATE TABLE IF NOT EXISTS fund_map (
  id SERIAL PRIMARY KEY,
  location_id TEXT NOT NULL,
  campaign_id INTEGER NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  income_account_id INTEGER REFERENCES ledger_accounts(id) ON DELETE SET NULL,
  dimension_id INTEGER REFERENCES ledger_dimensions(id) ON DELETE SET NULL,
  ar_account_id INTEGER REFERENCES ledger_accounts(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fund_map_unique UNIQUE (location_id, campaign_id)
);

-- Maps a normalized payment source (card, check, cash, ach, ...) to bank + fee accounts.
CREATE TABLE IF NOT EXISTS source_map (
  id SERIAL PRIMARY KEY,
  location_id TEXT NOT NULL,
  source VARCHAR(32) NOT NULL,
  deposit_account_id INTEGER REFERENCES ledger_accounts(id) ON DELETE SET NULL,
  fee_account_id INTEGER REFERENCES ledger_accounts(id) ON DELETE SET NULL,
  CONSTRAINT source_map_unique UNIQUE (location_id, source)
);

CREATE TABLE IF NOT EXISTS export_files (
  id SERIAL PRIMARY KEY,
  location_id TEXT NOT NULL,
  template VARCHAR(32) NOT NULL,
  deposit_count INTEGER NOT NULL DEFAULT 0,
  file_url TEXT,
  created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposits (
  id SERIAL PRIMARY KEY,
  location_id TEXT NOT NULL,
  source VARCHAR(32) NOT NULL,                                -- check | cash | ach | stripe | ...
  external_ref TEXT,                                          -- Stripe payout id, or bank slip ref
  deposit_date DATE NOT NULL,
  gross NUMERIC(12,2) NOT NULL DEFAULT 0,
  fees NUMERIC(12,2) NOT NULL DEFAULT 0,
  refunds NUMERIC(12,2) NOT NULL DEFAULT 0,
  net NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'open',                 -- open | closed | exported | voided
  created_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  closed_at TIMESTAMP,
  exported_at TIMESTAMP,
  exported_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  export_file_id INTEGER REFERENCES export_files(id) ON DELETE SET NULL,
  external_id TEXT,                                           -- QuickBooks transaction id once posted
  posted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT deposits_status_chk CHECK (status IN ('open','closed','exported','voided'))
);
CREATE INDEX IF NOT EXISTS deposits_location_status_idx ON deposits (location_id, status);
-- One post per deposit; never post the same deposit twice.
CREATE UNIQUE INDEX IF NOT EXISTS deposits_external_unique
  ON deposits (location_id, external_id) WHERE external_id IS NOT NULL;
-- Re-importing the same Stripe payout can't create a second deposit.
CREATE UNIQUE INDEX IF NOT EXISTS deposits_source_ref_unique
  ON deposits (location_id, source, external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS deposit_lines (
  id SERIAL PRIMARY KEY,
  deposit_id INTEGER NOT NULL REFERENCES deposits(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES ledger_accounts(id) ON DELETE SET NULL,
  dimension_id INTEGER REFERENCES ledger_dimensions(id) ON DELETE SET NULL,
  debit NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit NUMERIC(12,2) NOT NULL DEFAULT 0,
  memo TEXT,
  campaign_id INTEGER,                                        -- snapshot of the fund at close
  CONSTRAINT deposit_lines_one_side_chk CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
);
CREATE INDEX IF NOT EXISTS deposit_lines_deposit_idx ON deposit_lines (deposit_id);

-- One deposit per gift: unique(manual_donation_id) is the double-entry guard.
CREATE TABLE IF NOT EXISTS deposit_transactions (
  deposit_id INTEGER NOT NULL REFERENCES deposits(id) ON DELETE CASCADE,
  manual_donation_id INTEGER NOT NULL REFERENCES manual_donation(id) ON DELETE RESTRICT,
  PRIMARY KEY (deposit_id, manual_donation_id),
  CONSTRAINT deposit_transactions_gift_unique UNIQUE (manual_donation_id)
);

ALTER TABLE manual_donation ADD COLUMN IF NOT EXISTS deposit_id INTEGER REFERENCES deposits(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS manual_donation_deposit_id_idx ON manual_donation (deposit_id);

CREATE TABLE IF NOT EXISTS accounting_audit (
  id SERIAL PRIMARY KEY,
  location_id TEXT NOT NULL,
  action VARCHAR(48) NOT NULL,
  object VARCHAR(48) NOT NULL,
  object_id TEXT,
  before JSONB,
  after JSONB,
  user_id INTEGER,
  at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS accounting_audit_location_idx ON accounting_audit (location_id, at);

-- Append-only: block UPDATE and DELETE on the audit log.
CREATE OR REPLACE FUNCTION accounting_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'accounting_audit is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS accounting_audit_no_change ON accounting_audit;
CREATE TRIGGER accounting_audit_no_change
  BEFORE UPDATE OR DELETE ON accounting_audit
  FOR EACH ROW EXECUTE FUNCTION accounting_audit_immutable();
