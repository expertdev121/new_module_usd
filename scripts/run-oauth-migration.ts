/**
 * One-shot migration runner for drizzle/0017_ghl_oauth_tokens.sql.
 *
 * Strictly additive: every statement uses IF NOT EXISTS, so re-running is
 * safe. Nothing in this script touches any existing table.
 *
 * Run with:
 *   node --env-file=.env -r esbuild-register scripts/run-oauth-migration.ts
 * or:
 *   npx tsx scripts/run-oauth-migration.ts
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set. Aborting.");
    process.exit(1);
  }

  const sql = neon(url);

  // === Phase 1: read-only check ===
  // Confirm we're not about to clobber anything unexpected.
  const beforeRows = (await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE 'ghl_oauth%'
    ORDER BY table_name
  `) as { table_name: string }[];

  console.log(`\n[migration] Tables matching 'ghl_oauth*' before migration:`);
  if (beforeRows.length === 0) {
    console.log("  (none — fresh install)");
  } else {
    beforeRows.forEach((r) => console.log(`  • ${r.table_name}`));
  }

  // === Phase 2: load and split the migration ===
  const migrationPath = join(process.cwd(), "drizzle/0017_ghl_oauth_tokens.sql");
  const sqlText = readFileSync(migrationPath, "utf8");

  // Strip line comments, split on `;`, drop empty statements. Crude but
  // sufficient for our single-table migration which contains no semicolons
  // inside string literals.
  const statements = sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`\n[migration] Executing ${statements.length} statement(s)...`);
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.split("\n")[0].slice(0, 90);
    console.log(`  [${i + 1}/${statements.length}] ${preview}...`);
    await sql.query(stmt);
  }

  // === Phase 3: verify ===
  const afterRows = (await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ghl_oauth_tokens'
  `) as { table_name: string }[];

  if (afterRows.length !== 1) {
    console.error("\n[migration] VERIFY FAILED: ghl_oauth_tokens not present after run.");
    process.exit(1);
  }

  const cols = (await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ghl_oauth_tokens'
    ORDER BY ordinal_position
  `) as { column_name: string; data_type: string }[];

  const idxRows = (await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'ghl_oauth_tokens'
    ORDER BY indexname
  `) as { indexname: string }[];

  const rowCount = (await sql`SELECT COUNT(*)::int AS c FROM ghl_oauth_tokens`) as {
    c: number;
  }[];

  console.log(`\n[migration] ✓ Table 'ghl_oauth_tokens' created.`);
  console.log(`[migration] ✓ ${cols.length} columns:`);
  cols.forEach((c) => console.log(`    ${c.column_name.padEnd(24)} ${c.data_type}`));
  console.log(`[migration] ✓ ${idxRows.length} indexes:`);
  idxRows.forEach((i) => console.log(`    ${i.indexname}`));
  console.log(`[migration] ✓ Row count: ${rowCount[0].c} (expect 0)`);
  console.log(`\n[migration] Done. No existing tables were touched.`);
}

main().catch((err) => {
  console.error("[migration] FAILED:", err.message);
  process.exit(1);
});
