import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  CMN_STRIPE_LOCATION_ID,
  createManualDonationForBenchmarkPayment,
  createManualDonationForPublicStripePayment,
  formatUsdAmountFromCents,
  getStripePaymentMethodType,
  stripeApiRequest,
  type PublicStripeStatus,
  type StripePaymentIntentEventObject,
  verifyStripeWebhookSignature,
} from "@/lib/public-stripe-payments";

export const runtime = "nodejs";

// ── Audit logger ──────────────────────────────────────────────────────────────

function auditLog(level: "INFO" | "WARN" | "ERROR", step: string, data?: unknown) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    step,
    ...(data !== undefined ? { data } : {}),
  };

  const line = JSON.stringify(entry);
  console.log(`[CMN WEBHOOK ${level}] ${step}`, data ?? "");

  try {
    const logDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "cmn-webhook.log"), line + "\n", "utf8");
  } catch {
    // file logging is best-effort
  }
}

// ── Event type map ────────────────────────────────────────────────────────────

type StripeWebhookEvent = {
  type: string;
  data?: {
    object?: StripePaymentIntentEventObject;
  };
};

function mapEventTypeToStatus(eventType: string): PublicStripeStatus | null {
  // Initial one-time or first subscription charge.
  if (eventType === "payment_intent.succeeded")      return "succeeded";
  if (eventType === "payment_intent.processing")     return "processing";
  if (eventType === "payment_intent.payment_failed") return "failed";
  // Recurring subscription renewals — MUST be handled or every renewal
  // after month 1 vanishes from DonorHQ. Stripe fires these on each cycle.
  if (eventType === "invoice.paid")                  return "succeeded";
  if (eventType === "invoice.payment_succeeded")     return "succeeded";
  if (eventType === "invoice.payment_failed")        return "failed";
  return null;
}

// Given a raw Stripe event, return the PaymentIntent object we should
// process. For payment_intent.* events, that's just the event object.
// For invoice.* events, we look up the linked PaymentIntent via the
// invoice, so downstream code is unchanged. Returns null if we can't
// resolve one (e.g. invoice with no PI, subscription-level events).
async function resolvePaymentIntentFromEvent(
  event: StripeWebhookEvent,
): Promise<StripePaymentIntentEventObject | null> {
  const type = event.type;
  const raw = event.data?.object as Record<string, unknown> | undefined;
  if (!raw) return null;

  if (type.startsWith("payment_intent.")) {
    return raw as StripePaymentIntentEventObject;
  }

  if (type.startsWith("invoice.")) {
    // Invoice payload — pull the linked PaymentIntent.
    const invoice = raw;
    // Prefer confirmation_secret.payment_intent (new API) then payment_intent
    // (old API). Both may be a string id or an object.
    const piField =
      (invoice.payment_intent as string | { id?: string } | undefined) ??
      ((invoice.confirmation_secret as { payment_intent?: unknown } | undefined)?.payment_intent as
        | string
        | { id?: string }
        | undefined);
    const piId =
      typeof piField === "string" ? piField : piField?.id ?? null;
    if (!piId) {
      // ACH renewals sometimes fire invoice.paid AFTER the PI is deleted from
      // the invoice (rare). Bail — a subsequent payment_intent.* event should
      // still land.
      auditLog("WARN", "invoice_event_no_payment_intent", { invoiceId: invoice.id });
      return null;
    }
    // Fetch the full PI so we have amount, metadata, payment_method, etc.
    const pi = await cmnStripeRequest(`/payment_intents/${piId}`);
    // Attach the invoice's subscription id so the fallback below can inherit
    // its metadata if needed.
    if (pi && typeof invoice.subscription === "string" && !pi.metadata?.subscription_id) {
      pi.metadata = { ...(pi.metadata ?? {}), subscription_id: invoice.subscription };
    }
    return pi as StripePaymentIntentEventObject;
  }

  return null;
}

// If a PaymentIntent came from a subscription renewal, its metadata will
// usually be EMPTY — Stripe does not copy Subscription metadata onto the
// renewal PI automatically. Backfill from the Subscription so donor info,
// campaign, and form_source are consistent across cycles.
async function backfillMetadataFromSubscription(
  pi: StripePaymentIntentEventObject,
): Promise<void> {
  const currentMeta = pi.metadata ?? {};
  const hasIdentity = currentMeta.name && currentMeta.email && currentMeta.location_id;
  if (hasIdentity) return;

  // Find the subscription id — either already annotated, or via invoice link.
  let subId = currentMeta.subscription_id;
  if (!subId) {
    const invoiceIdRaw = (pi as unknown as { invoice?: string | { id?: string } }).invoice;
    const invoiceId =
      typeof invoiceIdRaw === "string" ? invoiceIdRaw : invoiceIdRaw?.id ?? null;
    if (invoiceId) {
      try {
        const invoice = await cmnStripeRequest(`/invoices/${invoiceId}`);
        subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
      } catch {
        // best-effort
      }
    }
  }
  if (!subId) return;

  try {
    const sub = await cmnStripeRequest(`/subscriptions/${subId}`);
    const subMeta = (sub?.metadata ?? {}) as Record<string, string>;
    pi.metadata = { ...subMeta, ...currentMeta, subscription_id: subId };
    auditLog("INFO", "metadata_backfilled_from_subscription", { subscriptionId: subId });
  } catch (err) {
    auditLog("WARN", "subscription_metadata_lookup_failed", {
      subscriptionId: subId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function cmnStripeRequest(path: string, init: { method?: string; body?: URLSearchParams } = {}) {
  return stripeApiRequest(path, { ...init, secretKey: process.env.CMN_STRIPE_SECRET_KEY });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  auditLog("INFO", "webhook_received", { url: request.url });

  // 1. Env check
  const webhookSecret = process.env.CMN_STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    auditLog("ERROR", "missing_webhook_secret");
    return NextResponse.json({ error: "Missing CMN_STRIPE_WEBHOOK_SECRET" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  // 2. Signature check
  if (!signature) {
    auditLog("ERROR", "missing_stripe_signature");
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  try {
    verifyStripeWebhookSignature(rawBody, signature, webhookSecret);
    auditLog("INFO", "signature_verified");
  } catch (error) {
    auditLog("ERROR", "signature_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid Stripe signature" },
      { status: 400 }
    );
  }

  // 3. Parse event
  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent;
    auditLog("INFO", "event_parsed", { type: event.type });
  } catch (error) {
    auditLog("ERROR", "event_parse_failed", { message: String(error) });
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 4. Filter relevant events
  const status = mapEventTypeToStatus(event.type);
  if (!status) {
    auditLog("INFO", "event_ignored", { type: event.type });
    return NextResponse.json({ received: true, ignored: true });
  }

  // Resolve to the underlying PaymentIntent regardless of event type
  // (payment_intent.* → self; invoice.* → linked PI). This lets the rest
  // of the handler treat one-time and recurring flows identically.
  const paymentIntent = await resolvePaymentIntentFromEvent(event);
  if (!paymentIntent?.id) {
    auditLog("ERROR", "missing_payment_intent", { eventType: event.type });
    return NextResponse.json({ received: true, ignored: true });
  }

  // For subscription renewals, the PaymentIntent metadata is empty. Pull
  // donor + campaign metadata from the Subscription so downstream code
  // can rely on the same shape as the initial charge.
  await backfillMetadataFromSubscription(paymentIntent);

  auditLog("INFO", "processing_payment_intent", {
    id: paymentIntent.id,
    status,
    amount: paymentIntent.amount_received ?? paymentIntent.amount,
    metadata: paymentIntent.metadata,
  });

  try {
    // 5. Resolve donor info
    let name      = paymentIntent.metadata?.name  || "";
    let email     = paymentIntent.metadata?.email || paymentIntent.receipt_email || "";
    const locationId = paymentIntent.metadata?.location_id || "";

    if ((!name || !email) && paymentIntent.customer) {
      auditLog("INFO", "fetching_customer", { customerId: paymentIntent.customer });
      const customer = await cmnStripeRequest(`/customers/${paymentIntent.customer}`);
      name  = name  || customer.metadata?.name  || customer.name  || "";
      email = email || customer.metadata?.email || customer.email || "";
      auditLog("INFO", "customer_fetched", { name, email });
    }

    name = name || "Donor";

    if (!email) {
      auditLog("ERROR", "missing_donor_email", { paymentIntentId: paymentIntent.id });
      return NextResponse.json(
        { error: "Missing donor email in Stripe metadata" },
        { status: 400 }
      );
    }

    // 6. Guard: only process events that belong to the CMN location
    if (locationId !== CMN_STRIPE_LOCATION_ID) {
      auditLog("WARN", "location_id_mismatch", {
        expected: CMN_STRIPE_LOCATION_ID,
        received:  locationId,
      });
      return NextResponse.json({ received: true, ignored: true });
    }

    // 7. Resolve payment method
    const paymentMethodId =
      typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : paymentIntent.payment_method?.id || null;

    auditLog("INFO", "fetching_payment_method", { paymentMethodId });
    // Pass CMN secret key so we look up the payment method in the CMN Stripe account
    const paymentMethod = await (async () => {
      if (!paymentMethodId) return "unknown";
      const pm = await cmnStripeRequest(`/payment_methods/${paymentMethodId}`);
      const type = String(pm?.type || "");
      if (type === "us_bank_account") return "ach";
      if (type === "card")            return "card";
      return type || "unknown";
    })();
    auditLog("INFO", "payment_method_resolved", { paymentMethod });

    const amountInCents = Number(paymentIntent.amount_received ?? paymentIntent.amount ?? 0);
    const paymentStatus =
      status === "processing" ? "pending" : status === "failed" ? "failed" : "completed";
    const formSource = paymentIntent.metadata?.form_source ?? "";

    // 8. Save donation
    auditLog("INFO", "creating_donation", {
      name,
      email,
      amountInCents,
      paymentMethod,
      locationId: CMN_STRIPE_LOCATION_ID,
      status,
      formSource,
    });

    let result: { donationId: number; created: boolean; updated: boolean; skipped: boolean };

    if (formSource === "cmn-campaign") {
      const campaignName = paymentIntent.metadata?.campaign_name ?? "General Fund Donation";
      const rawId        = paymentIntent.metadata?.campaign_id;
      const campaignId   = rawId ? Number(rawId) || null : null;
      const donorNotes   = paymentIntent.metadata?.notes ?? "";

      result = await createManualDonationForBenchmarkPayment({
        paymentIntentId: paymentIntent.id,
        name,
        email,
        amountInCents,
        paymentMethod,
        locationId:    CMN_STRIPE_LOCATION_ID,
        paymentStatus,
        campaignName,
        campaignId,
        paidAtUnix: paymentIntent.created,
        notes:      donorNotes,
      });
    } else {
      // cmn (no-campaign form) — auto-tags to "CMN Donations"
      result = await createManualDonationForPublicStripePayment({
        paymentIntentId: paymentIntent.id,
        name,
        email,
        amountInCents,
        paymentMethod,
        locationId:    CMN_STRIPE_LOCATION_ID,
        paymentStatus,
        paidAtUnix: paymentIntent.created,
      });
    }

    if (result.skipped) {
      auditLog("WARN", "donation_skipped_duplicate", {
        donationId: result.donationId,
        reason:     "Same contact, date, and amount already exists",
      });
    } else {
      auditLog("INFO", "donation_saved", result);
    }

    // 9. Forward to CMN GHL webhook if configured
    const ghlUrl = process.env.CMN_GHL_WEBHOOK_URL;
    if (ghlUrl) {
      auditLog("INFO", "sending_to_ghl", { url: ghlUrl });
      try {
        const meta = paymentIntent.metadata ?? {};
        const ghlRes = await fetch(ghlUrl, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            amount:                   formatUsdAmountFromCents(amountInCents),
            payment_status:           status,
            payment_method:           paymentMethod,
            stripe_payment_intent_id: paymentIntent.id,
            location_id:              CMN_STRIPE_LOCATION_ID,
            form_source:              meta.form_source    ?? "cmn",
            billing_frequency:        meta.frequency      ?? "",
            address:                  meta.address        ?? "",
            city:                     meta.city           ?? "",
            state:                    meta.state          ?? "",
            country:                  meta.country        ?? "",
            postal_code:              meta.postal         ?? "",
            newsletter:               meta.newsletter     ?? "",
            heard_about:              meta.heard_about    ?? "",
            memory_honor:             meta.memory_honor   ?? "",
            memory_name:              meta.memory_name    ?? "",
            notes:                    meta.notes          ?? "",
            campaign_name:            meta.campaign_name  ?? "",
            campaign_id:              meta.campaign_id    ?? "",
          }),
        });
        auditLog("INFO", "ghl_response", { status: ghlRes.status, ok: ghlRes.ok });
      } catch (ghlError) {
        auditLog("ERROR", "ghl_send_failed", {
          message: ghlError instanceof Error ? ghlError.message : String(ghlError),
        });
      }
    } else {
      auditLog("WARN", "cmn_ghl_webhook_url_not_set");
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    auditLog("ERROR", "webhook_processing_failed", {
      message: error instanceof Error ? error.message  : String(error),
      stack:   error instanceof Error ? error.stack    : undefined,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing failed" },
      { status: 500 }
    );
  }
}
