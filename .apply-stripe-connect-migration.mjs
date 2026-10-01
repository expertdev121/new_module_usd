/**
 * Apply the stripe_connections table (Stripe Connect settings, Phase 1 of
 * the Fundraising Campaigns Stripe integration). Additive + idempotent.
 * Safe re-run. Does NOT touch existing features.
 */
import fs from "node:fs";
import postgres from "postgres";
const url = fs.readFileSync(".env", "utf8").split("\n")
  .find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
const sql = postgres(url, { ssl: "require", max: 1 });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS stripe_connections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      location_id TEXT NOT NULL,
      publishable_key TEXT NOT NULL,
      secret_key_enc TEXT NOT NULL,
      account_id VARCHAR(255),
      account_name VARCHAR(255),
      mode VARCHAR(10) NOT NULL DEFAULT 'test',
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      last_validated_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      revoked_reason TEXT,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log("✅ CREATE TABLE stripe_connections (idempotent)");

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS stripe_connections_location_unique ON stripe_connections (location_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stripe_connections_status ON stripe_connections (status)`;
  console.log("✅ indexes (unique location, status)");

  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'stripe_connections'
    ORDER BY ordinal_position
  `;
  console.log("\nSchema after:");
  for (const c of cols) console.log(`   ${c.column_name.padEnd(22)} ${c.data_type.padEnd(28)} nullable=${c.is_nullable}`);
} finally {
  await sql.end({ timeout: 5 });
}
