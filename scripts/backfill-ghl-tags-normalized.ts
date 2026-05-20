/**
 * Backfill: for every contact that has GHL-sync'd tags in the JSONB
 * `tags` column but no entries in the normalized `contact_tags` table,
 * mirror the JSONB tags into the normalized model so the UI can show
 * them.
 *
 * Strictly additive — no data deleted, only inserts into `tag` and
 * `contact_tags`. Idempotent: re-running is a no-op.
 *
 * Run with:
 *   node --env-file=.env --import tsx scripts/backfill-ghl-tags-normalized.ts
 */
import { neon } from "@neondatabase/serverless";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { syncContactTagsToNormalized } from "@/lib/ghl/sync-contact-tags";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const directSql = neon(url);

  // Find all contacts with non-empty JSONB tags. We bypass Drizzle for the
  // query because the JSONB array filter is awkward to express through it.
  const rows = (await directSql`
    SELECT id, location_id, tags
    FROM contact
    WHERE tags IS NOT NULL
      AND jsonb_typeof(tags) = 'array'
      AND jsonb_array_length(tags) > 0
      AND location_id IS NOT NULL
    ORDER BY id
  `) as Array<{ id: number; location_id: string; tags: string[] }>;

  console.log(`[backfill] Found ${rows.length} contact(s) with JSONB tags to sync.\n`);

  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await syncContactTagsToNormalized(row.id, row.location_id, row.tags);
      synced++;
      if (synced % 50 === 0) {
        console.log(`  ${synced}/${rows.length} synced...`);
      }
    } catch (err) {
      failed++;
      console.error(
        `  ✗ contact id=${row.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`\n[backfill] Done. ${synced} synced, ${failed} failed, total ${rows.length}.`);

  // Verify by counting how many contacts now have normalized tags.
  const verified = (await directSql`
    SELECT COUNT(DISTINCT c.id)::int AS c
    FROM contact c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE c.tags IS NOT NULL
      AND jsonb_typeof(c.tags) = 'array'
      AND jsonb_array_length(c.tags) > 0
  `) as { c: number }[];
  console.log(`[backfill] Contacts with normalized tags now: ${verified[0].c}`);
}

// Keep ESLint happy: explicit use of imported helpers we don't otherwise reference.
void eq;
void sql;
void db;

main().catch((e) => {
  console.error("[backfill] FAILED:", e.message);
  process.exit(1);
});
