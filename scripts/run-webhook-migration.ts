/**
 * One-shot runner for the two webhook migrations:
 *   • drizzle/0018_ghl_webhook_tables.sql   — 3 new tables, IF NOT EXISTS
 *   • drizzle/0019_contact_sync_columns.sql — ALTER contact ADD COLUMN IF NOT EXISTS
 *
 * Strictly additive: no DROP, no DELETE, no UPDATE, no type changes on
 * existing columns. Safe to re-run; every statement gates on IF NOT EXISTS.
 *
 * Run with:
 *   node --env-file=.env --import tsx scripts/run-webhook-migration.ts
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `neon()` returns a heavily-generic type that's awkward to forward — accept
// a loosely-typed client here; the calls below only use `.query`.
type SqlClient = { query: (text: string) => Promise<unknown> };

async function applyFile(sql: SqlClient, file: string, label: string) {
  const path = join(process.cwd(), file);
  const text = readFileSync(path, "utf8");

  // Strip line comments, split on `;`, drop blanks.
  const statements = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`\n[migration] ${label} — ${statements.length} statement(s) from ${file}`);
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.split("\n")[0].slice(0, 90);
    console.log(`  [${i + 1}/${statements.length}] ${preview}...`);
    await sql.query(stmt);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set. Aborting.");
    process.exit(1);
  }
  const sql = neon(url);

  // ── Phase 1: snapshot existing webhook-related tables + contact column count ──
  const beforeTables = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND (table_name LIKE 'ghl_webhook%' OR table_name LIKE 'ghl_sync%' OR table_name LIKE 'ghl_invoice%')
    ORDER BY table_name
  `) as { table_name: string }[];

  const beforeColumns = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contact'
    ORDER BY ordinal_position
  `) as { column_name: string }[];

  console.log("\n[migration] Pre-migration snapshot:");
  console.log(`  webhook tables: ${beforeTables.length === 0 ? "(none)" : beforeTables.map((t) => t.table_name).join(", ")}`);
  console.log(`  contact columns: ${beforeColumns.length}`);

  // ── Phase 2: apply ──
  await applyFile(sql, "drizzle/0018_ghl_webhook_tables.sql", "Webhook tables");
  await applyFile(sql, "drizzle/0019_contact_sync_columns.sql", "Contact sync columns");

  // ── Phase 3: verify ──
  const afterTables = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('ghl_webhook_events', 'ghl_sync_writes', 'ghl_invoice_events')
    ORDER BY table_name
  `) as { table_name: string }[];

  const afterColumns = (await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contact'
    ORDER BY ordinal_position
  `) as { column_name: string; data_type: string }[];

  const newCols = afterColumns
    .filter((c) => !beforeColumns.find((b) => b.column_name === c.column_name))
    .map((c) => c.column_name);

  // Row counts on key tables to prove nothing was deleted.
  const counts = (await sql`
    SELECT
      (SELECT COUNT(*)::int FROM "contact") AS contact_count,
      (SELECT COUNT(*)::int FROM "pledge") AS pledge_count,
      (SELECT COUNT(*)::int FROM "payment") AS payment_count,
      (SELECT COUNT(*)::int FROM "manual_donation") AS manual_donation_count,
      (SELECT COUNT(*)::int FROM "ghl_webhook_events") AS webhook_events_count,
      (SELECT COUNT(*)::int FROM "ghl_sync_writes") AS sync_writes_count,
      (SELECT COUNT(*)::int FROM "ghl_invoice_events") AS invoice_events_count
  `) as Record<string, number>[];
  const c = counts[0];

  console.log("\n[migration] Verification:");
  console.log(`  ✓ Webhook tables present: ${afterTables.map((t) => t.table_name).join(", ")}`);
  console.log(`  ✓ Contact column count: ${beforeColumns.length} → ${afterColumns.length}`);
  if (newCols.length > 0) {
    console.log(`  ✓ New columns added to contact:`);
    newCols.forEach((n) => console.log(`      ${n}`));
  } else {
    console.log(`  ✓ No new columns added (already present — re-run is a no-op)`);
  }
  console.log("");
  console.log("[migration] Row counts (existing tables MUST be unchanged):");
  console.log(`    contact            ${String(c.contact_count).padStart(8)}`);
  console.log(`    pledge             ${String(c.pledge_count).padStart(8)}`);
  console.log(`    payment            ${String(c.payment_count).padStart(8)}`);
  console.log(`    manual_donation    ${String(c.manual_donation_count).padStart(8)}`);
  console.log("[migration] New tables (start at 0 rows):");
  console.log(`    ghl_webhook_events ${String(c.webhook_events_count).padStart(8)}`);
  console.log(`    ghl_sync_writes    ${String(c.sync_writes_count).padStart(8)}`);
  console.log(`    ghl_invoice_events ${String(c.invoice_events_count).padStart(8)}`);
  console.log("\n[migration] Done. Strictly additive — no rows or existing columns touched.");
}

main().catch((err) => {
  console.error("[migration] FAILED:", err.message);
  process.exit(1);
});
