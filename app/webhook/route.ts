import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  createManualDonationForBenchmarkPayment,
  createManualDonationForPublicStripePayment,
  formatUsdAmountFromCents,
  getStripePaymentMethodType,
  PUBLIC_STRIPE_LOCATION_ID,
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
  console.log(`[WEBHOOK ${level}] ${step}`, data ?? "");

  try {
    const logDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "webhook.log"), line + "\n", "utf8");
  } catch {
    // file logging is best-effort — never crash the request over it
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
  if (eventType === "payment_intent.succeeded") return "succeeded";
  if (eventType === "payment_intent.processing") return "processing";
  if (eventType === "payment_intent.payment_failed") return "failed";
  return null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  auditLog("INFO", "webhook_received", { url: request.url });

  // 1. Env check
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    auditLog("ERROR", "missing_webhook_secret");
    return NextResponse.json({ error: "Missing STRIPE_WEBHOOK_SECRET" }, { status: 500 });
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

  const paymentIntent = event.data?.object;
  if (!paymentIntent?.id) {
    auditLog("ERROR", "missing_payment_intent");
    return NextResponse.json({ error: "Missing PaymentIntent payload" }, { status: 400 });
  }

  auditLog("INFO", "processing_payment_intent", {
    id: paymentIntent.id,
    status,
    amount: paymentIntent.amount_received ?? paymentIntent.amount,
    metadata: paymentIntent.metadata,
  });

  try {
    // 5. Resolve donor info
    let name = paymentIntent.metadata?.name || "";
    let email = paymentIntent.metadata?.email || paymentIntent.receipt_email || "";
    // Only use the location_id that was explicitly set by our create-payment-intent route.
    // Do NOT fall back to PUBLIC_STRIPE_LOCATION_ID here — other Stripe integrations
    // (e.g. GHL forms on the same account) won't have this metadata and must be ignored.
    let locationId = paymentIntent.metadata?.location_id || "";

    if ((!name || !email) && paymentIntent.customer) {
      auditLog("INFO", "fetching_customer", { customerId: paymentIntent.customer });
      const customer = await stripeApiRequest(`/customers/${paymentIntent.customer}`);
      name = name || customer.metadata?.name || customer.name || "";
      email = email || customer.metadata?.email || customer.email || "";
      locationId = locationId || customer.metadata?.location_id || "";
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

    // 6. Resolve payment method
    const paymentMethodId =
      typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : paymentIntent.payment_method?.id || null;

    auditLog("INFO", "fetching_payment_method", { paymentMethodId });
    const paymentMethod = await getStripePaymentMethodType(paymentMethodId);
    auditLog("INFO", "payment_method_resolved", { paymentMethod });

    const amountInCents = Number(paymentIntent.amount_received ?? paymentIntent.amount ?? 0);

    // 7. Create donation
    auditLog("INFO", "creating_donation", {
      name,
      email,
      amountInCents,
      paymentMethod,
      locationId,
      status,
    });

    if (locationId === PUBLIC_STRIPE_LOCATION_ID) {
      const paymentStatus =
        status === "processing" ? "pending" : status === "failed" ? "failed" : "completed";
      const formSource = paymentIntent.metadata?.form_source ?? "";

      let result: { donationId: number; created: boolean; updated: boolean; skipped: boolean };

      if (formSource === "benchmark") {
        const campaignName = paymentIntent.metadata?.campaign_name ?? "General Fund Donation";
        const rawId = paymentIntent.metadata?.campaign_id;
        const campaignId = rawId ? Number(rawId) || null : null;

        result = await createManualDonationForBenchmarkPayment({
          paymentIntentId: paymentIntent.id,
          name,
          email,
          amountInCents,
          paymentMethod,
          locationId: PUBLIC_STRIPE_LOCATION_ID,
          paymentStatus,
          campaignName,
          campaignId,
          paidAtUnix: paymentIntent.created,
        });
      } else {
        result = await createManualDonationForPublicStripePayment({
          paymentIntentId: paymentIntent.id,
          name,
          email,
          amountInCents,
          paymentMethod,
          locationId: PUBLIC_STRIPE_LOCATION_ID,
          paymentStatus,
          paidAtUnix: paymentIntent.created,
        });
      }

      if (result.skipped) {
        auditLog("WARN", "donation_skipped_duplicate", {
          donationId: result.donationId,
          reason: "Same contact, date, and amount already exists",
        });
      } else {
        auditLog("INFO", "donation_saved", result);
      }
    } else {
      auditLog("WARN", "location_id_mismatch", {
        expected: PUBLIC_STRIPE_LOCATION_ID,
        received: locationId,
      });
    }

    // 8. Forward to GHL webhook if configured
    const ghlUrl = process.env.GHL_WEBHOOK_URL;
    if (ghlUrl) {
      auditLog("INFO", "sending_to_ghl", { url: ghlUrl });
      try {
        const meta = paymentIntent.metadata ?? {};
        const ghlRes = await fetch(ghlUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            amount:                    formatUsdAmountFromCents(amountInCents),
            payment_status:            status,
            payment_method:            paymentMethod,
            stripe_payment_intent_id:  paymentIntent.id,
            location_id:               locationId,
            form_source:               meta.form_source     ?? "chaplains",
            billing_frequency:         meta.frequency       ?? "",
            address:                   meta.address         ?? "",
            city:                      meta.city            ?? "",
            state:                     meta.state           ?? "",
            country:                   meta.country         ?? "",
            postal_code:               meta.postal          ?? "",
            newsletter:                meta.newsletter      ?? "",
            heard_about:               meta.heard_about     ?? "",
            memory_honor:              meta.memory_honor    ?? "",
            memory_name:               meta.memory_name     ?? "",
            campaign_name:             meta.campaign_name   ?? "",
            campaign_id:               meta.campaign_id     ?? "",
          }),
        });
        auditLog("INFO", "ghl_response", { status: ghlRes.status, ok: ghlRes.ok });
      } catch (ghlError) {
        auditLog("ERROR", "ghl_send_failed", {
          message: ghlError instanceof Error ? ghlError.message : String(ghlError),
        });
      }
    } else {
      auditLog("WARN", "ghl_webhook_url_not_set");
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    auditLog("ERROR", "webhook_processing_failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing failed" },
      { status: 500 }
    );
  }
}
