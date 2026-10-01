/**
 * POST /api/public/fundraising/:slug/checkout
 *
 * Public (no auth) — starts a Stripe Checkout Session for a donation to a
 * Stripe-processor fundraising campaign. Donor is redirected to the returned
 * `url` (Stripe-hosted Checkout page) to enter card details; DonorHQ never
 * sees card data. The actual manual_donation row is only written once Stripe
 * confirms payment via the webhook (app/api/webhook/stripe/fundraising/[locationId]) —
 * this route never writes a donation itself.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPublicCampaignBySlug, getCampaignLocationId } from "@/lib/fundraising/repo";
import { getConnectionForLocation, decryptSecretKey } from "@/lib/stripe-connect/connection-storage";
import { createCampaignCheckoutSession } from "@/lib/fundraising/checkout";
import { grossUpForFees } from "@/lib/fundraising/fee-math";
import { parseAmountToCents } from "@/lib/money/parse-amount";
import { getCanonicalAppUrl } from "@/lib/config/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  amount: z.union([z.string(), z.number()]),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  coverFees: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const baseCents = parseAmountToCents(d.amount);
  if (baseCents === null || baseCents < 100) {
    return NextResponse.json({ error: "Amount must be at least $1.00" }, { status: 400 });
  }

  const campaign = await getPublicCampaignBySlug(slug);
  if (!campaign || campaign.status !== "active") {
    return NextResponse.json({ error: "Campaign not found or not accepting donations" }, { status: 404 });
  }
  if (campaign.processor !== "stripe") {
    return NextResponse.json({ error: "This campaign does not use Stripe Checkout" }, { status: 400 });
  }
  if (campaign.donationCap && campaign.goalCents != null && campaign.raisedCents >= campaign.goalCents) {
    return NextResponse.json({ error: "This campaign has reached its goal and is no longer accepting donations" }, { status: 400 });
  }

  const locationId = await getCampaignLocationId(campaign.id);
  if (!locationId) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const connection = await getConnectionForLocation(locationId);
  if (!connection || connection.status !== "active") {
    return NextResponse.json({ error: "Payment processor is not connected for this campaign" }, { status: 400 });
  }
  const secretKey = decryptSecretKey(connection);

  const chargeCents = d.coverFees ? grossUpForFees(baseCents) : baseCents;

  const appBaseUrl = getCanonicalAppUrl({ request });
  const successUrl = `${appBaseUrl}/f/${slug}/thank-you?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appBaseUrl}/f/${slug}/donate`;

  try {
    const session = await createCampaignCheckoutSession({
      secretKey,
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      locationId,
      chargeCents,
      baseCents,
      coverFees: d.coverFees,
      donorFirstName: d.firstName,
      donorLastName: d.lastName,
      donorEmail: d.email.trim().toLowerCase(),
      successUrl,
      cancelUrl,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[fundraising-checkout] Stripe error:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "We couldn't start your donation. Please try again." }, { status: 502 });
  }
}
