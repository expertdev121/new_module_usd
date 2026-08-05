/**
 * Household support — additive, tenant-opt-in.
 *
 * There is no `locations` table in this repo (location_id is a plain
 * text column on every tenanted row), so per-tenant configuration
 * lives here in `location_settings`. New setting today: account_type.
 *
 * Every existing tenant behaves exactly as before. A location only
 * enters "household mode" when a row is inserted here with
 * account_type = 'household'. Absence of a row = individual mode.
 *
 * Additive columns for `contact` and `payment` (household_id,
 * is_primary_contact, relationship) are applied via
 * .apply-household-migration.mjs — they are nullable, so existing
 * data continues to work untouched.
 */
import {
  pgTable,
  serial,
  text,
  varchar,
  boolean,
  integer,
  timestamp,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// location_settings — one row per tenant that has opted into any new setting.
// account_type: 'individual' (default) | 'household'
// ─────────────────────────────────────────────────────────────────────────────
export const locationSettings = pgTable(
  "location_settings",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    accountType: varchar("account_type", { length: 32 })
      .notNull()
      .default("individual"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    locationUnique: uniqueIndex("location_settings_location_unique").on(
      t.locationId,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// household — one row per family. Grouping entity; not a person.
// Only populated when a tenant is in household mode.
// ─────────────────────────────────────────────────────────────────────────────
export const household = pgTable(
  "household",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    /** Display label shown in the UI ("The Sontag Family", "Mr. & Mrs. Tzvi Sontag"). */
    displayName: text("display_name").notNull(),
    /** Optional external id from the source system (PTI account id, etc.). */
    externalId: text("external_id"),
    /** Membership tier if the tenant tracks one ("Full Member", "Dinner Only"…). */
    membershipTier: varchar("membership_tier", { length: 64 }),
    /** Household-shared mailing address. */
    mailLabel: text("mail_label"),
    mailAddress1: text("mail_address1"),
    mailAddress2: text("mail_address2"),
    mailCity: text("mail_city"),
    mailState: text("mail_state"),
    mailZip: text("mail_zip"),
    mailCountry: text("mail_country"),
    /** Household-level phone (used for family robocalls, dinner reminders, etc.). */
    householdPhone: text("household_phone"),
    /** Household-level email (rare, but PTI has a few). */
    householdEmail: text("household_email"),
    dateJoined: timestamp("date_joined", { withTimezone: false }),
    /** Cached outstanding balance from source import; kept as a stat, not a source of truth. */
    totalBalance: numeric("total_balance", { precision: 12, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    locationIdx: index("household_location_idx").on(t.locationId),
    externalIdIdx: index("household_external_id_idx").on(t.externalId),
    displayIdx: index("household_display_idx").on(t.displayName),
  }),
);

export type LocationSettings = typeof locationSettings.$inferSelect;
export type NewLocationSettings = typeof locationSettings.$inferInsert;
export type Household = typeof household.$inferSelect;
export type NewHousehold = typeof household.$inferInsert;

export type AccountType = "individual" | "household";
