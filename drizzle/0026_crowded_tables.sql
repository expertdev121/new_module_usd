-- Migration 0026 — Crowded (bankingcrowded.com) integration tables.
--
-- Creates four new tables for the Crowded payment integration. All
-- strictly additive — no existing tables touched. Idempotent.
--
--   - crowded_connections     : one row per admin location with the
--                               encrypted Partner API key + webhook
--                               registration metadata
--   - crowded_forms           : one row per donation form (= one Crowded
--                               "collection") with branding + mapping
--                               into DonorHQ campaigns/categories
--   - crowded_webhook_events  : forensic store + per-event dedup
--   - crowded_payment_plans   : recurring / installment plan tracking
--
-- Companion migrations:
--   - 0027 extends manual_donation with crowded_* columns
--   - 0028 adds contact.crowded_contact_id (optional match precision)

CREATE TABLE IF NOT EXISTS crowded_connections (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id              TEXT NOT NULL,
  api_token_enc            TEXT NOT NULL,
  org_id                   VARCHAR(255),
  chapter_id               VARCHAR(255) NOT NULL,
  chapter_name             VARCHAR(255),
  webhook_registration_id  VARCHAR(255),
  webhook_secret_enc       TEXT,
  status                   VARCHAR(50)  NOT NULL DEFAULT 'active',
  last_validated_at        TIMESTAMPTZ,
  revoked_at               TIMESTAMPTZ,
  revoked_reason           TEXT,
  created_by               INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS crowded_connections_location_unique
  ON crowded_connections (location_id);

CREATE INDEX IF NOT EXISTS idx_crowded_connections_chapter
  ON crowded_connections (chapter_id);

CREATE INDEX IF NOT EXISTS idx_crowded_connections_status
  ON crowded_connections (status);

CREATE TABLE IF NOT EXISTS crowded_forms (
  id                      SERIAL PRIMARY KEY,
  location_id             TEXT NOT NULL,
  chapter_id              VARCHAR(255) NOT NULL,
  crowded_collection_id   VARCHAR(255) NOT NULL,

  name                    TEXT NOT NULL,
  type                    VARCHAR(20) NOT NULL DEFAULT 'donation',
  amount_cents            INTEGER,
  goal_cents              INTEGER,
  recurring_enabled       BOOLEAN NOT NULL DEFAULT FALSE,

  campaign_id             INTEGER,
  category_id             INTEGER,
  category_item_id        INTEGER,
  account_id              INTEGER,

  primary_color           VARCHAR(9),
  accent_color            VARCHAR(9),
  background_color        VARCHAR(9),
  logo_url                TEXT,
  hero_image_url          TEXT,
  headline                TEXT,
  tagline                 TEXT,
  success_message         TEXT,
  submit_label            VARCHAR(60),

  suggested_amounts       JSONB,

  ask_address             BOOLEAN NOT NULL DEFAULT TRUE,
  ask_phone               BOOLEAN NOT NULL DEFAULT FALSE,
  ask_tribute             BOOLEAN NOT NULL DEFAULT FALSE,
  ask_comments            BOOLEAN NOT NULL DEFAULT FALSE,
  require_consent         BOOLEAN NOT NULL DEFAULT TRUE,

  fee_cover_default       VARCHAR(20) NOT NULL DEFAULT 'donor',

  success_url             TEXT,
  failure_url             TEXT,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_by              INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crowded_forms_location ON crowded_forms (location_id);
CREATE INDEX IF NOT EXISTS idx_crowded_forms_chapter  ON crowded_forms (chapter_id);
CREATE UNIQUE INDEX IF NOT EXISTS crowded_forms_collection_unique
  ON crowded_forms (location_id, crowded_collection_id);

CREATE TABLE IF NOT EXISTS crowded_webhook_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            VARCHAR(255) NOT NULL,
  batch_id            VARCHAR(255),
  event_type          VARCHAR(100) NOT NULL,
  chapter_id          VARCHAR(255),
  location_id         TEXT,
  payload             JSONB NOT NULL,
  signature_valid     BOOLEAN NOT NULL DEFAULT FALSE,
  processing_status   VARCHAR(50) NOT NULL DEFAULT 'received',
  processing_error    TEXT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS crowded_webhook_events_event_id_unique
  ON crowded_webhook_events (event_id);
CREATE INDEX IF NOT EXISTS idx_crowded_webhook_events_chapter  ON crowded_webhook_events (chapter_id);
CREATE INDEX IF NOT EXISTS idx_crowded_webhook_events_location ON crowded_webhook_events (location_id);
CREATE INDEX IF NOT EXISTS idx_crowded_webhook_events_type     ON crowded_webhook_events (event_type);
CREATE INDEX IF NOT EXISTS idx_crowded_webhook_events_status   ON crowded_webhook_events (processing_status);

CREATE TABLE IF NOT EXISTS crowded_payment_plans (
  id                  SERIAL PRIMARY KEY,
  location_id         TEXT NOT NULL,
  crowded_plan_id     VARCHAR(255) NOT NULL,
  crowded_form_id     INTEGER,
  contact_id          INTEGER,
  type                VARCHAR(20) NOT NULL DEFAULT 'recurring',
  frequency           VARCHAR(20),
  total_payments      INTEGER,
  completed_payments  INTEGER NOT NULL DEFAULT 0,
  total_paid_cents    INTEGER NOT NULL DEFAULT 0,
  status              VARCHAR(30) NOT NULL DEFAULT 'active',
  first_payment_date  TIMESTAMPTZ,
  next_payment_date   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS crowded_payment_plans_plan_unique
  ON crowded_payment_plans (crowded_plan_id);
CREATE INDEX IF NOT EXISTS idx_crowded_payment_plans_location ON crowded_payment_plans (location_id);
CREATE INDEX IF NOT EXISTS idx_crowded_payment_plans_contact  ON crowded_payment_plans (contact_id);
CREATE INDEX IF NOT EXISTS idx_crowded_payment_plans_status   ON crowded_payment_plans (status);
