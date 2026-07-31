/**
 * Drizzle schema for the FundRazr (ConnectionPoint) integration.
 *
 * Read-only observability surface — admins see their org's FundRazr
 * campaigns inside DonorHQ. We do NOT call any write endpoints on
 * ConnectionPoint. The DonorHQ database only persists the connection
 * (which ConnectionPoint organization this DonorHQ location maps to);
 * campaigns themselves are fetched live at request time in the MVP
 * (Option A). A later phase can add local caching + webhooks.
 *
 * Per-tenant key is `location_id` — matches the GHL + Crowded pattern.
 * Kept in its own file so the feature adds without touching schema.ts.
 */
import {
  pgTable,
  uuid,
  integer,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// fundrazr_connections — one row per admin location.
// Currently just holds which ConnectionPoint organization this location
// belongs to. Auth against ConnectionPoint is server-wide (shared partner
// token in env), not per-tenant, so we do not store an API key here.
// ─────────────────────────────────────────────────────────────────────────────
export const fundrazrConnections = pgTable(
  "fundrazr_connections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Tenant key — matches user.location_id. One FundRazr connection per location. */
    locationId: text("location_id").notNull(),
    /** ConnectionPoint organization ID the admin pasted into Settings. */
    organizationId: varchar("organization_id", { length: 255 }).notNull(),
    /** Optional display label captured at connect time for the UI. */
    organizationName: varchar("organization_name", { length: 255 }),
    /** active / disconnected. */
    status: varchar("status", { length: 50 }).notNull().default("active"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    /** Which DonorHQ user clicked Connect. Audit. */
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // One connection per location.
    locationUnique: uniqueIndex("fundrazr_connections_location_unique").on(table.locationId),
    orgIdx: index("idx_fundrazr_connections_org").on(table.organizationId),
    statusIdx: index("idx_fundrazr_connections_status").on(table.status),
  }),
);

export type FundrazrConnection = typeof fundrazrConnections.$inferSelect;
export type NewFundrazrConnection = typeof fundrazrConnections.$inferInsert;
