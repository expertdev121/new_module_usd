/**
 * Drizzle schema for the Crowded (bankingcrowded.com) integration.
 *
 * Kept in its own file (NOT in lib/db/schema.ts) so this feature can be
 * added without touching existing schema. Same pattern as schema-oauth.ts
 * and schema-webhook.ts. The Drizzle client in lib/db/index.ts only
 * imports `* as schema from "./schema"`, so these tables are NOT
 * registered with `db.query.*` — Crowded modules access them via the
 * explicit `db.insert(crowdedX).values(...)` form.
 *
 * Migrations:
 *   - drizzle/0026_crowded_tables.sql           (new tables)
 *   - drizzle/0027_manual_donation_crowded.sql  (ALTER manual_donation)
 *   - drizzle/0028_contact_crowded_id.sql       (ALTER contact, optional match precision)
 *
 * Per-tenant key everywhere is `location_id` — same as the GHL integration.
 * One DonorHQ admin = one `user` row with a `locationId`; their Crowded
 * connection + forms + webhook events all carry that `locationId`.
 */
import {
  pgTable,
  serial,
  uuid,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// crowded_connections — one row per admin location.
// Mirrors ghl_oauth_tokens. Stores the admin's Crowded partner API key
// (encrypted) plus the webhook registration metadata (also encrypted secret).
// ─────────────────────────────────────────────────────────────────────────────
export const crowdedConnections = pgTable(
  "crowded_connections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Tenant key — matches user.location_id. One Crowded connection per location. */
    locationId: text("location_id").notNull(),
    /** AES-256-GCM encrypted Crowded partner API key. NEVER returned to clients. */
    apiTokenEnc: text("api_token_enc").notNull(),
    /** Crowded organization ID returned by GET /chapters. Display + audit. */
    orgId: varchar("org_id", { length: 255 }),
    /** Selected chapter (sub-account) ID — all forms hang off this. */
    chapterId: varchar("chapter_id", { length: 255 }).notNull(),
    /** Chapter display name from GET /chapters, for the UI. */
    chapterName: varchar("chapter_name", { length: 255 }),
    /** Crowded webhook registration ID — used to PATCH / DELETE later. */
    webhookRegistrationId: varchar("webhook_registration_id", { length: 255 }),
    /** AES-256-GCM encrypted HMAC secret Crowded gave us at registration. */
    webhookSecretEnc: text("webhook_secret_enc"),
    /** active / needs_reconnect / revoked. */
    status: varchar("status", { length: 50 }).notNull().default("active"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    /** Which DonorHQ user clicked Connect. Audit. */
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // One connection per location.
    locationUnique: uniqueIndex("crowded_connections_location_unique").on(table.locationId),
    chapterIdx: index("idx_crowded_connections_chapter").on(table.chapterId),
    statusIdx: index("idx_crowded_connections_status").on(table.status),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// crowded_forms — one row per donation form created in DonorHQ.
// Each row corresponds 1:1 to a Crowded "collection".
// ─────────────────────────────────────────────────────────────────────────────
export const crowdedForms = pgTable(
  "crowded_forms",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    chapterId: varchar("chapter_id", { length: 255 }).notNull(),
    /** ID returned by POST /chapters/:id/collections. Stable across edits. */
    crowdedCollectionId: varchar("crowded_collection_id", { length: 255 }).notNull(),

    // Admin-facing fields
    name: text("name").notNull(),
    /** dues = fixed amount (memberships, tickets) | donation = open amount */
    type: varchar("type", { length: 20 }).notNull().default("donation"),
    amountCents: integer("amount_cents"),
    goalCents: integer("goal_cents"),
    recurringEnabled: boolean("recurring_enabled").notNull().default(false),

    // DonorHQ mapping — used when the webhook converts payment → manual_donation
    campaignId: integer("campaign_id"),
    categoryId: integer("category_id"),
    categoryItemId: integer("category_item_id"),
    accountId: integer("account_id"),

    // Branding (the eye-catching part)
    primaryColor: varchar("primary_color", { length: 9 }),
    accentColor: varchar("accent_color", { length: 9 }),
    backgroundColor: varchar("background_color", { length: 9 }),
    logoUrl: text("logo_url"),
    heroImageUrl: text("hero_image_url"),
    headline: text("headline"),
    tagline: text("tagline"),
    successMessage: text("success_message"),
    /** Donor-facing button label, e.g. "Give Now", "Sponsor a Child". */
    submitLabel: varchar("submit_label", { length: 60 }),

    // Suggested amount tiles (eye-catching presets)
    suggestedAmounts: jsonb("suggested_amounts").$type<number[]>(),

    // Field-level toggles — which donor fields the form collects
    askAddress: boolean("ask_address").notNull().default(true),
    askPhone: boolean("ask_phone").notNull().default(false),
    askTribute: boolean("ask_tribute").notNull().default(false),
    askComments: boolean("ask_comments").notNull().default(false),
    requireConsent: boolean("require_consent").notNull().default(true),

    // Fee model — donor pays vs org absorbs
    feeCoverDefault: varchar("fee_cover_default", { length: 20 }).notNull().default("donor"),

    successUrl: text("success_url"),
    failureUrl: text("failure_url"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    locationIdx: index("idx_crowded_forms_location").on(table.locationId),
    chapterIdx: index("idx_crowded_forms_chapter").on(table.chapterId),
    collectionUnique: uniqueIndex("crowded_forms_collection_unique").on(
      table.locationId,
      table.crowdedCollectionId,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// crowded_webhook_events — forensic store + dedup. Mirrors ghl_webhook_events.
// ─────────────────────────────────────────────────────────────────────────────
export const crowdedWebhookEvents = pgTable(
  "crowded_webhook_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Crowded's per-event UUID — used for dedup. */
    eventId: varchar("event_id", { length: 255 }).notNull(),
    /** Crowded's per-batch UUID. */
    batchId: varchar("batch_id", { length: 255 }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    chapterId: varchar("chapter_id", { length: 255 }),
    /** Resolved at processing time via chapterId → crowded_connections. */
    locationId: text("location_id"),
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
    eventIdUnique: uniqueIndex("crowded_webhook_events_event_id_unique").on(table.eventId),
    chapterIdx: index("idx_crowded_webhook_events_chapter").on(table.chapterId),
    locationIdx: index("idx_crowded_webhook_events_location").on(table.locationId),
    typeIdx: index("idx_crowded_webhook_events_type").on(table.eventType),
    statusIdx: index("idx_crowded_webhook_events_status").on(table.processingStatus),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// crowded_payment_plans — recurring / installment plan tracking.
// One row per Crowded payment plan; individual cycle payments still
// become their own manual_donation rows (deduped by paymentId).
// ─────────────────────────────────────────────────────────────────────────────
export const crowdedPaymentPlans = pgTable(
  "crowded_payment_plans",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    crowdedPlanId: varchar("crowded_plan_id", { length: 255 }).notNull(),
    crowdedFormId: integer("crowded_form_id"),
    contactId: integer("contact_id"),
    /** recurring (open-ended) | installment (N payments). */
    type: varchar("type", { length: 20 }).notNull().default("recurring"),
    frequency: varchar("frequency", { length: 20 }),
    totalPayments: integer("total_payments"),
    completedPayments: integer("completed_payments").notNull().default(0),
    totalPaidCents: integer("total_paid_cents").notNull().default(0),
    /** active | canceled | completed | failed */
    status: varchar("status", { length: 30 }).notNull().default("active"),
    firstPaymentDate: timestamp("first_payment_date", { withTimezone: true }),
    nextPaymentDate: timestamp("next_payment_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    planUnique: uniqueIndex("crowded_payment_plans_plan_unique").on(table.crowdedPlanId),
    locationIdx: index("idx_crowded_payment_plans_location").on(table.locationId),
    contactIdx: index("idx_crowded_payment_plans_contact").on(table.contactId),
    statusIdx: index("idx_crowded_payment_plans_status").on(table.status),
  }),
);

export type CrowdedConnection = typeof crowdedConnections.$inferSelect;
export type NewCrowdedConnection = typeof crowdedConnections.$inferInsert;
export type CrowdedForm = typeof crowdedForms.$inferSelect;
export type NewCrowdedForm = typeof crowdedForms.$inferInsert;
export type CrowdedWebhookEvent = typeof crowdedWebhookEvents.$inferSelect;
export type CrowdedPaymentPlan = typeof crowdedPaymentPlans.$inferSelect;
