/**
 * Run migration 0024_offboard_columns.sql.
 *
 *   node --env-file=.env --import tsx scripts/run-offboard-migration.ts
 *
 * Strictly additive: 2 nullable columns + 2 indexes. No data writes.
 * Idempotent — safe to re-run.
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

  console.log("  [1/4] ALTER user ADD deleted_at");
  await sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;

  console.log("  [2/4] CREATE INDEX idx_user_deleted_at");
  await sql`CREATE INDEX IF NOT EXISTS idx_user_deleted_at ON "user" (deleted_at)`;

  console.log("  [3/4] ALTER ghl_oauth_tokens ADD data_soft_deleted_at");
  await sql`ALTER TABLE ghl_oauth_tokens ADD COLUMN IF NOT EXISTS data_soft_deleted_at TIMESTAMPTZ`;

  console.log("  [4/4] CREATE INDEX idx_ghl_oauth_tokens_data_soft_deleted_at");
  await sql`CREATE INDEX IF NOT EXISTS idx_ghl_oauth_tokens_data_soft_deleted_at ON ghl_oauth_tokens (data_soft_deleted_at)`;

  // Verify.
  const cols = (await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'user' AND column_name = 'deleted_at')
        OR (table_name = 'ghl_oauth_tokens' AND column_name = 'data_soft_deleted_at')
      )
    ORDER BY table_name, column_name
  `) as { table_name: string; column_name: string }[];
  console.log("\n[migration] Verification:");
  for (const c of cols) console.log(`  ✅ ${c.table_name}.${c.column_name}`);

  if (cols.length !== 2) {
    console.log(`  ❌ Expected 2 columns, found ${cols.length}.`);
    process.exit(1);
  }
  console.log("\n[migration] Done — offboarding columns ready.");
}

main().catch((e) => {
  console.error("[migration] FAILED:", e.message);
  process.exit(1);
});
