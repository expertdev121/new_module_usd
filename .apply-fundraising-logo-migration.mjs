/**
 * Add fundraising_campaign.logo_url (Campaign wizard logo field, shown on the
 * public page's identity row). Additive + idempotent. Safe re-run.
 */
import fs from "node:fs";
import postgres from "postgres";
const url = fs.readFileSync(".env", "utf8").split("\n")
  .find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { ssl: "require", max: 1 });

try {
  await sql`ALTER TABLE fundraising_campaign ADD COLUMN IF NOT EXISTS logo_url TEXT`;
  console.log("✅ fundraising_campaign.logo_url (text, nullable)");

  const cols = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'fundraising_campaign'
    ORDER BY ordinal_position
  `;
  console.log("\nSchema after:");
  for (const c of cols) console.log(`   ${c.column_name.padEnd(22)} ${c.data_type.padEnd(28)} nullable=${c.is_nullable}`);
} finally {
  await sql.end({ timeout: 5 });
}
