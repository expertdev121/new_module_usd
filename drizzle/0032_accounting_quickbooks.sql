-- QuickBooks Online connection + sync log (Phase 2). Idempotent; applied via .apply-accounting-migration.mjs.

-- One connection per location. Tokens are AES-256-GCM encrypted by the app (ACCOUNTING_ENC_KEY).
CREATE TABLE IF NOT EXISTS ledger_connections (
  id SERIAL PRIMARY KEY,
  location_id TEXT NOT NULL UNIQUE,
  system VARCHAR(32) NOT NULL DEFAULT 'quickbooks_online',
  -- sandbox | production: tokens from one never work for the other, so it is stored with them.
  environment VARCHAR(16) NOT NULL DEFAULT 'sandbox',
  realm_id TEXT NOT NULL,
  company_name TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  access_expires_at TIMESTAMP,
  refresh_expires_at TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  last_error TEXT,
  connected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  connected_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_connections_status_chk CHECK (status IN ('active','needs_reconnect','disconnected'))
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id SERIAL PRIMARY KEY,
  location_id TEXT NOT NULL,
  trigger VARCHAR(16) NOT NULL,                               -- manual | nightly | retry
  status VARCHAR(16) NOT NULL DEFAULT 'running',              -- running | success | partial | failed
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP,
  posted INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_by INTEGER REFERENCES "user"(id) ON DELETE SET NULL,
  CONSTRAINT sync_runs_status_chk CHECK (status IN ('running','success','partial','failed')),
  CONSTRAINT sync_runs_trigger_chk CHECK (trigger IN ('manual','nightly','retry'))
);
CREATE INDEX IF NOT EXISTS sync_runs_location_idx ON sync_runs (location_id, started_at DESC);
-- At most one running sync per location: the second one to start cannot insert.
CREATE UNIQUE INDEX IF NOT EXISTS sync_runs_one_running ON sync_runs (location_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS sync_results (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  deposit_id INTEGER NOT NULL REFERENCES deposits(id) ON DELETE CASCADE,
  status VARCHAR(12) NOT NULL,                                -- posted | failed | skipped
  external_id TEXT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT sync_results_status_chk CHECK (status IN ('posted','failed','skipped'))
);
CREATE INDEX IF NOT EXISTS sync_results_run_idx ON sync_results (run_id);
CREATE INDEX IF NOT EXISTS sync_results_deposit_idx ON sync_results (deposit_id);
