/**
 * Enforce the identity model at DB level:
 *   UNIQUE (location_id, constituents_id) WHERE both are non-null/non-empty.
 * Data was verified clean (0 duplicate pairs) before adding.
 * Idempotent.
 */
import fs from "node:fs";
import postgres from "postgres";
const url = fs.readFileSync(".env","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g,"");
const sql = postgres(url,{ssl:"require",max:1});
try {
  // Pre-check: any duplicate (location_id, constituents_id) pairs?
  const dups = await sql`
    SELECT location_id, constituents_id, COUNT(*)::int AS n
    FROM contact
    WHERE constituents_id IS NOT NULL AND constituents_id <> '' AND location_id IS NOT NULL
    GROUP BY location_id, constituents_id HAVING COUNT(*) > 1
    LIMIT 10
  `;
  if (dups.length) {
    console.log("❌ Cannot add unique index — duplicate pairs exist:");
    for (const d of dups) console.log("  ", d.location_id, d.constituents_id, "×", d.n);
    process.exit(1);
  }
  console.log("✅ pre-check clean (0 duplicate pairs)");
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS contact_constituents_location_unique
    ON contact (location_id, constituents_id)
    WHERE constituents_id IS NOT NULL AND constituents_id <> '' AND location_id IS NOT NULL
  `;
  console.log("✅ contact_constituents_location_unique created");
} finally { await sql.end({timeout:5}); }
