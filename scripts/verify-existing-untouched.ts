/**
 * Quick read-only sanity check: prints row counts for key existing tables
 * so we can verify the OAuth migration left them untouched.
 *
 * Run with: node --env-file=.env --import tsx scripts/verify-existing-untouched.ts
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }
  const sql = neon(url);

  const tables = [
    "contact",
    "pledge",
    "payment",
    "manual_donation",
    "campaign",
    "user",
    "tag",
    "contact_tags",
    "category",
    "ghl_oauth_tokens",
  ];

  console.log("\n[verify] Row counts (read-only) — confirming existing tables are intact:\n");
  for (const t of tables) {
    try {
      const rows = (await sql.query(`SELECT COUNT(*)::int AS c FROM "${t}"`)) as {
        c: number;
      }[];
      console.log(`  ${t.padEnd(22)} ${String(rows[0].c).padStart(8)} rows`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ${t.padEnd(22)} (error: ${message.slice(0, 60)})`);
    }
  }
  console.log("");
}

main().catch((err) => {
  console.error("[verify] FAILED:", err.message);
  process.exit(1);
});
