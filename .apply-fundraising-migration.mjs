/**
 * Apply the fundraising_campaign table (Fundraising/Campaign platform).
 * Additive + idempotent. Safe re-run. Does NOT touch existing features.
 */
import fs from "node:fs";
import postgres from "postgres";
const url = fs.readFileSync(".env", "utf8").split("\n")
  .find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { ssl: "require", max: 1 });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS fundraising_campaign (
      id SERIAL PRIMARY KEY,
      location_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      story TEXT,
      goal_cents INTEGER,
      cover_image_url TEXT,
      primary_color VARCHAR(9),
      accent_color VARCHAR(9),
      background_color VARCHAR(9),
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      crowded_form_id INTEGER,
      campaign_id INTEGER,
      parent_campaign_id INTEGER,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("✅ CREATE TABLE fundraising_campaign (idempotent)");

  await sql`CREATE INDEX IF NOT EXISTS fundraising_campaign_location_idx ON fundraising_campaign (location_id)`;
  await sql`CREATE INDEX IF NOT EXISTS fundraising_campaign_parent_idx ON fundraising_campaign (parent_campaign_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS fundraising_campaign_slug_unique ON fundraising_campaign (location_id, slug)`;
  console.log("✅ indexes (location, parent, unique slug)");

  // Attach a Crowded form back to its campaign (optional reverse link).
  await sql`ALTER TABLE crowded_forms ADD COLUMN IF NOT EXISTS fundraising_campaign_id INTEGER`;
  console.log("✅ crowded_forms.fundraising_campaign_id (nullable)");

  // Progress bars sum donations grouped by crowded_form_id — index it.
  await sql`CREATE INDEX IF NOT EXISTS manual_donation_crowded_form_id_idx ON manual_donation (crowded_form_id)`;
  console.log("✅ INDEX manual_donation (crowded_form_id) for progress bars");

  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'fundraising_campaign'
    ORDER BY ordinal_position
  `;
  console.log("\nSchema after:");
  for (const c of cols) console.log(`   ${c.column_name.padEnd(22)} ${c.data_type.padEnd(28)} nullable=${c.is_nullable}`);
} finally {
  await sql.end({ timeout: 5 });
}
