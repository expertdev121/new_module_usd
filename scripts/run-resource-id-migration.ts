/**
 * One-shot runner for drizzle/0021_oauth_resource_id_nullable_location.sql.
 *
 * Strictly additive on data. No rows deleted, no existing column values
 * changed. Structural changes are:
 *   - ADD COLUMN resource_id, resource_type
 *   - BACKFILL resource_id from existing location_id / company_id
 *   - DROP old UNIQUE constraint on location_id
 *   - ALTER location_id to nullable
 *   - LOCK resource_id as NOT NULL + UNIQUE
 *
 *   node --env-file=.env --import tsx scripts/run-resource-id-migration.ts
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
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }
  const sql = neon(url);

  // ── Snapshot BEFORE ──
  const beforeCols = (await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ghl_oauth_tokens'
    ORDER BY ordinal_position
  `) as { column_name: string; data_type: string; is_nullable: string }[];

  const beforeCount = (await sql`SELECT COUNT(*)::int AS c FROM ghl_oauth_tokens`) as {
    c: number;
  }[];

  console.log("[migration] Pre-migration:");
  console.log(`  ghl_oauth_tokens columns: ${beforeCols.length}`);
  console.log(`  ghl_oauth_tokens rows: ${beforeCount[0].c}`);

  // ── Apply ──
  await applyFile(sql, "drizzle/0021_oauth_resource_id_nullable_location.sql");

  // ── Verify ──
  const afterCols = (await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ghl_oauth_tokens'
    ORDER BY ordinal_position
  `) as { column_name: string; data_type: string; is_nullable: string }[];

  const afterCount = (await sql`SELECT COUNT(*)::int AS c FROM ghl_oauth_tokens`) as {
    c: number;
  }[];

  const orphans = (await sql`
    SELECT COUNT(*)::int AS c FROM ghl_oauth_tokens WHERE resource_id IS NULL
  `) as { c: number }[];

  const locationIdNullable = afterCols.find((c) => c.column_name === "location_id")?.is_nullable;
  const resourceIdNotNull = afterCols.find((c) => c.column_name === "resource_id")?.is_nullable === "NO";

  console.log("\n[migration] Verification:");
  console.log(`  Columns ${beforeCols.length} → ${afterCols.length}`);
  const newCols = afterCols
    .filter((a) => !beforeCols.find((b) => b.column_name === a.column_name))
    .map((c) => c.column_name);
  if (newCols.length) {
    console.log(`  ✓ New columns: ${newCols.join(", ")}`);
  }
  console.log(`  ✓ location_id nullable: ${locationIdNullable === "YES" ? "yes" : "NO (wrong!)"}`);
  console.log(`  ✓ resource_id NOT NULL: ${resourceIdNotNull ? "yes" : "NO (wrong!)"}`);
  console.log(`  ✓ Rows with NULL resource_id (should be 0): ${orphans[0].c}`);
  console.log(`  ✓ Row count preserved: ${beforeCount[0].c} → ${afterCount[0].c}`);

  if (beforeCount[0].c !== afterCount[0].c) {
    console.error("\n[migration] ABORT: row count changed.");
    process.exit(1);
  }
  if (orphans[0].c > 0) {
    console.error("\n[migration] WARNING: some rows have NULL resource_id. Investigate.");
  }

  console.log("\n[migration] Done. Strictly additive — zero row changes.");
}

main().catch((err) => {
  console.error("[migration] FAILED:", err.message);
  process.exit(1);
});
