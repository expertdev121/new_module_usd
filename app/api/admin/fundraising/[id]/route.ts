/**
 * GET/PATCH/DELETE /api/admin/fundraising/:id — one campaign.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCrowdedAdmin } from "@/lib/crowded/auth-guard";
import { getCampaignById, updateCampaign, uniqueSlug } from "@/lib/fundraising/repo";
import { CAMPAIGN_STATUSES } from "@/lib/db/schema-fundraising";
import { db } from "@/lib/db";
import { fundraisingCampaign } from "@/lib/db/schema-fundraising";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  story: z.string().max(20000).optional().nullable(),
  goalCents: z.coerce.number().int().min(0).optional().nullable(),
  coverImageUrl: z.string().url().max(2000).optional().nullable().or(z.literal("")),
  primaryColor: z.string().max(9).optional().nullable(),
  accentColor: z.string().max(9).optional().nullable(),
  backgroundColor: z.string().max(9).optional().nullable(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  crowdedFormId: z.coerce.number().int().positive().optional().nullable(),
  campaignId: z.coerce.number().int().positive().optional().nullable(),
  slug: z.string().trim().max(80).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;
  const { id } = await params;
  const campaign = await getCampaignById(guard.session.user.locationId, Number(id));
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ campaign });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;
  const locationId = guard.session.user.locationId;
  const { id } = await params;
  const campaignId = Number(id);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const patch: Record<string, unknown> = {};
  if (d.title !== undefined) patch.title = d.title;
  if (d.story !== undefined) patch.story = d.story;
  if (d.goalCents !== undefined) patch.goalCents = d.goalCents;
  if (d.coverImageUrl !== undefined) patch.coverImageUrl = d.coverImageUrl || null;
  if (d.primaryColor !== undefined) patch.primaryColor = d.primaryColor;
  if (d.accentColor !== undefined) patch.accentColor = d.accentColor;
  if (d.backgroundColor !== undefined) patch.backgroundColor = d.backgroundColor;
  if (d.status !== undefined) patch.status = d.status;
  if (d.crowdedFormId !== undefined) patch.crowdedFormId = d.crowdedFormId;
  if (d.campaignId !== undefined) patch.campaignId = d.campaignId;
  if (d.slug !== undefined) patch.slug = await uniqueSlug(locationId, d.slug, campaignId);

  const updated = await updateCampaign(locationId, campaignId, patch);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ campaign: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;
  const { id } = await params;
  const [deleted] = await db
    .delete(fundraisingCampaign)
    .where(and(eq(fundraisingCampaign.locationId, guard.session.user.locationId), eq(fundraisingCampaign.id, Number(id))))
    .returning({ id: fundraisingCampaign.id });
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, id: deleted.id });
}
