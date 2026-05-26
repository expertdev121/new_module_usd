/**
 * Run migration 0025_manual_donation_ghl_columns.sql.
 *
 *   node --env-file=.env --import tsx scripts/run-payment-pull-migration.ts
 *
 * Strictly additive — 4 nullable columns + 3 indexes. Idempotent.
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const sql = neon(url);

  console.log("\n[migration] Running statements...");

  console.log("  [1/4] ALTER manual_donation ADD ghl columns");
  await sql`
    ALTER TABLE manual_donation
      ADD COLUMN IF NOT EXISTS ghl_source         VARCHAR(50),
      ADD COLUMN IF NOT EXISTS ghl_resource_id    VARCHAR(255),
      ADD COLUMN IF NOT EXISTS ghl_payment_method VARCHAR(50),
      ADD COLUMN IF NOT EXISTS location_id        TEXT
  `;

  console.log("  [2/4] CREATE UNIQUE INDEX manual_donation_ghl_location_unique (partial)");
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS manual_donation_ghl_location_unique
      ON manual_donation (location_id, ghl_resource_id)
      WHERE location_id IS NOT NULL AND ghl_resource_id IS NOT NULL
  `;

  console.log("  [3/4] CREATE INDEX idx_manual_donation_ghl_source");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_manual_donation_ghl_source
      ON manual_donation (ghl_source)
  `;

  console.log("  [4/4] CREATE INDEX idx_manual_donation_location_id");
  await sql`
    CREATE INDEX IF NOT EXISTS idx_manual_donation_location_id
      ON manual_donation (location_id)
  `;

  // Verify.
  const cols = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manual_donation'
      AND column_name IN ('ghl_source', 'ghl_resource_id', 'ghl_payment_method', 'location_id')
    ORDER BY column_name
  `) as { column_name: string }[];
  const idx = (await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'manual_donation'
      AND indexname IN (
        'manual_donation_ghl_location_unique',
        'idx_manual_donation_ghl_source',
        'idx_manual_donation_location_id'
      )
    ORDER BY indexname
  `) as { indexname: string }[];

  console.log("\n[migration] Verification:");
  console.log(`  columns added (${cols.length}/4): ${cols.map((c) => c.column_name).join(", ")}`);
  console.log(`  indexes (${idx.length}/3): ${idx.map((i) => i.indexname).join(", ")}`);
  if (cols.length !== 4 || idx.length !== 3) {
    console.log("  ❌ Missing columns or indexes.");
    process.exit(1);
  }
  console.log("  ✅ All expected columns + indexes present.");
  console.log("\n[migration] Done — payment-pull columns ready.");
}

main().catch((e) => {
  console.error("[migration] FAILED:", e.message);
  process.exit(1);
});
