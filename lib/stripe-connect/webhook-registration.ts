/**
 * Registers a per-tenant Stripe webhook_endpoint so fundraising Checkout
 * donations can be confirmed server-side (POST /v1/webhook_endpoints).
 *
 * Called right after a tenant connects their keys (see
 * app/api/admin/stripe-connect/connect/route.ts). Non-fatal by design — the
 * connection itself is still saved even if this fails; the tenant just won't
 * have live donation confirmation until reconnected against a reachable URL.
 *
 * Stripe requires an https:// URL for webhook endpoints, so this is a no-op
 * (and does not call Stripe) whenever the resolved app URL isn't https —
 * i.e. local dev without a tunnel. Callers should treat a null return as
 * "skipped", not an error.
 */
import { stripeApiRequest } from "./api-client";
import { saveWebhookRegistration } from "./connection-storage";

// async_payment_succeeded covers delayed-settlement methods (e.g. ACH debit)
// where the Checkout Session "completes" before the payment actually clears.
const FUNDRAISING_WEBHOOK_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded"] as const;

export async function registerFundraisingWebhook(
  locationId: string,
  secretKey: string,
  appBaseUrl: string,
): Promise<{ registered: boolean; reason?: string }> {
  if (!appBaseUrl.startsWith("https://")) {
    return { registered: false, reason: "app_url_not_https" };
  }

  const endpointUrl = `${appBaseUrl}/api/webhook/stripe/fundraising/${locationId}`;

  const body = new URLSearchParams();
  body.set("url", endpointUrl);
  FUNDRAISING_WEBHOOK_EVENTS.forEach((event, i) => body.set(`enabled_events[${i}]`, event));
  body.set("description", "DonorHQ Fundraising Campaigns — Checkout confirmation");

  const endpoint = await stripeApiRequest("/webhook_endpoints", secretKey, {
    method: "POST",
    body,
  });

  if (!endpoint?.id || !endpoint?.secret) {
    throw new Error("Stripe did not return a webhook endpoint id/secret");
  }

  await saveWebhookRegistration(locationId, endpoint.id, endpoint.secret);
  return { registered: true };
}
