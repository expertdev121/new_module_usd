import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  PUBLIC_STRIPE_LOCATION_ID,
  parseAmountToCents,
  stripeApiRequest,
} from "@/lib/public-stripe-payments";

export const runtime = "nodejs";

const createPaymentSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Valid email is required"),
  frequency: z.enum(["once", "monthly", "quarterly", "annually"]).default("once"),
  campaign_name: z.string().trim().min(1, "Campaign is required"),
  campaign_id: z.union([z.number(), z.null()]).optional().default(null),
  // Additional form fields forwarded to GHL
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

function appendFormMetadata(params: URLSearchParams, parsed: ParsedPayment) {
  params.append("metadata[address]",       parsed.address       ?? "");
  params.append("metadata[city]",          parsed.city          ?? "");
  params.append("metadata[state]",         parsed.state         ?? "");
  params.append("metadata[country]",       parsed.country       ?? "");
  params.append("metadata[postal]",        parsed.postal        ?? "");
  params.append("metadata[newsletter]",    parsed.newsletter    ?? "");
  params.append("metadata[heard_about]",   parsed.heard_about   ?? "");
  params.append("metadata[memory_honor]",  parsed.memory_honor  ?? "");
  params.append("metadata[memory_name]",   parsed.memory_name   ?? "");
  params.append("metadata[frequency]",     parsed.frequency);
  params.append("metadata[campaign_name]", parsed.campaign_name);
  params.append("metadata[campaign_id]",   String(parsed.campaign_id ?? ""));
  params.append("metadata[form_source]",   "benchmark");
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
      params.append("description",
        `Benchmark Adventure Ministries donation for ${parsed.name} – ${parsed.campaign_name}`);
      params.append("metadata[name]",            parsed.name);
      params.append("metadata[email]",           parsed.email);
      params.append("metadata[location_id]",     PUBLIC_STRIPE_LOCATION_ID);
      appendFormMetadata(params, parsed);
      params.append(
        "payment_method_options[us_bank_account][verification_method]",
        "automatic"
      );

      const pi = await stripeApiRequest("/payment_intents", {
        method: "POST",
        body: params,
      });

      return NextResponse.json({ clientSecret: pi.client_secret, type: "payment" });
    }

    // ── Recurring subscription ────────────────────────────────────────────────
    const intervalConfig = getStripeInterval(parsed.frequency);
    if (!intervalConfig) {
      return NextResponse.json({ error: "Invalid billing frequency" }, { status: 400 });
    }

    // 1. Create Stripe Customer
    const customerParams = new URLSearchParams();
    customerParams.append("name",                      parsed.name);
    customerParams.append("email",                     parsed.email);
    customerParams.append("metadata[name]",            parsed.name);
    customerParams.append("metadata[email]",           parsed.email);
    customerParams.append("metadata[location_id]",     PUBLIC_STRIPE_LOCATION_ID);
    customerParams.append("metadata[campaign_name]",   parsed.campaign_name);
    customerParams.append("metadata[form_source]",     "benchmark");

    const customer = await stripeApiRequest("/customers", {
      method: "POST",
      body: customerParams,
    });

    // 2. Create Price
    const priceParams = new URLSearchParams();
    priceParams.append("currency",                        "usd");
    priceParams.append("unit_amount",                     String(amountInCents));
    priceParams.append("recurring[interval]",             intervalConfig.interval);
    priceParams.append("recurring[interval_count]",       String(intervalConfig.intervalCount));
    priceParams.append("product_data[name]",
      `Benchmark Adventure Ministries – ${parsed.campaign_name}`);

    const price = await stripeApiRequest("/prices", {
      method: "POST",
      body: priceParams,
    });

    // 3. Create subscription
    const subParams = new URLSearchParams();
    subParams.append("customer",                               customer.id);
    subParams.append("items[0][price]",                        price.id);
    subParams.append("payment_behavior",                       "default_incomplete");
    subParams.append("payment_settings[save_default_payment_method]", "on_subscription");
    subParams.append("payment_settings[payment_method_types][]",      "card");
    subParams.append("payment_settings[payment_method_types][]",      "us_bank_account");
    subParams.append(
      "payment_settings[payment_method_options][us_bank_account][verification_method]",
      "automatic"
    );
    subParams.append("metadata[name]",          parsed.name);
    subParams.append("metadata[email]",         parsed.email);
    subParams.append("metadata[location_id]",   PUBLIC_STRIPE_LOCATION_ID);
    subParams.append("metadata[frequency]",     parsed.frequency);
    subParams.append("metadata[campaign_name]", parsed.campaign_name);
    subParams.append("metadata[campaign_id]",   String(parsed.campaign_id ?? ""));
    subParams.append("metadata[form_source]",   "benchmark");

    const subscription = await stripeApiRequest("/subscriptions", {
      method: "POST",
      body: subParams,
    });

    const invoiceId =
      typeof subscription.latest_invoice === "string"
        ? subscription.latest_invoice
        : subscription.latest_invoice?.id;

    if (!invoiceId) {
      return NextResponse.json(
        { error: "Subscription created but no invoice found" },
        { status: 500 }
      );
    }

    const invoice = await stripeApiRequest(`/invoices/${invoiceId}`);

    const piId =
      typeof invoice.payment_intent === "string"
        ? invoice.payment_intent
        : invoice.payment_intent?.id;

    if (!piId) {
      return NextResponse.json(
        { error: "Invoice has no PaymentIntent — check Stripe subscription settings" },
        { status: 500 }
      );
    }

    // 4. Annotate the PaymentIntent
    const piUpdateParams = new URLSearchParams();
    piUpdateParams.append("metadata[name]",            parsed.name);
    piUpdateParams.append("metadata[email]",           parsed.email);
    piUpdateParams.append("metadata[location_id]",     PUBLIC_STRIPE_LOCATION_ID);
    piUpdateParams.append("metadata[subscription_id]", subscription.id);
    piUpdateParams.append("metadata[form_source]",     "benchmark");
    appendFormMetadata(piUpdateParams, parsed);
    piUpdateParams.append("receipt_email", parsed.email);
    piUpdateParams.append(
      "description",
      `Recurring ${parsed.frequency} donation for ${parsed.name} – ${parsed.campaign_name}`
    );

    const pi = await stripeApiRequest(`/payment_intents/${piId}`, {
      method: "POST",
      body: piUpdateParams,
    });

    return NextResponse.json({ clientSecret: pi.client_secret, type: "subscription" });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create payment",
      },
      { status: 500 }
    );
  }
}
