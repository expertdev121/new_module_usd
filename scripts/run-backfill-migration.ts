/**
 * Run migration 0023_ghl_backfill_jobs.sql.
 *
 * Strictly additive — no existing tables touched, no data modified.
 * Idempotent (all CREATEs are IF NOT EXISTS).
 *
 *   node --env-file=.env --import tsx scripts/run-backfill-migration.ts
 *
 * We run each statement as its own driver call rather than splitting the
 * .sql file naively, because Postgres CREATE TABLE bodies contain commas
 * and inline `--` comments that break a generic splitter.
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const sql = neon(url);

  // BEFORE — table should not exist yet (or already exists — idempotent).
  const beforeExists = (await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'ghl_backfill_jobs'
    ) AS exists
  `) as { exists: boolean }[];
  console.log(
    `[migration] Pre-state: ghl_backfill_jobs ${beforeExists[0].exists ? "EXISTS (re-running)" : "does not exist"}`,
  );

  console.log(`\n[migration] Running statements...`);

  console.log(`  [1/5] CREATE TABLE ghl_backfill_jobs`);
  await sql`
    CREATE TABLE IF NOT EXISTS ghl_backfill_jobs (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      resource_id      VARCHAR(255) NOT NULL,
      resource_type    VARCHAR(50)  NOT NULL,
      location_id      VARCHAR(255),
      company_id       VARCHAR(255),
      kind             VARCHAR(50)  NOT NULL DEFAULT 'contacts',
      status           VARCHAR(50)  NOT NULL DEFAULT 'queued',
      cursor           TEXT,
      page             INTEGER      NOT NULL DEFAULT 0,
      page_size        INTEGER      NOT NULL DEFAULT 100,
      total_estimate   INTEGER,
      processed_count  INTEGER      NOT NULL DEFAULT 0,
      upserted_count   INTEGER      NOT NULL DEFAULT 0,
      failed_count     INTEGER      NOT NULL DEFAULT 0,
      last_error       TEXT,
      attempt_count    INTEGER      NOT NULL DEFAULT 0,
      triggered_by     VARCHAR(50)  NOT NULL DEFAULT 'install',
      lease_token      UUID,
      lease_expires_at TIMESTAMPTZ,
      next_run_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      started_at       TIMESTAMPTZ,
      completed_at     TIMESTAMPTZ
    )
  `;

  console.log(`  [2/5] CREATE UNIQUE INDEX ghl_backfill_jobs_active_unique (partial)`);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ghl_backfill_jobs_active_unique
      ON ghl_backfill_jobs (resource_id, kind)
      WHERE status IN ('queued', 'running')
  `;

  console.log(`  [3/5] CREATE INDEX idx_ghl_backfill_jobs_pickup`);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ghl_backfill_jobs_pickup
      ON ghl_backfill_jobs (status, next_run_at)
  `;

  console.log(`  [4/5] CREATE INDEX idx_ghl_backfill_jobs_resource`);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ghl_backfill_jobs_resource
      ON ghl_backfill_jobs (resource_id)
  `;

  console.log(`  [5/5] CREATE INDEX idx_ghl_backfill_jobs_location`);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ghl_backfill_jobs_location
      ON ghl_backfill_jobs (location_id)
  `;

  // AFTER verification.
  const afterCols = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ghl_backfill_jobs'
    ORDER BY ordinal_position
  `) as { column_name: string }[];
  const afterIdx = (await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'ghl_backfill_jobs'
    ORDER BY indexname
  `) as { indexname: string }[];

  console.log(`\n[migration] Verification:`);
  console.log(`  columns (${afterCols.length}): ${afterCols.map((c) => c.column_name).join(", ")}`);
  console.log(`  indexes (${afterIdx.length}): ${afterIdx.map((i) => i.indexname).join(", ")}`);

  const expectedIdx = [
    "ghl_backfill_jobs_active_unique",
    "ghl_backfill_jobs_pkey",
    "idx_ghl_backfill_jobs_location",
    "idx_ghl_backfill_jobs_pickup",
    "idx_ghl_backfill_jobs_resource",
  ];
  const missing = expectedIdx.filter(
    (e) => !afterIdx.some((i) => i.indexname === e),
  );
  if (missing.length > 0) {
    console.log(`  ❌ Missing indexes: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`  ✅ All expected indexes present.`);
  console.log(`\n[migration] Done — ghl_backfill_jobs table ready.`);
}

main().catch((e) => {
  console.error("[migration] FAILED:", e.message);
  process.exit(1);
});
