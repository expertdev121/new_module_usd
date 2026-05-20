/**
 * Drizzle schema for the GHL webhook receiver.
 *
 * Kept in its own file (NOT inside lib/db/schema.ts) so this feature can be
 * added without modifying existing schema. Same pattern as schema-oauth.ts.
 *
 * Run migrations 0018 and 0019 BEFORE using:
 *   - drizzle/0018_ghl_webhook_tables.sql   (new tables)
 *   - drizzle/0019_contact_sync_columns.sql (ALTER contact)
 */
import {
  pgTable,
  serial,
  text,
  uuid,
  varchar,
  timestamp,
  boolean,
  numeric,
  date,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { genderEnum } from "./schema";

// ─────────────────────────────────────────────────────────────────────────────
// New tables (created by drizzle/0018_ghl_webhook_tables.sql)
// ─────────────────────────────────────────────────────────────────────────────

export const ghlWebhookEvents = pgTable(
  "ghl_webhook_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    webhookId: varchar("webhook_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    locationId: varchar("location_id", { length: 255 }),
    companyId: varchar("company_id", { length: 255 }),
    ghlTimestamp: timestamp("ghl_timestamp", { withTimezone: true }),
    payload: jsonb("payload").notNull(),
    signatureValid: boolean("signature_valid").notNull().default(false),
    processingStatus: varchar("processing_status", { length: 50 })
      .notNull()
      .default("received"),
    processingError: text("processing_error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => ({
    webhookIdUnique: uniqueIndex("ghl_webhook_events_webhook_id_unique").on(table.webhookId),
    webhookIdIdx: index("idx_ghl_webhook_events_webhook_id").on(table.webhookId),
    locationIdIdx: index("idx_ghl_webhook_events_location_id").on(table.locationId),
    eventTypeIdx: index("idx_ghl_webhook_events_event_type").on(table.eventType),
    statusIdx: index("idx_ghl_webhook_events_status").on(table.processingStatus),
  }),
);

export const ghlSyncWrites = pgTable(
  "ghl_sync_writes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    locationId: varchar("location_id", { length: 255 }).notNull(),
    ghlContactId: varchar("ghl_contact_id", { length: 255 }).notNull(),
    writtenAt: timestamp("written_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    lookupIdx: index("idx_ghl_sync_writes_lookup").on(
      table.locationId,
      table.ghlContactId,
      table.expiresAt,
    ),
  }),
);

export const ghlInvoiceEvents = pgTable(
  "ghl_invoice_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    invoiceId: varchar("invoice_id", { length: 255 }),
    contactId: varchar("contact_id", { length: 255 }),
    locationId: varchar("location_id", { length: 255 }),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    currency: varchar("currency", { length: 10 }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    invoiceIdIdx: index("idx_ghl_invoice_events_invoice_id").on(table.invoiceId),
    locationIdIdx: index("idx_ghl_invoice_events_location_id").on(table.locationId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Extended `contact` definition.
//
// The canonical contact table is declared in lib/db/schema.ts. The webhook
// handlers need access to columns added by drizzle/0019_contact_sync_columns.sql
// that aren't part of that canonical definition. Rather than modify the
// existing schema.ts (per the "no existing file changes" rule), we define a
// parallel alias `contactWithSync` that points at the SAME database table
// ("contact") but with the full extended column list. Both Drizzle handles
// generate identical SQL for the columns they share — Drizzle is fine with
// two TypeScript views of the same physical table.
//
// IMPORTANT: Use `contactWithSync` ONLY inside the webhook code path. The
// rest of the app keeps importing `contact` from schema.ts. They coexist.
// ─────────────────────────────────────────────────────────────────────────────

export const contactWithSync = pgTable("contact", {
  id: serial("id").primaryKey(),
  ghlContactId: text("ghl_contact_id"),
  constituentsId: text("constituents_id"),
  raffelTickets: text("raffel_tickets"),
  locationId: text("location_id"),
  recordId: text("recordId"),
  firstName: text("first_name").notNull(),
  displayName: text("display_name"),
  lastName: text("last_name").notNull(),
  email: text("email"),
  email2: text("email2"),
  phone: text("phone"),
  title: text("title"),
  gender: genderEnum("gender"),
  address: text("address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),

  // Added by migration 0019.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  syncSource: varchar("sync_source", { length: 50 }),
  lastGhlSyncAt: timestamp("last_ghl_sync_at", { withTimezone: true }),
  doNotContact: boolean("do_not_contact").default(false),
  dateOfBirth: date("date_of_birth"),
  address1: text("address1"),
  city: varchar("city", { length: 255 }),
  state: varchar("state", { length: 255 }),
  postalCode: varchar("postal_code", { length: 50 }),
  country: varchar("country", { length: 100 }),
  organization: text("organization"),
  source: varchar("source", { length: 255 }),
  tags: jsonb("tags").$type<string[]>(),
  ghlCustomFields: jsonb("ghl_custom_fields").$type<Record<string, unknown>>(),

  // Added by migration 0022. TRUE for rows that pre-date the UNIQUE
  // constraint on (ghl_contact_id, location_id). Excluded from the
  // partial unique index so they don't block the constraint. Will be
  // reviewed and merged by Nikhil later.
  isLegacyDuplicate: boolean("is_legacy_duplicate").notNull().default(false),
});

export type ContactWithSync = typeof contactWithSync.$inferSelect;
export type NewContactWithSync = typeof contactWithSync.$inferInsert;
export type GhlWebhookEvent = typeof ghlWebhookEvents.$inferSelect;
export type GhlSyncWrite = typeof ghlSyncWrites.$inferSelect;
export type GhlInvoiceEvent = typeof ghlInvoiceEvents.$inferSelect;
