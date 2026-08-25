/**
 * Fundraising / Campaign platform (GiveButter-style) — additive, tenant-scoped.
 *
 * A `fundraising_campaign` is the marketing/goal/branding container that donors
 * see on a hosted, shareable page (`/f/[slug]`). It REUSES the existing Crowded
 * "Donation Form" (`crowded_forms`) for actual payment collection, so we don't
 * duplicate the payment/webhook/receipt pipeline — the campaign just points at a
 * `crowded_form_id`, and progress is summed from `manual_donation.crowded_form_id`
 * (already indexed).
 *
 * Kept in its own schema file (like schema-crowded.ts): the Drizzle client only
 * imports `./schema`, so this table is accessed via explicit `db.insert(...)`,
 * never `db.query.*`. Tenant key is `location_id` everywhere.
 *
 * Applied via .apply-fundraising-migration.mjs (idempotent).
 */
import {
  pgTable,
  serial,
  text,
  integer,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const fundraisingCampaign = pgTable(
  "fundraising_campaign",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    /** URL slug for the public page /f/<slug> — unique per tenant. */
    slug: text("slug").notNull(),

    title: text("title").notNull(),
    /** Long-form story / description (markdown or plain text). */
    story: text("story"),
    /** Fundraising goal in cents; null = no goal (progress bar hidden). */
    goalCents: integer("goal_cents"),

    // Branding (mirrors crowded_forms so the public page can reuse rendering).
    coverImageUrl: text("cover_image_url"),
    primaryColor: varchar("primary_color", { length: 9 }),
    accentColor: varchar("accent_color", { length: 9 }),
    backgroundColor: varchar("background_color", { length: 9 }),

    /** draft | active | ended. */
    status: varchar("status", { length: 20 }).notNull().default("active"),

    /**
     * The Crowded donation form used to COLLECT money for this campaign. The
     * public page's Donate button routes to /donate/<crowdedFormId>, and the
     * progress bar sums manual_donation rows carrying this crowded_form_id.
     */
    crowdedFormId: integer("crowded_form_id"),
    /** Optional attribution to the main `campaign` table. */
    campaignId: integer("campaign_id"),
    /** Sub-campaign / peer-to-peer parent (phase 3). Null = top-level. */
    parentCampaignId: integer("parent_campaign_id"),

    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    locationIdx: index("fundraising_campaign_location_idx").on(t.locationId),
    parentIdx: index("fundraising_campaign_parent_idx").on(t.parentCampaignId),
    slugUnique: uniqueIndex("fundraising_campaign_slug_unique").on(t.locationId, t.slug),
  }),
);

export type FundraisingCampaign = typeof fundraisingCampaign.$inferSelect;
export type NewFundraisingCampaign = typeof fundraisingCampaign.$inferInsert;

export const CAMPAIGN_STATUSES = ["draft", "active", "ended"] as const;
export type FundraisingStatus = (typeof CAMPAIGN_STATUSES)[number];
