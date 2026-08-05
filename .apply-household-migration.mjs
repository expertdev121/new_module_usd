/**
 * Household support migration — additive & idempotent.
 * Safe to re-run. Every column added is nullable so existing tenants
 * (Amatz, CMN, Hameir Laarets, etc.) keep working with no changes.
 *
 * Adds:
 *   - location_settings           (new)
 *   - household                   (new)
 *   - contact.household_id        (nullable FK)
 *   - contact.is_primary_contact  (nullable bool)
 *   - contact.relationship        (nullable varchar — 'primary'|'spouse'|'child'|'other')
 *   - payment.household_id        (nullable FK)
 */
import fs from "node:fs";
import postgres from "postgres";

const url = fs
  .readFileSync(".env", "utf8")
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice(13)
  .trim()
  .replace(/^["']|["']$/g, "");
const sql = postgres(url, { ssl: "require", max: 1 });

try {
  // ── location_settings ────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS location_settings (
      id SERIAL PRIMARY KEY,
      location_id TEXT NOT NULL,
      account_type VARCHAR(32) NOT NULL DEFAULT 'individual',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS location_settings_location_unique
      ON location_settings (location_id)
  `;
  console.log("✅ location_settings table + unique index");

  // ── household ────────────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS household (
      id SERIAL PRIMARY KEY,
      location_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      external_id TEXT,
      membership_tier VARCHAR(64),
      mail_label TEXT,
      mail_address1 TEXT,
      mail_address2 TEXT,
      mail_city TEXT,
      mail_state TEXT,
      mail_zip TEXT,
      mail_country TEXT,
      household_phone TEXT,
      household_email TEXT,
      date_joined TIMESTAMP,
      total_balance NUMERIC(12,2),
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS household_location_idx    ON household (location_id)`;
  await sql`CREATE INDEX IF NOT EXISTS household_external_id_idx ON household (external_id)`;
  await sql`CREATE INDEX IF NOT EXISTS household_display_idx     ON household (display_name)`;
  console.log("✅ household table + indexes");

  // ── contact additive columns ─────────────────────────────────────────────
  await sql`ALTER TABLE contact ADD COLUMN IF NOT EXISTS household_id       INTEGER`;
  await sql`ALTER TABLE contact ADD COLUMN IF NOT EXISTS is_primary_contact BOOLEAN`;
  await sql`ALTER TABLE contact ADD COLUMN IF NOT EXISTS relationship       VARCHAR(32)`;
  // FK is added as NOT VALID so we don't scan the whole existing contact
  // table; we validate as a follow-up (fast; every value is NULL initially).
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contact_household_fk'
      ) THEN
        ALTER TABLE contact
          ADD CONSTRAINT contact_household_fk
          FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE SET NULL
          NOT VALID;
      END IF;
    END $$;
  `;
  await sql`CREATE INDEX IF NOT EXISTS contact_household_id_idx ON contact (household_id)`;
  console.log("✅ contact: household_id + is_primary_contact + relationship + FK");

  // ── payment additive column ──────────────────────────────────────────────
  await sql`ALTER TABLE payment ADD COLUMN IF NOT EXISTS household_id INTEGER`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_household_fk'
      ) THEN
        ALTER TABLE payment
          ADD CONSTRAINT payment_household_fk
          FOREIGN KEY (household_id) REFERENCES household(id) ON DELETE SET NULL
          NOT VALID;
      END IF;
    END $$;
  `;
  await sql`CREATE INDEX IF NOT EXISTS payment_household_id_idx ON payment (household_id)`;
  console.log("✅ payment: household_id + FK");

  // ── verify ───────────────────────────────────────────────────────────────
  const cols = await sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE (table_name = 'household' OR table_name = 'location_settings')
       OR (table_name = 'contact' AND column_name IN ('household_id','is_primary_contact','relationship'))
       OR (table_name = 'payment' AND column_name = 'household_id')
    ORDER BY table_name, ordinal_position
  `;
  console.log("\nSchema after:");
  for (const c of cols) {
    console.log(
      `  ${c.table_name.padEnd(20)} ${c.column_name.padEnd(22)} ${c.data_type}`,
    );
  }
} finally {
  await sql.end({ timeout: 5 });
}
