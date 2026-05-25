/**
 * Drizzle schema definition for the ghl_oauth_tokens table.
 *
 * Kept in its own file (not inside lib/db/schema.ts) so this feature can be
 * added without modifying existing schema. The Drizzle client in
 * lib/db/index.ts only imports `* as schema from "./schema"`, so this table
 * is NOT registered with `db.query.*`. The OAuth modules access it via the
 * explicit form `db.insert(ghlOauthTokens).values(...)` / `db.select().from(ghlOauthTokens)`,
 * which works without registration.
 *
 * Run drizzle/0017_ghl_oauth_tokens.sql manually before using.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const ghlOauthTokens = pgTable(
  "ghl_oauth_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /* Primary dedup key — matches the official GHL Marketplace template's
       `installationObjects[resourceId]`. Holds a locationId for sub-account
       installs OR a companyId for agency-level installs. UNIQUE + NOT NULL. */
    resourceId: varchar("resource_id", { length: 255 }).notNull(),
    /* 'Location' | 'Company' — discriminates which kind of token row this is.
       Used by the UI to render "Sub-account: X" vs "Agency: Y". */
    resourceType: varchar("resource_type", { length: 50 }).notNull(),
    /* Nullable for Company-level installs. When present, also indexed for
       the lookup-by-location path used by the webhook receiver. */
    locationId: varchar("location_id", { length: 255 }),
    companyId: varchar("company_id", { length: 255 }).notNull(),
    userId: varchar("user_id", { length: 255 }),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    scope: text("scope"),
    tokenType: varchar("token_type", { length: 50 }).default("Bearer"),
    userType: varchar("user_type", { length: 50 }),
    locationName: varchar("location_name", { length: 255 }),
    companyName: varchar("company_name", { length: 255 }),
    isWhitelabelCompany: boolean("is_whitelabel_company").default(false),
    donorHqUserId: uuid("donor_hq_user_id"),
    /* Connection lifecycle. 'active' on first install, 'needs_reinstall'
       when a token refresh is rejected by GHL (4xx), 'revoked' when the user
       uninstalls the app or an admin clicks Disconnect. We NEVER hard-delete
       the row — the history is auditable. */
    status: varchar("status", { length: 50 }).notNull().default("active"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    // Added by migration 0024. Marks that the data for this location is
    // currently in a super-admin soft-deleted (offboarded) state. The
    // /admin/offboard-clients page uses this to list soft-deleted rows
    // separately from genuinely-revoked rows.
    dataSoftDeletedAt: timestamp("data_soft_deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    /* resource_id is the new primary dedup key. NOT NULL + UNIQUE. */
    resourceIdUnique: uniqueIndex("ghl_oauth_tokens_resource_id_unique").on(table.resourceId),
    resourceIdIdx: index("idx_ghl_oauth_tokens_resource_id").on(table.resourceId),
    resourceTypeIdx: index("idx_ghl_oauth_tokens_resource_type").on(table.resourceType),
    /* location_id is now nullable; we keep the regular index for the
       lookup-by-location path used by webhook handlers + the lazy
       location-token mint helper. */
    locationIdIdx: index("idx_ghl_oauth_tokens_location_id").on(table.locationId),
    companyIdIdx: index("idx_ghl_oauth_tokens_company_id").on(table.companyId),
    statusIdx: index("idx_ghl_oauth_tokens_status").on(table.status),
  }),
);

export type GhlOauthToken = typeof ghlOauthTokens.$inferSelect;
export type NewGhlOauthToken = typeof ghlOauthTokens.$inferInsert;
