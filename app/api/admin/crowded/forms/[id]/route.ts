/**
 * GET    /api/admin/crowded/forms/[id]
 * PATCH  /api/admin/crowded/forms/[id]   — edit branding / mapping only.
 *                                          Title + recurring + amount
 *                                          changes don't re-call Crowded
 *                                          for v1 (Crowded's collection
 *                                          PATCH endpoint isn't in the
 *                                          documented subset we use).
 * DELETE /api/admin/crowded/forms/[id]   — soft delete (is_active=false).
 *                                          The Crowded collection stays
 *                                          live unless admin manages it
 *                                          on Crowded's side.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { crowdedForms } from "@/lib/db/schema-crowded";
import { requireCrowdedAdmin } from "@/lib/crowded/auth-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
  campaignId: z.number().int().nullable().optional(),
  categoryId: z.number().int().nullable().optional(),
  categoryItemId: z.number().int().nullable().optional(),
  accountId: z.number().int().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).nullable().optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).nullable().optional(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  heroImageUrl: z.string().url().nullable().optional(),
  headline: z.string().max(200).nullable().optional(),
  tagline: z.string().max(280).nullable().optional(),
  successMessage: z.string().max(500).nullable().optional(),
  submitLabel: z.string().max(60).nullable().optional(),
  suggestedAmounts: z.array(z.number().int().min(1)).max(8).nullable().optional(),
  askAddress: z.boolean().optional(),
  askPhone: z.boolean().optional(),
  askTribute: z.boolean().optional(),
  askComments: z.boolean().optional(),
  requireConsent: z.boolean().optional(),
  feeCoverDefault: z.enum(["donor", "org"]).optional(),
  successUrl: z.string().url().nullable().optional(),
  failureUrl: z.string().url().nullable().optional(),
});

async function loadForm(formId: number, locationId: string) {
  const [row] = await db
    .select()
    .from(crowdedForms)
    .where(
      and(eq(crowdedForms.id, formId), eq(crowdedForms.locationId, locationId)),
    )
    .limit(1);
  return row ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;

  const { id } = await params;
  const formId = parseInt(id, 10);
  if (Number.isNaN(formId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const form = await loadForm(formId, guard.session.user.locationId);
  if (!form) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ form });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;

  const { id } = await params;
  const formId = parseInt(id, 10);
  if (Number.isNaN(formId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const existing = await loadForm(formId, guard.session.user.locationId);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation_failed",
        details: parsed.error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      },
      { status: 400 },
    );
  }

  const [row] = await db
    .update(crowdedForms)
    .set({
      ...parsed.data,
      updatedAt: new Date(),
    })
    .where(eq(crowdedForms.id, formId))
    .returning();

  return NextResponse.json({ form: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;

  const { id } = await params;
  const formId = parseInt(id, 10);
  if (Number.isNaN(formId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const existing = await loadForm(formId, guard.session.user.locationId);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db
    .update(crowdedForms)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(crowdedForms.id, formId));

  return NextResponse.json({ ok: true });
}
