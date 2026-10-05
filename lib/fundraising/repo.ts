/**
 * Data access for the Fundraising / Campaign platform.
 *
 * A campaign is a hosted, branded page with a goal + progress bar. It collects
 * money through a linked Crowded donation form (crowded_form_id), so "raised"
 * is summed from manual_donation rows carrying that crowded_form_id (completed,
 * revenue-only). Everything is tenant-scoped by location_id.
 */
import { db } from "@/lib/db";
import { fundraisingCampaign, type NewFundraisingCampaign } from "@/lib/db/schema-fundraising";
import { organizationName } from "@/lib/db/schema";
import { and, eq, desc, inArray, sql } from "drizzle-orm";

/**
 * Campaigns created before the "default owner name to the tenant's account
 * name" behavior existed (or created with it left blank) have a null
 * owner_name in the DB. Rather than requiring a one-off backfill, resolve the
 * fallback at read time so the public page's "By {name}" + verified line
 * always shows something for every tenant, old campaigns included.
 */
async function resolveOwnerNames<T extends { locationId: string; ownerName: string | null }>(rows: T[]): Promise<T[]> {
  const missing = Array.from(new Set(rows.filter((r) => !r.ownerName).map((r) => r.locationId)));
  if (missing.length === 0) return rows;
  const orgs = await db
    .select({ locationId: organizationName.locationId, orgName: organizationName.orgName })
    .from(organizationName)
    .where(inArray(organizationName.locationId, missing));
  const byLocation = new Map(orgs.map((o) => [o.locationId, o.orgName]));
  return rows.map((r) => (r.ownerName ? r : { ...r, ownerName: byLocation.get(r.locationId) ?? r.ownerName }));
}

export type CampaignWithProgress = {
  id: number;
  slug: string;
  campaignType: string;
  title: string;
  story: string | null;
  goalCents: number | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  backgroundImageUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  status: string;
  crowdedFormId: number | null;
  campaignId: number | null;
  parentCampaignId: number | null;
  ghlTag: string | null;
  teamEnabled: boolean;
  ownerName: string | null;
  processor: string;
  donorCoversFees: boolean;
  donationCap: boolean;
  raisedCents: number;
  donorCount: number;
  goalPct: number | null;
  createdAt: Date;
};

/** URL-safe slug from a title, plus a short suffix for uniqueness headroom. */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
  return base || "campaign";
}

/** Ensure a slug is unique within the tenant (append -2, -3, … on collision). */
export async function uniqueSlug(locationId: string, desired: string, excludeId?: number): Promise<string> {
  const wanted = slugify(desired);
  let candidate = wanted;
  let n = 1;
  // Small loop — slugs collide rarely.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await db
      .select({ id: fundraisingCampaign.id })
      .from(fundraisingCampaign)
      .where(and(eq(fundraisingCampaign.locationId, locationId), eq(fundraisingCampaign.slug, candidate)))
      .limit(1);
    const clash = rows[0] && rows[0].id !== excludeId;
    if (!clash) return candidate;
    n += 1;
    candidate = `${wanted}-${n}`;
  }
}

/**
 * Raised (in cents) + donor count per crowded_form_id, for the given forms.
 * Revenue only (completed/succeeded; excludes refunded/failed/cancelled).
 */
async function raisedByForm(locationId: string, formIds: number[]): Promise<Map<number, { cents: number; donors: number }>> {
  const out = new Map<number, { cents: number; donors: number }>();
  if (formIds.length === 0) return out;
  const rows = await db.execute(sql`
    SELECT crowded_form_id AS form_id,
           COALESCE(SUM(ROUND(COALESCE(amount_usd, amount)::numeric * 100)), 0)::bigint AS cents,
           COUNT(DISTINCT contact_id)::int AS donors
    FROM manual_donation
    WHERE location_id = ${locationId}
      AND crowded_form_id = ANY(${sql`ARRAY[${sql.join(formIds.map((f) => sql`${f}`), sql`, `)}]::int[]`})
      AND payment_status NOT IN ('refunded','failed','cancelled')
    GROUP BY crowded_form_id
  `);
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  for (const r of list as { form_id: number; cents: string | number; donors: number }[]) {
    out.set(Number(r.form_id), { cents: Number(r.cents), donors: Number(r.donors) });
  }
  return out;
}

/**
 * Raised (in cents) + donor count per fundraising_campaign_id, for the given
 * campaign ids. Stripe-processor campaigns aren't linked to a Crowded form,
 * so their donations (written by the fundraising webhook) are summed here
 * instead of raisedByForm. Same revenue-only filter.
 */
async function raisedByCampaign(locationId: string, campaignIds: number[]): Promise<Map<number, { cents: number; donors: number }>> {
  const out = new Map<number, { cents: number; donors: number }>();
  if (campaignIds.length === 0) return out;
  const rows = await db.execute(sql`
    SELECT fundraising_campaign_id AS campaign_id,
           COALESCE(SUM(ROUND(COALESCE(amount_usd, amount)::numeric * 100)), 0)::bigint AS cents,
           COUNT(DISTINCT contact_id)::int AS donors
    FROM manual_donation
    WHERE location_id = ${locationId}
      AND fundraising_campaign_id = ANY(${sql`ARRAY[${sql.join(campaignIds.map((c) => sql`${c}`), sql`, `)}]::int[]`})
      AND payment_status NOT IN ('refunded','failed','cancelled')
    GROUP BY fundraising_campaign_id
  `);
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  for (const r of list as { campaign_id: number; cents: string | number; donors: number }[]) {
    out.set(Number(r.campaign_id), { cents: Number(r.cents), donors: Number(r.donors) });
  }
  return out;
}

function combineProgress(
  a?: { cents: number; donors: number },
  b?: { cents: number; donors: number },
): { cents: number; donors: number } | undefined {
  if (!a) return b;
  if (!b) return a;
  return { cents: a.cents + b.cents, donors: a.donors + b.donors };
}

function withProgress(row: typeof fundraisingCampaign.$inferSelect, prog?: { cents: number; donors: number }): CampaignWithProgress {
  const raisedCents = prog?.cents ?? 0;
  const goalPct = row.goalCents && row.goalCents > 0
    ? Math.min(100, Math.round((raisedCents / row.goalCents) * 100))
    : null;
  return {
    id: row.id,
    slug: row.slug,
    campaignType: row.campaignType,
    title: row.title,
    story: row.story,
    goalCents: row.goalCents,
    coverImageUrl: row.coverImageUrl,
    logoUrl: row.logoUrl,
    backgroundImageUrl: row.backgroundImageUrl,
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    backgroundColor: row.backgroundColor,
    status: row.status,
    crowdedFormId: row.crowdedFormId,
    campaignId: row.campaignId,
    parentCampaignId: row.parentCampaignId,
    ghlTag: row.ghlTag,
    teamEnabled: row.teamEnabled,
    ownerName: row.ownerName,
    processor: row.processor,
    donorCoversFees: row.donorCoversFees,
    donationCap: row.donationCap,
    raisedCents,
    donorCount: prog?.donors ?? 0,
    goalPct,
    createdAt: row.createdAt,
  };
}

/**
 * Sub-campaigns (children / peer-to-peer team pages) of a parent, each with
 * its own progress. Used for the parent page's rollup + P2P leaderboard.
 */
export async function getSubCampaigns(locationId: string, parentId: number): Promise<CampaignWithProgress[]> {
  const rows = await resolveOwnerNames(
    await db
      .select()
      .from(fundraisingCampaign)
      .where(and(eq(fundraisingCampaign.locationId, locationId), eq(fundraisingCampaign.parentCampaignId, parentId)))
      .orderBy(desc(fundraisingCampaign.createdAt)),
  );
  const formIds = rows.map((r) => r.crowdedFormId).filter((x): x is number => x != null);
  const [progByForm, progByCampaign] = await Promise.all([
    raisedByForm(locationId, formIds),
    raisedByCampaign(locationId, rows.map((r) => r.id)),
  ]);
  return rows.map((r) =>
    withProgress(r, combineProgress(r.crowdedFormId != null ? progByForm.get(r.crowdedFormId) : undefined, progByCampaign.get(r.id))),
  );
}

export async function listCampaigns(locationId: string): Promise<CampaignWithProgress[]> {
  const rows = await resolveOwnerNames(
    await db
      .select()
      .from(fundraisingCampaign)
      .where(eq(fundraisingCampaign.locationId, locationId))
      .orderBy(desc(fundraisingCampaign.createdAt)),
  );
  const formIds = rows.map((r) => r.crowdedFormId).filter((x): x is number => x != null);
  const [progByForm, progByCampaign] = await Promise.all([
    raisedByForm(locationId, formIds),
    raisedByCampaign(locationId, rows.map((r) => r.id)),
  ]);
  return rows.map((r) =>
    withProgress(r, combineProgress(r.crowdedFormId != null ? progByForm.get(r.crowdedFormId) : undefined, progByCampaign.get(r.id))),
  );
}

export async function getCampaignById(locationId: string, id: number): Promise<CampaignWithProgress | null> {
  const [rawRow] = await db
    .select()
    .from(fundraisingCampaign)
    .where(and(eq(fundraisingCampaign.locationId, locationId), eq(fundraisingCampaign.id, id)))
    .limit(1);
  if (!rawRow) return null;
  const [row] = await resolveOwnerNames([rawRow]);
  const [progByForm, progByCampaign] = await Promise.all([
    row.crowdedFormId != null ? raisedByForm(locationId, [row.crowdedFormId]) : Promise.resolve(new Map()),
    raisedByCampaign(locationId, [row.id]),
  ]);
  const prog = combineProgress(row.crowdedFormId != null ? progByForm.get(row.crowdedFormId) : undefined, progByCampaign.get(row.id));
  return withProgress(row, prog);
}

/** Public: sub-campaigns of a parent (for the P2P leaderboard). No auth. */
export async function getPublicSubCampaigns(parentId: number): Promise<CampaignWithProgress[]> {
  const rawRows = await db
    .select()
    .from(fundraisingCampaign)
    .where(eq(fundraisingCampaign.parentCampaignId, parentId))
    .orderBy(desc(fundraisingCampaign.createdAt));
  if (rawRows.length === 0) return [];
  const rows = await resolveOwnerNames(rawRows);
  const locationId = rows[0].locationId;
  const formIds = rows.map((r) => r.crowdedFormId).filter((x): x is number => x != null);
  const [progByForm, progByCampaign] = await Promise.all([
    raisedByForm(locationId, formIds),
    raisedByCampaign(locationId, rows.map((r) => r.id)),
  ]);
  return rows
    .map((r) =>
      withProgress(r, combineProgress(r.crowdedFormId != null ? progByForm.get(r.crowdedFormId) : undefined, progByCampaign.get(r.id))),
    )
    .sort((a, b) => b.raisedCents - a.raisedCents);
}

/** Public lookup by slug (any tenant) — used by the hosted /f/[slug] page. */
export async function getPublicCampaignBySlug(slug: string): Promise<CampaignWithProgress | null> {
  const [rawRow] = await db
    .select()
    .from(fundraisingCampaign)
    .where(eq(fundraisingCampaign.slug, slug))
    .limit(1);
  if (!rawRow) return null;
  const [row] = await resolveOwnerNames([rawRow]);
  const [progByForm, progByCampaign] = await Promise.all([
    row.crowdedFormId != null ? raisedByForm(row.locationId, [row.crowdedFormId]) : Promise.resolve(new Map()),
    raisedByCampaign(row.locationId, [row.id]),
  ]);
  const prog = combineProgress(row.crowdedFormId != null ? progByForm.get(row.crowdedFormId) : undefined, progByCampaign.get(row.id));
  return withProgress(row, prog);
}

/** Public: locationId for a campaign id (no tenant scoping — used by public checkout/webhook routes). */
export async function getCampaignLocationId(id: number): Promise<string | null> {
  const [row] = await db
    .select({ locationId: fundraisingCampaign.locationId })
    .from(fundraisingCampaign)
    .where(eq(fundraisingCampaign.id, id))
    .limit(1);
  return row?.locationId ?? null;
}

export async function createCampaign(values: NewFundraisingCampaign) {
  const [row] = await db.insert(fundraisingCampaign).values(values).returning();
  return row;
}

export async function updateCampaign(locationId: string, id: number, patch: Partial<NewFundraisingCampaign>) {
  const [row] = await db
    .update(fundraisingCampaign)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(fundraisingCampaign.locationId, locationId), eq(fundraisingCampaign.id, id)))
    .returning();
  return row ?? null;
}
