/**
 * POST /api/webhook/stripe/fundraising/:locationId
 *
 * Per-tenant Stripe webhook receiver for Fundraising Campaign donations.
 * The locationId is embedded in the URL (not a real Stripe Connect account —
 * tenants use their own root account hit directly via their own secret key,
 * so there's no `event.account` field to disambiguate tenants by) — see
 * lib/stripe-connect/webhook-registration.ts for how the endpoint URL is
 * built and registered.
 *
 * Handles checkout.session.completed / checkout.session.async_payment_succeeded
 * for sessions whose payment_status is "paid", writing (or dedup-skipping) a
 * manual_donation row via lib/fundraising/stripe-donations.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyStripeWebhookSignature } from "@/lib/public-stripe-payments";
import { getConnectionForLocation, decryptWebhookSecret } from "@/lib/stripe-connect/connection-storage";
import { createManualDonationForFundraisingCheckout } from "@/lib/fundraising/stripe-donations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutSession = {
  id: string;
  payment_intent?: string | null;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
  customer_details?: { email?: string | null; name?: string | null } | null;
  customer_email?: string | null;
  created?: number;
  metadata?: Record<string, string>;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params;

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const connection = await getConnectionForLocation(locationId);
  const webhookSecret = connection ? decryptWebhookSecret(connection) : null;
  if (!connection || !webhookSecret) {
    console.error(`[fundraising-webhook] No connection/webhook secret on file for locationId=${locationId}`);
    return NextResponse.json({ error: "Unknown or unconfigured webhook endpoint" }, { status: 400 });
  }

  try {
    verifyStripeWebhookSignature(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error(`[fundraising-webhook] Signature verification failed for locationId=${locationId}:`, err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: CheckoutSession } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventType = event.type;
  if (eventType !== "checkout.session.completed" && eventType !== "checkout.session.async_payment_succeeded") {
    // Any other event type we didn't explicitly subscribe to — ack so Stripe stops retrying.
    return NextResponse.json({ received: true, ignored: eventType ?? "unknown" });
  }

  const session = event.data?.object;
  if (!session) {
    return NextResponse.json({ error: "Missing event.data.object" }, { status: 400 });
  }

  if (session.payment_status !== "paid") {
    // completed-but-unpaid (e.g. still awaiting an async payment method) — wait for the async event.
    return NextResponse.json({ received: true, skipped: "not_paid_yet" });
  }

  const metadata = session.metadata ?? {};
  if (metadata.location_id && metadata.location_id !== locationId) {
    console.error(`[fundraising-webhook] Metadata locationId mismatch: URL=${locationId}, metadata=${metadata.location_id}`);
    return NextResponse.json({ error: "Location mismatch" }, { status: 400 });
  }

  const fundraisingCampaignId = Number.parseInt(metadata.fundraising_campaign_id ?? "", 10);
  if (!Number.isFinite(fundraisingCampaignId)) {
    console.error(`[fundraising-webhook] Missing/invalid fundraising_campaign_id metadata on session ${session.id}`);
    return NextResponse.json({ error: "Missing fundraising_campaign_id metadata" }, { status: 400 });
  }

  const paymentIntentId = session.payment_intent;
  if (!paymentIntentId) {
    console.error(`[fundraising-webhook] Missing payment_intent on session ${session.id}`);
    return NextResponse.json({ error: "Missing payment_intent" }, { status: 400 });
  }

  const email = session.customer_details?.email || session.customer_email || "";
  const name = `${metadata.donor_first_name ?? ""} ${metadata.donor_last_name ?? ""}`.trim() || session.customer_details?.name || "Donor";
  const amountInCents = session.amount_total ?? 0;
  const baseAmountInCents = Number.parseInt(metadata.base_cents ?? "", 10) || amountInCents;
  const coveredFees = metadata.cover_fees === "true";

  if (!email || amountInCents <= 0) {
    console.error(`[fundraising-webhook] Missing email or non-positive amount on session ${session.id}`);
    return NextResponse.json({ error: "Missing donor email or amount" }, { status: 400 });
  }

  try {
    const result = await createManualDonationForFundraisingCheckout({
      paymentIntentId,
      fundraisingCampaignId,
      locationId,
      name,
      email,
      amountInCents,
      baseAmountInCents,
      coveredFees,
      paidAtUnix: session.created,
    });
    return NextResponse.json({ received: true, donationId: result.donationId, created: result.created, skipped: result.skipped });
  } catch (err) {
    console.error(`[fundraising-webhook] Failed to record donation for session ${session.id}:`, err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Failed to record donation" }, { status: 500 });
  }
}
