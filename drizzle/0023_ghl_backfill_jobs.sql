-- Migration 0023 — ghl_backfill_jobs queue.
--
-- Backs the historical-contact backfill that runs when a sub-account installs
-- DonorHQ for the first time (or when an admin clicks "Re-sync" on the
-- connections page).
--
-- Design:
--   * One row per (resource_id, resource_type) "campaign". `resource_id` is
--     the locationId for a sub-account backfill, or the companyId for an
--     agency-wide one.
--   * A worker (Vercel cron + manual trigger) picks the oldest 'queued' or
--     'running' job, fetches one page of contacts from GHL, upserts them
--     atomically (via the existing ON CONFLICT path on `contact`), advances
--     the cursor, and either reschedules itself or marks the job done.
--   * `next_run_at` lets jobs sleep between chunks (e.g. on rate-limit
--     backoff) without being picked up immediately.
--   * `lease_token` + `lease_expires_at` give us a soft mutex so two cron
--     instances can't double-process the same job. Lease is short (60s);
--     if a worker dies, the next tick reclaims it.
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS ghl_backfill_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id      VARCHAR(255) NOT NULL,
  resource_type    VARCHAR(50)  NOT NULL,         -- 'Location' | 'Company'
  location_id      VARCHAR(255),                  -- always set; for Company jobs this is the per-location target
  company_id       VARCHAR(255),                  -- carried through for lazy-mint lookups
  kind             VARCHAR(50)  NOT NULL DEFAULT 'contacts',
  status           VARCHAR(50)  NOT NULL DEFAULT 'queued',  -- queued|running|completed|failed|cancelled
  cursor           TEXT,                          -- GHL pagination cursor (startAfter / startAfterId)
  page             INTEGER      NOT NULL DEFAULT 0,
  page_size        INTEGER      NOT NULL DEFAULT 100,
  total_estimate   INTEGER,                       -- GHL's reported total, when available
  processed_count  INTEGER      NOT NULL DEFAULT 0,
  upserted_count   INTEGER      NOT NULL DEFAULT 0,
  failed_count     INTEGER      NOT NULL DEFAULT 0,
  last_error       TEXT,
  attempt_count    INTEGER      NOT NULL DEFAULT 0,
  triggered_by     VARCHAR(50)  NOT NULL DEFAULT 'install',   -- install|manual|cron
  lease_token      UUID,
  lease_expires_at TIMESTAMPTZ,
  next_run_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ
);

-- One ACTIVE job per (resource_id, kind). Partial unique so completed/failed
-- rows don't block a re-trigger. Lets the OAuth callback safely enqueue
-- without checking first — if a job already exists for the location, the
-- INSERT is a no-op via ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS ghl_backfill_jobs_active_unique
  ON ghl_backfill_jobs (resource_id, kind)
  WHERE status IN ('queued', 'running');

-- Worker-pick path: WHERE status IN ('queued','running') AND next_run_at <= NOW()
-- ORDER BY next_run_at ASC.
CREATE INDEX IF NOT EXISTS idx_ghl_backfill_jobs_pickup
  ON ghl_backfill_jobs (status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_ghl_backfill_jobs_resource
  ON ghl_backfill_jobs (resource_id);

CREATE INDEX IF NOT EXISTS idx_ghl_backfill_jobs_location
  ON ghl_backfill_jobs (location_id);
