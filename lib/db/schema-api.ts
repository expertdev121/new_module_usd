/**
 * Public Integrations API — per-account API keys.
 *
 * Additive and tenant-scoped, exactly like schema-household.ts: there is
 * no `locations` table, so `location_id` is a plain text column and every
 * key belongs to exactly one tenant. A key resolves to its location on
 * every incoming request — the caller never sends the location id, so a
 * key can only ever read/write its own account's data.
 *
 * We never store the raw key. On creation we return the full token once
 * (the only time it's visible) and persist only:
 *   - key_prefix : the first ~12 visible chars, shown in the dashboard so
 *                  a user can tell their keys apart ("dhq_live_ab12…").
 *   - key_hash   : sha256(full token), what we match against on each call.
 *
 * Applied to the DB via .apply-api-keys-migration.mjs (idempotent).
 */
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";

// The scopes a key can hold. Kept as a plain string[] column so we can add
// scopes later without a migration. v1 ships exactly the two the product
// asked for: create a contact, and record a manual donation.
export const API_SCOPES = ["contacts:write", "donations:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const apiKey = pgTable(
  "api_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: text("location_id").notNull(),
    /** Human label the user gives the key ("Wix site", "Crowded", "Zapier"). */
    name: text("name").notNull(),
    /** First visible chars of the token — for identification in the UI only. */
    keyPrefix: text("key_prefix").notNull(),
    /** sha256 hex of the full token. The only thing we can match on. */
    keyHash: text("key_hash").notNull(),
    /** Granted scopes, e.g. ['contacts:write','donations:write']. */
    scopes: text("scopes").array().notNull(),
    /** Stamped on every successful authenticated call (best-effort). */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /** Set when the user revokes the key; revoked keys never authenticate. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** user.id of the admin who created it (audit trail). */
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // Every authenticated call is a lookup by hash — this index is the hot path.
    hashIdx: index("api_key_hash_idx").on(t.keyHash),
    locationIdx: index("api_key_location_idx").on(t.locationId),
  }),
);

export type ApiKey = typeof apiKey.$inferSelect;
export type NewApiKey = typeof apiKey.$inferInsert;
