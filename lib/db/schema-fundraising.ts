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
  boolean,
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

    /** Basics step "Campaign type" card — personal | nonprofit | team. Informational/categorization only. */
    campaignType: varchar("campaign_type", { length: 20 }).notNull().default("nonprofit"),

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

    /** Phase 2: tag applied to the donor's GHL contact on a completed donation. */
    ghlTag: text("ghl_tag"),
    /** Phase 3: allow supporters to spin up their own peer-to-peer team pages. */
    teamEnabled: boolean("team_enabled").notNull().default(false),
    /** Phase 3 (P2P): the fundraiser's display name for a team/personal page. */
    ownerName: text("owner_name"),
    ownerContactId: integer("owner_contact_id"),
    /** Phase 4: payment processor ('crowded' default; swappable). */
    processor: varchar("processor", { length: 24 }).notNull().default("crowded"),
    /** Donations step "donor covers the fees" toggle — surfaced on the public donate page. */
    donorCoversFees: boolean("donor_covers_fees").notNull().default(false),
    /** Donations step "Stop at goal" toggle — auto-close donations once the goal is hit. */
    donationCap: boolean("donation_cap").notNull().default(false),

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

export const CAMPAIGN_TYPES = ["personal", "nonprofit", "team"] as const;
export type FundraisingCampaignType = (typeof CAMPAIGN_TYPES)[number];

/**
 * Phase 2 — self-serve outbound webhooks. A user registers a URL (e.g. their
 * GHL inbound-webhook trigger) that we POST to when a fundraising donation
 * completes, so they can drive automations without contacting support.
 * campaign_id null = fires for all of the tenant's campaigns.
 */
export const fundraisingWebhook = pgTable(
  "fundraising_webhook",
  {
    id: serial("id").primaryKey(),
    locationId: text("location_id").notNull(),
    campaignId: integer("campaign_id"),
    url: text("url").notNull(),
    event: varchar("event", { length: 40 }).notNull().default("donation.succeeded"),
    isActive: boolean("is_active").notNull().default(true),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    lastStatus: integer("last_status"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    locationIdx: index("fundraising_webhook_location_idx").on(t.locationId),
  }),
);

export type FundraisingWebhook = typeof fundraisingWebhook.$inferSelect;
export type NewFundraisingWebhook = typeof fundraisingWebhook.$inferInsert;
