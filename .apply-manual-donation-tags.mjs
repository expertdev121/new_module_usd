/**
 * Additive columns on manual_donation:
 *  - household_id INTEGER (nullable FK → household.id)
 *  - import_source VARCHAR(32) — provenance tag ('application', 'csv_upload',
 *    'ghl_webhook', 'crowded', 'claude_code'). NULL for pre-existing rows.
 * Idempotent.
 */
import fs from "node:fs";
import postgres from "postgres";
const url = fs.readFileSync(".env","utf8").split("\n")
  .find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g,"");
const sql = postgres(url,{ssl:"require",max:1});
try {
  await sql`ALTER TABLE manual_donation ADD COLUMN IF NOT EXISTS household_id  INTEGER`;
  await sql`ALTER TABLE manual_donation ADD COLUMN IF NOT EXISTS import_source VARCHAR(32)`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='manual_donation_household_fk') THEN
        ALTER TABLE manual_donation
          ADD CONSTRAINT manual_donation_household_fk
          FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE SET NULL NOT VALID;
      END IF;
    END $$;
  `;
  await sql`CREATE INDEX IF NOT EXISTS manual_donation_household_id_idx  ON manual_donation (household_id)`;
  await sql`CREATE INDEX IF NOT EXISTS manual_donation_import_source_idx ON manual_donation (import_source)`;
  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='manual_donation' AND column_name IN ('household_id','import_source')
  `;
  console.log("✅ manual_donation columns:");
  for (const c of cols) console.log(`   ${c.column_name.padEnd(16)} ${c.data_type}`);
} finally { await sql.end({timeout:5}); }
