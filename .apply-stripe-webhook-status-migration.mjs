/**
 * stripe_connections.webhook_registration_error — surfaces *why* the
 * per-tenant Stripe webhook failed to auto-register (or was skipped, e.g.
 * non-https app URL) so the admin UI isn't silently blind to it. Null means
 * either never attempted or last attempt succeeded (webhook_endpoint_id set).
 * Additive + idempotent. Safe re-run.
 */
import fs from "node:fs";
import postgres from "postgres";
const url = fs.readFileSync(".env", "utf8").split("\n")
  .find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { ssl: "require", max: 1 });

try {
  await sql`ALTER TABLE stripe_connections ADD COLUMN IF NOT EXISTS webhook_registration_error TEXT`;
  console.log("✅ stripe_connections.webhook_registration_error (text)");

  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'stripe_connections' AND column_name = 'webhook_registration_error'
  `;
  console.log("\nVerify:", cols);
} finally {
  await sql.end({ timeout: 5 });
}
