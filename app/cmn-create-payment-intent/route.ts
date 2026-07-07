import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  CMN_STRIPE_LOCATION_ID,
  parseAmountToCents,
  stripeApiRequest,
} from "@/lib/public-stripe-payments";

export const runtime = "nodejs";

const createPaymentSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Valid email is required"),
  frequency: z.enum(["once", "monthly", "quarterly", "annually"]).default("once"),
  address: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  state: z.string().trim().optional().default(""),
  country: z.string().trim().optional().default(""),
  postal: z.string().trim().optional().default(""),
  newsletter: z.string().trim().optional().default(""),
  heard_about: z.string().trim().optional().default(""),
  memory_honor: z.string().trim().optional().default(""),
  memory_name: z.string().trim().optional().default(""),
});

type ParsedPayment = z.infer<typeof createPaymentSchema>;

function cmnStripeRequest(path: string, init: { method?: string; body?: URLSearchParams } = {}) {
  return stripeApiRequest(path, { ...init, secretKey: process.env.CMN_STRIPE_SECRET_KEY });
}

function appendFormMetadata(params: URLSearchParams, parsed: ParsedPayment) {
  params.append("metadata[address]",      parsed.address      ?? "");
  params.append("metadata[city]",         parsed.city         ?? "");
  params.append("metadata[state]",        parsed.state        ?? "");
  params.append("metadata[country]",      parsed.country      ?? "");
  params.append("metadata[postal]",       parsed.postal       ?? "");
  params.append("metadata[newsletter]",   parsed.newsletter   ?? "");
  params.append("metadata[heard_about]",  parsed.heard_about  ?? "");
  params.append("metadata[memory_honor]", parsed.memory_honor ?? "");
  params.append("metadata[memory_name]",  parsed.memory_name  ?? "");
  params.append("metadata[frequency]",    parsed.frequency);
  params.append("metadata[form_source]",  "cmn");
}

function getStripeInterval(
  frequency: string
): { interval: string; intervalCount: number } | null {
  if (frequency === "monthly")   return { interval: "month", intervalCount: 1 };
  if (frequency === "quarterly") return { interval: "month", intervalCount: 3 };
  if (frequency === "annually")  return { interval: "year",  intervalCount: 1 };
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createPaymentSchema.parse(body);
    const amountInCents = parseAmountToCents(parsed.amount);

    if (!amountInCents) {
      return NextResponse.json(
        { error: "Amount must be a positive USD amount" },
        { status: 400 }
      );
    }

    // ── One-time payment ──────────────────────────────────────────────────────
    if (parsed.frequency === "once") {
      const params = new URLSearchParams();
      params.append("amount",                    String(amountInCents));
      params.append("currency",                  "usd");
      params.append("payment_method_types[]",    "card");
      params.append("payment_method_types[]",    "us_bank_account");
      params.append("receipt_email",             parsed.email);
      params.append("description",               `Church Mission Network donation for ${parsed.name}`);
      params.append("metadata[name]",            parsed.name);
      params.append("metadata[email]",           parsed.email);
      params.append("metadata[location_id]",     CMN_STRIPE_LOCATION_ID);
      appendFormMetadata(params, parsed);
      params.append(
        "payment_method_options[us_bank_account][verification_method]",
        "automatic"
      );

      const pi = await cmnStripeRequest("/payment_intents", { method: "POST", body: params });
      return NextResponse.json({ clientSecret: pi.client_secret, type: "payment" });
    }

    // ── Recurring subscription ────────────────────────────────────────────────
    const intervalConfig = getStripeInterval(parsed.frequency);
    if (!intervalConfig) {
      return NextResponse.json({ error: "Invalid billing frequency" }, { status: 400 });
    }

    // 1. Create Customer
    const customerParams = new URLSearchParams();
    customerParams.append("name",                  parsed.name);
    customerParams.append("email",                 parsed.email);
    customerParams.append("metadata[name]",        parsed.name);
    customerParams.append("metadata[email]",       parsed.email);
    customerParams.append("metadata[location_id]", CMN_STRIPE_LOCATION_ID);
    customerParams.append("metadata[form_source]", "cmn");

    const customer = await cmnStripeRequest("/customers", { method: "POST", body: customerParams });

    // 2. Create Price
    const priceParams = new URLSearchParams();
    priceParams.append("currency",                  "usd");
    priceParams.append("unit_amount",               String(amountInCents));
    priceParams.append("recurring[interval]",       intervalConfig.interval);
    priceParams.append("recurring[interval_count]", String(intervalConfig.intervalCount));
    priceParams.append("product_data[name]",        "Church Mission Network Donation");

    const price = await cmnStripeRequest("/prices", { method: "POST", body: priceParams });

    // 3. Create Subscription
    const subParams = new URLSearchParams();
    subParams.append("customer",                                               customer.id);
    subParams.append("items[0][price]",                                        price.id);
    subParams.append("payment_behavior",                                       "default_incomplete");
    subParams.append("payment_settings[save_default_payment_method]",          "on_subscription");
    subParams.append("payment_settings[payment_method_types][]",               "card");
    subParams.append("payment_settings[payment_method_types][]",               "us_bank_account");
    subParams.append(
      "payment_settings[payment_method_options][us_bank_account][verification_method]",
      "automatic"
    );
    subParams.append("metadata[name]",          parsed.name);
    subParams.append("metadata[email]",         parsed.email);
    subParams.append("metadata[location_id]",   CMN_STRIPE_LOCATION_ID);
    subParams.append("metadata[frequency]",     parsed.frequency);
    subParams.append("metadata[form_source]",   "cmn");
    // Expand latest_invoice.payment_intent AND latest_invoice.confirmation_secret
    // so this works on all Stripe API versions — Invoice.payment_intent is
    // deprecated on 2024-11-20+ and replaced by Invoice.confirmation_secret.
    subParams.append("expand[]", "latest_invoice.payment_intent");
    subParams.append("expand[]", "latest_invoice.confirmation_secret");

    const subscription = await cmnStripeRequest("/subscriptions", { method: "POST", body: subParams });

    const invoice =
      subscription.latest_invoice && typeof subscription.latest_invoice === "object"
        ? subscription.latest_invoice
        : null;

    if (!invoice) {
      return NextResponse.json(
        { error: "Subscription created but no invoice found" },
        { status: 500 }
      );
    }

    const clientSecretFromConfirmation =
      invoice.confirmation_secret && typeof invoice.confirmation_secret === "object"
        ? invoice.confirmation_secret.client_secret
        : null;
    const piObj =
      invoice.payment_intent && typeof invoice.payment_intent === "object"
        ? invoice.payment_intent
        : null;
    const clientSecretFromPi = piObj?.client_secret ?? null;
    const finalClientSecret = clientSecretFromConfirmation ?? clientSecretFromPi;
    const piId = piObj?.id ?? null;

    if (!finalClientSecret) {
      console.error(
        "[cmn-recurring] no client_secret on invoice — invoice keys:",
        Object.keys(invoice),
      );
      return NextResponse.json(
        {
          error:
            "Subscription created but Stripe returned no client secret. In Stripe dashboard, check: Payment methods → ACH → 'Save for reuse' is enabled, and Billing → Subscriptions is active.",
        },
        { status: 500 }
      );
    }

    // 4. Annotate PaymentIntent (best-effort — only when piId is still exposed
    // by the current Stripe API version).
    if (piId) {
      const piUpdateParams = new URLSearchParams();
      piUpdateParams.append("metadata[name]",            parsed.name);
      piUpdateParams.append("metadata[email]",           parsed.email);
      piUpdateParams.append("metadata[location_id]",     CMN_STRIPE_LOCATION_ID);
      piUpdateParams.append("metadata[subscription_id]", subscription.id);
      appendFormMetadata(piUpdateParams, parsed);
      piUpdateParams.append("receipt_email", parsed.email);
      piUpdateParams.append(
        "description",
        `Recurring ${parsed.frequency} Church Mission Network donation for ${parsed.name}`
      );
      try {
        await cmnStripeRequest(`/payment_intents/${piId}`, {
          method: "POST",
          body: piUpdateParams,
        });
      } catch (err) {
        console.error(
          "[cmn-recurring] PI metadata annotate failed (non-fatal):",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return NextResponse.json({ clientSecret: finalClientSecret, type: "subscription" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create payment" },
      { status: 500 }
    );
  }
}
