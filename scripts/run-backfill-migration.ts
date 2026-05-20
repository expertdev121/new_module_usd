/**
 * Run migration 0023_ghl_backfill_jobs.sql.
 *
 * Creates the ghl_backfill_jobs queue table + indexes. Strictly additive —
 * no existing tables touched, no data modified.
 *
 *   node --env-file=.env --import tsx scripts/run-backfill-migration.ts
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type SqlClient = { query: (text: string) => Promise<unknown> };

async function applyFile(sql: SqlClient, file: string) {
  const text = readFileSync(join(process.cwd(), file), "utf8");
  const statements = text
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`\n[migration] ${file} — ${statements.length} statement(s)`);
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    console.log(`  [${i + 1}/${statements.length}] ${stmt.split("\n")[0].slice(0, 100)}...`);
    await sql.query(stmt);
  }
}

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

  await applyFile(sql, "drizzle/0023_ghl_backfill_jobs.sql");

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
