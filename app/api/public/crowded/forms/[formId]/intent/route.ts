/**
 * POST /api/public/crowded/forms/[formId]/intent
 *
 * Public, unauthenticated endpoint. Called by the donor page when the
 * donor clicks "Donate". Server-side responsibilities:
 *
 *   1. Read donor inputs from the body (name / email / amount / consent
 *      checkbox / optional address+phone+tribute / optional payment plan).
 *   2. Load the form row + the location's Crowded connection.
 *   3. Pull payerIp from request headers (NEVER trust the body's IP).
 *   4. Call Crowded createIntent. Returns { paymentUrl, embeddedToken? }.
 *   5. Browser redirects (today) or mounts the SDK widget (future).
 *
 * IMPORTANT — only fires on the donor's submit action. Never on page
 * load. Crowded's intent endpoint is rate-limited (1000/min/partner),
 * and orphan intents pollute their dashboard.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { crowdedForms } from "@/lib/db/schema-crowded";
import {
  decryptApiToken,
  getConnectionForLocation,
} from "@/lib/crowded/connection-storage";
import {
  CrowdedApiError,
  createIntent,
  type CrowdedPaymentPlanInput,
} from "@/lib/crowded/api-client";
import { getCanonicalAppUrl } from "@/lib/config/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const intentSchema = z.object({
  /** USD whole dollars, e.g. 25. Min 1. */
  amount: z.number().int().min(1),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  mobile: z.string().trim().max(40).optional().nullable(),
  /** Must be true — Crowded refuses the intent otherwise. */
  consent: z.literal(true),
  /** Recurring opt-in — only effective if the form has recurringEnabled. */
  recurring: z.boolean().optional(),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]).optional(),
  /** Hidden tribute fields (optional, only if form.askTribute). */
  tributeName: z.string().max(120).optional().nullable(),
  tributeType: z.enum(["memory", "honor"]).optional().nullable(),
  /** Optional address (only if form.askAddress). */
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(120).optional().nullable(),
  postal: z.string().max(40).optional().nullable(),
  country: z.string().max(80).optional().nullable(),
});

function extractDonorIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ formId: string }> },
) {
  const { formId: formIdRaw } = await params;
  const formId = parseInt(formIdRaw, 10);
  if (Number.isNaN(formId)) {
    return NextResponse.json({ error: "invalid_form_id" }, { status: 400 });
  }

  // 1. Validate body.
  const body = (await req.json().catch(() => ({}))) as unknown;
  const parsed = intentSchema.safeParse(body);
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

  // 2. Load form. Must be active.
  const [form] = await db
    .select()
    .from(crowdedForms)
    .where(and(eq(crowdedForms.id, formId), eq(crowdedForms.isActive, true)))
    .limit(1);
  if (!form) {
    return NextResponse.json({ error: "form_not_found" }, { status: 404 });
  }
  if (form.type === "dues" && form.amountCents) {
    // Lock fixed-amount forms — ignore whatever was in the body.
    v.amount = form.amountCents / 100;
  }

  // 3. Load the connection for this form's location. Need its API token.
  const conn = await getConnectionForLocation(form.locationId);
  if (!conn || conn.status !== "active") {
    return NextResponse.json(
      {
        error: "connection_unavailable",
        message: "This donation form is temporarily unavailable. Please try again later.",
      },
      { status: 503 },
    );
  }

  // 4. Build Crowded payload.
  const apiToken = decryptApiToken(conn);
  const appUrl = getCanonicalAppUrl();
  const successUrl = form.successUrl ?? `${appUrl}/donate/${form.id}/thank-you`;
  const failureUrl = form.failureUrl ?? `${appUrl}/donate/${form.id}/failed`;

  let plan: CrowdedPaymentPlanInput | undefined;
  if (form.recurringEnabled && v.recurring && v.frequency) {
    plan = {
      type: "recurring",
      timeInterval: v.frequency,
    };
  }

  try {
    const intent = await createIntent(
      apiToken,
      form.chapterId,
      form.crowdedCollectionId,
      {
        requestedAmount: v.amount * 100,
        payerIp: extractDonorIp(req),
        userConsented: true,
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        mobile: v.mobile ?? undefined,
        successUrl,
        failureUrl,
        paymentPlan: plan,
      },
    );
    return NextResponse.json({
      paymentUrl: intent.paymentUrl,
      contactId: intent.contactId ?? null,
    });
  } catch (err) {
    if (err instanceof CrowdedApiError) {
      console.error(
        `[crowded-intent] form=${formId} location=${form.locationId} status=${err.status}`,
        err.body,
      );
      // Auth-error on the public path → don't leak detail.
      return NextResponse.json(
        {
          error: "intent_failed",
          message:
            err.status === 401 || err.status === 403
              ? "This donation form is temporarily unavailable."
              : "We couldn't process your donation. Please try again.",
        },
        { status: err.status === 401 || err.status === 403 ? 503 : 502 },
      );
    }
    return NextResponse.json(
      {
        error: "intent_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
