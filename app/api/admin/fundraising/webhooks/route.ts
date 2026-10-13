/**
 * GET/POST /api/admin/fundraising/webhooks — self-serve donation webhooks.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCrowdedAdmin } from "@/lib/crowded/auth-guard";
import { listWebhooks, createWebhook } from "@/lib/fundraising/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  url: z.string().url("Enter a valid https URL").max(2000),
  campaignId: z.coerce.number().int().positive().optional().nullable(),
  event: z.string().max(40).optional(),
});

export async function GET() {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;
  const webhooks = await listWebhooks(guard.session.user.locationId);
  return NextResponse.json({ webhooks });
}

export async function POST(request: NextRequest) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  const created = await createWebhook({
    locationId: guard.session.user.locationId,
    url: parsed.data.url,
    campaignId: parsed.data.campaignId ?? null,
    event: parsed.data.event || "donation.succeeded",
    createdBy: guard.session.user.id ? Number(guard.session.user.id) : null,
  });
  return NextResponse.json({ webhook: created }, { status: 201 });
}
