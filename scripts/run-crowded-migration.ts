/**
 * Apply Crowded integration migrations:
 *   0026 — new tables (crowded_connections, crowded_forms,
 *          crowded_webhook_events, crowded_payment_plans)
 *   0027 — extend manual_donation with crowded_* columns
 *   0028 — add contact.crowded_contact_id
 *
 *   node --env-file=.env --import tsx scripts/run-crowded-migration.ts
 *
 * Strictly additive across all three. Idempotent (CREATE/ALTER … IF NOT EXISTS).
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function applyFile(sql: ReturnType<typeof neon>, file: string) {
  const text = readFileSync(join(process.cwd(), file), "utf8");
  // Strip line-leading comments + split on `;`. The Crowded migrations have
  // no semicolons inside their statement bodies so this is safe.
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

  await applyFile(sql, "drizzle/0026_crowded_tables.sql");
  await applyFile(sql, "drizzle/0027_manual_donation_crowded.sql");
  await applyFile(sql, "drizzle/0028_contact_crowded_id.sql");

  // Verification.
  const tables = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'crowded_connections',
        'crowded_forms',
        'crowded_webhook_events',
        'crowded_payment_plans'
      )
    ORDER BY table_name
  `) as { table_name: string }[];

  const cols = (await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'manual_donation' AND column_name LIKE 'crowded_%')
        OR (table_name = 'contact' AND column_name = 'crowded_contact_id')
      )
    ORDER BY table_name, column_name
  `) as { table_name: string; column_name: string }[];

  const idx = (await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'crowded_connections_location_unique',
        'crowded_forms_collection_unique',
        'crowded_webhook_events_event_id_unique',
        'crowded_payment_plans_plan_unique',
        'manual_donation_crowded_location_unique',
        'contact_crowded_location_unique'
      )
    ORDER BY indexname
  `) as { indexname: string }[];

  console.log("\n[migration] Verification:");
  console.log(`  tables  (${tables.length}/4): ${tables.map((t) => t.table_name).join(", ")}`);
  console.log(`  alters  (${cols.length}/6): ${cols.map((c) => `${c.table_name}.${c.column_name}`).join(", ")}`);
  console.log(`  indexes (${idx.length}/6): ${idx.map((i) => i.indexname).join(", ")}`);

  if (tables.length !== 4 || cols.length !== 6 || idx.length !== 6) {
    console.log("\n  ❌ Missing tables / columns / indexes — investigate above.");
    process.exit(1);
  }
  console.log("\n  ✅ All Crowded schema present.");
  console.log("\n[migration] Done — Crowded integration ready for code.");
}

main().catch((e) => {
  console.error("[migration] FAILED:", e.message);
  process.exit(1);
});
