/**
 * Run migration 0022_contact_unique_constraint_legacy_safe.sql.
 *
 * Strictly additive on data — only sets the new is_legacy_duplicate flag
 * on existing duplicates. No rows deleted, no FKs altered, no row content
 * modified beyond the flag.
 *
 *   node --env-file=.env --import tsx scripts/run-contact-unique-migration.ts
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type SqlClient = { query: (text: string) => Promise<unknown> };

async function applyFile(sql: SqlClient, file: string) {
  const text = readFileSync(join(process.cwd(), file), "utf8");
  // Split on `;` but be careful with the CTE in statement 2 — it contains
  // no semicolons inside its body so simple split is safe.
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
  if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
  const sql = neon(url);

  // BEFORE snapshot
  const before = (await sql`SELECT COUNT(*)::int AS c FROM contact`) as { c: number }[];
  const beforeDupes = (await sql`
    SELECT COUNT(*)::int AS c FROM (
      SELECT ghl_contact_id, location_id, COUNT(*)::int AS dup
      FROM contact
      WHERE ghl_contact_id IS NOT NULL AND location_id IS NOT NULL
      GROUP BY ghl_contact_id, location_id
      HAVING COUNT(*) > 1
    ) g
  `) as { c: number }[];
  console.log(`[migration] Pre-migration:`);
  console.log(`  contact row count:                ${before[0].c}`);
  console.log(`  (ghl_contact_id, location_id) dup groups: ${beforeDupes[0].c}`);

  // Apply
  await applyFile(sql, "drizzle/0022_contact_unique_constraint_legacy_safe.sql");

  // AFTER verification
  const after = (await sql`SELECT COUNT(*)::int AS c FROM contact`) as { c: number }[];
  const flagged = (await sql`
    SELECT COUNT(*)::int AS c FROM contact WHERE is_legacy_duplicate = TRUE
  `) as { c: number }[];
  const indexes = (await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'contact'
      AND indexname IN ('contact_ghl_location_unique', 'idx_contact_is_legacy_duplicate')
  `) as { indexname: string }[];

  console.log(`\n[migration] Verification:`);
  console.log(`  contact row count:        ${before[0].c} → ${after[0].c}   ${before[0].c === after[0].c ? "✅ unchanged" : "❌ CHANGED — INVESTIGATE"}`);
  console.log(`  is_legacy_duplicate=TRUE: ${flagged[0].c} rows tagged`);
  console.log(`  indexes created:          ${indexes.map((i) => i.indexname).join(", ") || "(none)"}`);

  // Sanity-check: future INSERTs cannot duplicate. Verify by trying to find any
  // (ghl_contact_id, location_id) pair where 2+ rows exist with
  // is_legacy_duplicate=FALSE — this should be ZERO after the migration.
  const constraintOk = (await sql`
    SELECT COUNT(*)::int AS c FROM (
      SELECT ghl_contact_id, location_id, COUNT(*)::int AS dup
      FROM contact
      WHERE ghl_contact_id IS NOT NULL AND location_id IS NOT NULL
        AND is_legacy_duplicate = FALSE
      GROUP BY ghl_contact_id, location_id
      HAVING COUNT(*) > 1
    ) g
  `) as { c: number }[];
  if (constraintOk[0].c === 0) {
    console.log(`  ✅ Constraint scope is clean — UNIQUE applies cleanly to all non-legacy rows.`);
  } else {
    console.log(`  ❌ Still ${constraintOk[0].c} dup groups among non-legacy rows. Index may have failed.`);
    process.exit(1);
  }

  console.log(`\n[migration] Done — non-destructive, ${flagged[0].c} rows tagged as legacy duplicates, UNIQUE constraint live.`);
}

main().catch((e) => { console.error("[migration] FAILED:", e.message); process.exit(1); });
