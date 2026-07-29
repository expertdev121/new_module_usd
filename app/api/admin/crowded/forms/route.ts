/**
 * GET  /api/admin/crowded/forms — list the admin's forms.
 * POST /api/admin/crowded/forms — create a new form (also creates the
 *                                 Crowded collection under the hood).
 *
 * On create:
 *   1. Validate body
 *   2. Call Crowded POST /collections → get collectionId
 *   3. Persist crowded_forms row with branding + mapping
 *   4. Return the row (sanitized — no Crowded token leaks possible)
 *
 * On any failure between #2 and #3 we don't get to clean up the Crowded
 * collection — it's an orphan on their side. That's acceptable for v1;
 * unused collections cost nothing and admins can ignore them.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { crowdedForms } from "@/lib/db/schema-crowded";
import { requireCrowdedAdmin } from "@/lib/crowded/auth-guard";
import {
  decryptApiToken,
  getConnectionForLocation,
} from "@/lib/crowded/connection-storage";
import { createCollection, CrowdedApiError } from "@/lib/crowded/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createFormSchema = z.object({
  name: z.string().trim().min(1).max(50),
  type: z.enum(["donation", "dues"]).default("donation"),
  /** USD whole dollars — converted to cents server-side. */
  amount: z.number().int().min(1).optional(),
  goal: z.number().int().min(1).optional(),
  recurringEnabled: z.boolean().default(false),

  campaignId: z.number().int().optional().nullable(),
  categoryId: z.number().int().optional().nullable(),
  categoryItemId: z.number().int().optional().nullable(),
  accountId: z.number().int().optional().nullable(),

  primaryColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional().nullable(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional().nullable(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  heroImageUrl: z.string().url().optional().nullable(),
  headline: z.string().max(200).optional().nullable(),
  tagline: z.string().max(280).optional().nullable(),
  successMessage: z.string().max(500).optional().nullable(),
  submitLabel: z.string().max(60).optional().nullable(),
  suggestedAmounts: z.array(z.number().int().min(1)).max(8).optional().nullable(),

  askAddress: z.boolean().default(true),
  askPhone: z.boolean().default(false),
  askTribute: z.boolean().default(false),
  askComments: z.boolean().default(false),
  requireConsent: z.boolean().default(true),
  feeCoverDefault: z.enum(["donor", "org"]).default("donor"),

  successUrl: z.string().url().optional().nullable(),
  failureUrl: z.string().url().optional().nullable(),
});

export async function GET() {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;

  const rows = await db
    .select()
    .from(crowdedForms)
    .where(eq(crowdedForms.locationId, guard.session.user.locationId))
    .orderBy(asc(crowdedForms.createdAt));

  return NextResponse.json({ forms: rows });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;
  const locationId = guard.session.user.locationId;

  // Must have an active connection first.
  const conn = await getConnectionForLocation(locationId);
  if (!conn || conn.status !== "active") {
    return NextResponse.json(
      {
        error: "no_connection",
        message:
          "Connect Crowded first before creating forms. Settings → Crowded → Connect.",
      },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = createFormSchema.safeParse(body);
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
  const v = parsed.data;

  // dues forms REQUIRE a fixed amount.
  if (v.type === "dues" && (!v.amount || v.amount < 1)) {
    return NextResponse.json(
      {
        error: "amount_required",
        message: "Fixed-amount (dues) forms require an `amount` of at least 1.",
      },
      { status: 400 },
    );
  }

  // 1. Create the Crowded collection.
  const apiToken = decryptApiToken(conn);
  let collectionId: string;
  try {
    const created = await createCollection(apiToken, conn.chapterId, {
      title: v.name,
      requestedAmount: v.amount ? v.amount * 100 : undefined,
      goalAmount: v.goal ? v.goal * 100 : undefined,
      recurringPaymentsEnabled: v.recurringEnabled,
    });
    if (!created.id) {
      throw new Error("Crowded createCollection returned no id");
    }
    collectionId = created.id;
  } catch (err) {
    if (err instanceof CrowdedApiError && err.isAuthError) {
      // Mark connection as needs_reconnect so the admin sees a clear nudge.
      const { markNeedsReconnect } = await import(
        "@/lib/crowded/connection-storage"
      );
      await markNeedsReconnect(locationId).catch(() => {});
      return NextResponse.json(
        {
          error: "needs_reconnect",
          message: "Crowded rejected the saved API key. Reconnect from Settings.",
        },
        { status: 401 },
      );
    }
    // Feature-gate 401 — token is fine, but the chapter can't do this action.
    // Most common trigger: recurringPaymentsEnabled=true when the chapter
    // hasn't been enabled for recurring on Crowded's side. Do NOT flip the
    // connection to needs_reconnect; nudge the admin to fix the form input.
    if (err instanceof CrowdedApiError && err.isPermissionDenied) {
      const hint = v.recurringEnabled
        ? "Recurring donations aren't enabled on your Crowded chapter. Contact Crowded support to enable recurring payments, or turn OFF the recurring toggle to save this form."
        : "This chapter doesn't have permission to create the requested collection type. Contact Crowded support.";
      return NextResponse.json(
        {
          error: "permission_denied",
          message: hint,
          crowdedStatus: err.status,
          crowdedBody: err.body,
        },
        { status: 403 },
      );
    }
    const crowdedStatus =
      err instanceof CrowdedApiError ? err.status : undefined;
    const crowdedBody =
      err instanceof CrowdedApiError ? err.body : undefined;
    console.error("[crowded] createCollection failed", {
      status: crowdedStatus,
      body: crowdedBody,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: "create_collection_failed",
        message: err instanceof Error ? err.message : String(err),
        crowdedStatus,
        crowdedBody,
      },
      { status: 502 },
    );
  }

  // 2. Persist the local form row.
  const createdBy = guard.session.user.id
    ? parseInt(String(guard.session.user.id), 10) || null
    : null;

  const [row] = await db
    .insert(crowdedForms)
    .values({
      locationId,
      chapterId: conn.chapterId,
      crowdedCollectionId: collectionId,
      name: v.name,
      type: v.type,
      amountCents: v.amount ? v.amount * 100 : null,
      goalCents: v.goal ? v.goal * 100 : null,
      recurringEnabled: v.recurringEnabled,
      campaignId: v.campaignId ?? null,
      categoryId: v.categoryId ?? null,
      categoryItemId: v.categoryItemId ?? null,
      accountId: v.accountId ?? null,
      primaryColor: v.primaryColor ?? null,
      accentColor: v.accentColor ?? null,
      backgroundColor: v.backgroundColor ?? null,
      logoUrl: v.logoUrl ?? null,
      heroImageUrl: v.heroImageUrl ?? null,
      headline: v.headline ?? null,
      tagline: v.tagline ?? null,
      successMessage: v.successMessage ?? null,
      submitLabel: v.submitLabel ?? null,
      suggestedAmounts: v.suggestedAmounts ?? null,
      askAddress: v.askAddress,
      askPhone: v.askPhone,
      askTribute: v.askTribute,
      askComments: v.askComments,
      requireConsent: v.requireConsent,
      feeCoverDefault: v.feeCoverDefault,
      successUrl: v.successUrl ?? null,
      failureUrl: v.failureUrl ?? null,
      isActive: true,
      createdBy,
    })
    .returning();

  void (async () => {
    try {
      const { logAudit } = await import("@/lib/audit");
      await logAudit("crowded_form_create", {
        entity: "crowded_forms",
        formId: row.id,
        crowdedCollectionId: collectionId,
        locationId,
        name: v.name,
        triggeredBy: guard.session.user.email ?? guard.session.user.id,
      });
    } catch {
      /* non-fatal */
    }
  })();

  return NextResponse.json({ form: row }, { status: 201 });
}
