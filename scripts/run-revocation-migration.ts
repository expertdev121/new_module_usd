/**
 * One-shot runner for drizzle/0020_oauth_revocation_and_status.sql.
 * Strictly additive: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
 * Safe to re-run.
 *
 *   node --env-file=.env --import tsx scripts/run-revocation-migration.ts
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
    console.log(`  [${i + 1}/${statements.length}] ${stmt.split("\n")[0].slice(0, 90)}...`);
    await sql.query(stmt);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL not set."); process.exit(1); }
  const sql = neon(url);

  const beforeCols = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ghl_oauth_tokens'
    ORDER BY ordinal_position`) as { column_name: string }[];
  console.log(`[migration] ghl_oauth_tokens columns before: ${beforeCols.length}`);

  await applyFile(sql, "drizzle/0020_oauth_revocation_and_status.sql");

  const afterCols = (await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ghl_oauth_tokens'
    ORDER BY ordinal_position`) as { column_name: string; data_type: string }[];

  const newCols = afterCols.filter(c => !beforeCols.find(b => b.column_name === c.column_name));

  const tokenCount = (await sql`SELECT COUNT(*)::int AS c FROM ghl_oauth_tokens`) as { c: number }[];

  console.log(`\n[migration] Verification:`);
  console.log(`  ghl_oauth_tokens columns: ${beforeCols.length} → ${afterCols.length}`);
  if (newCols.length > 0) {
    newCols.forEach(c => console.log(`    ✓ NEW: ${c.column_name} (${c.data_type})`));
  } else {
    console.log(`  (no new columns — already present, re-run is a no-op)`);
  }
  console.log(`  ghl_oauth_tokens row count: ${tokenCount[0].c} (must be unchanged)`);
  console.log(`\n[migration] Done. Strictly additive — no rows or existing columns touched.`);
}

main().catch((err) => { console.error("[migration] FAILED:", err.message); process.exit(1); });
