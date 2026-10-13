/**
 * Phase 3 — wire up Stripe Checkout for Fundraising Campaigns.
 *   1. manual_donation.fundraising_campaign_id — links a Stripe-collected
 *      donation back to the fundraising_campaign it was made on (donations
 *      collected via the old Crowded pipeline keep using crowded_form_id;
 *      this is the Stripe-only equivalent).
 *   2. stripe_connections.webhook_secret_enc / webhook_endpoint_id — the
 *      per-tenant Stripe webhook signing secret (encrypted at rest, same
 *      AES-256-GCM scheme as secret_key_enc) + the registered endpoint id,
 *      so the fundraising webhook route can verify signatures per tenant.
 * Additive + idempotent. Safe re-run.
 */
import fs from "node:fs";
import postgres from "postgres";
const url = fs.readFileSync(".env", "utf8").split("\n")
  .find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { ssl: "require", max: 1 });

try {
  await sql`ALTER TABLE manual_donation ADD COLUMN IF NOT EXISTS fundraising_campaign_id INTEGER`;
  await sql`CREATE INDEX IF NOT EXISTS manual_donation_fundraising_campaign_id_idx ON manual_donation (fundraising_campaign_id)`;
  console.log("✅ manual_donation.fundraising_campaign_id (integer, indexed)");

  await sql`ALTER TABLE stripe_connections ADD COLUMN IF NOT EXISTS webhook_secret_enc TEXT`;
  await sql`ALTER TABLE stripe_connections ADD COLUMN IF NOT EXISTS webhook_endpoint_id VARCHAR(255)`;
  console.log("✅ stripe_connections.webhook_secret_enc (text) + webhook_endpoint_id (varchar)");

  const cols1 = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'manual_donation' AND column_name = 'fundraising_campaign_id'
  `;
  const cols2 = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'stripe_connections' AND column_name IN ('webhook_secret_enc','webhook_endpoint_id')
    ORDER BY column_name
  `;
  console.log("\nVerify:", [...cols1, ...cols2]);
} finally {
  await sql.end({ timeout: 5 });
}
