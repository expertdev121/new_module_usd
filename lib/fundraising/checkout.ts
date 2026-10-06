/**
 * Stripe Checkout Session creation for Fundraising Campaigns donations.
 * Uses the tenant's own connected Stripe secret key (lib/stripe-connect),
 * following the same raw-fetch stripeApiRequest pattern as the rest of the
 * Stripe Connect integration — no official `stripe` SDK in this codebase.
 *
 * Uses ui_mode=embedded so the donor enters card details inline on our own
 * page (mounted via @stripe/react-stripe-js's <EmbeddedCheckout>), instead
 * of being redirected to a Stripe-hosted checkout.stripe.com page. We still
 * never see card data — Stripe's iframe handles that — but the donor never
 * leaves our domain. The actual manual_donation row is still only written
 * once Stripe confirms payment via the webhook.
 */
import { stripeApiRequest } from "@/lib/stripe-connect/api-client";

export async function createCampaignCheckoutSession(params: {
  secretKey: string;
  campaignId: number;
  campaignTitle: string;
  locationId: string;
  chargeCents: number;
  baseCents: number;
  coverFees: boolean;
  donorFirstName: string;
  donorLastName: string;
  donorEmail: string;
  returnUrl: string;
}): Promise<{ id: string; clientSecret: string }> {
  const metadata: Record<string, string> = {
    fundraising_campaign_id: String(params.campaignId),
    location_id: params.locationId,
    donor_first_name: params.donorFirstName,
    donor_last_name: params.donorLastName,
    base_cents: String(params.baseCents),
    cover_fees: String(params.coverFees),
  };

  const body = new URLSearchParams();
  body.set("ui_mode", "embedded");
  body.set("mode", "payment");
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", "usd");
  body.set("line_items[0][price_data][unit_amount]", String(params.chargeCents));
  body.set("line_items[0][price_data][product_data][name]", params.campaignTitle);
  body.set("customer_email", params.donorEmail);
  body.set("return_url", params.returnUrl);
  Object.entries(metadata).forEach(([key, value]) => body.set(`metadata[${key}]`, value));
  Object.entries(metadata).forEach(([key, value]) => body.set(`payment_intent_data[metadata][${key}]`, value));

  const session = await stripeApiRequest("/checkout/sessions", params.secretKey, {
    method: "POST",
    body,
  });

  if (!session?.id || !session?.client_secret) {
    throw new Error("Stripe did not return a Checkout Session id/client_secret");
  }

  return { id: session.id, clientSecret: session.client_secret };
}
