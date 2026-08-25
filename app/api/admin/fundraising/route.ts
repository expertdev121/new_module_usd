/**
 * Admin API for the Fundraising / Campaign platform.
 *   GET  /api/admin/fundraising  → list this account's campaigns (with progress)
 *   POST /api/admin/fundraising  → create a campaign
 * Auth: admin/super_admin + locationId (reuses the Crowded admin guard).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCrowdedAdmin } from "@/lib/crowded/auth-guard";
import { listCampaigns, createCampaign, uniqueSlug } from "@/lib/fundraising/repo";
import { CAMPAIGN_STATUSES } from "@/lib/db/schema-fundraising";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(140),
  story: z.string().max(20000).optional().nullable(),
  goalCents: z.coerce.number().int().min(0).optional().nullable(),
  coverImageUrl: z.string().url().max(2000).optional().nullable().or(z.literal("")),
  primaryColor: z.string().max(9).optional().nullable(),
  accentColor: z.string().max(9).optional().nullable(),
  backgroundColor: z.string().max(9).optional().nullable(),
  status: z.enum(CAMPAIGN_STATUSES).default("active"),
  crowdedFormId: z.coerce.number().int().positive().optional().nullable(),
  campaignId: z.coerce.number().int().positive().optional().nullable(),
  parentCampaignId: z.coerce.number().int().positive().optional().nullable(),
  slug: z.string().trim().max(80).optional(),
});

export async function GET() {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;
  const campaigns = await listCampaigns(guard.session.user.locationId);
  return NextResponse.json({ campaigns });
}

export async function POST(request: NextRequest) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;
  const locationId = guard.session.user.locationId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const slug = await uniqueSlug(locationId, d.slug?.trim() || d.title);

  const created = await createCampaign({
    locationId,
    slug,
    title: d.title,
    story: d.story ?? null,
    goalCents: d.goalCents ?? null,
    coverImageUrl: d.coverImageUrl || null,
    primaryColor: d.primaryColor ?? null,
    accentColor: d.accentColor ?? null,
    backgroundColor: d.backgroundColor ?? null,
    status: d.status,
    crowdedFormId: d.crowdedFormId ?? null,
    campaignId: d.campaignId ?? null,
    parentCampaignId: d.parentCampaignId ?? null,
    createdBy: guard.session.user.id ? Number(guard.session.user.id) : null,
  });

  return NextResponse.json({ campaign: created }, { status: 201 });
}
