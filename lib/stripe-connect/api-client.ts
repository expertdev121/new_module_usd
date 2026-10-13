/**
 * Raw Stripe API client for tenant-supplied Stripe Connect credentials.
 *
 * Unlike lib/public-stripe-payments.ts's stripeApiRequest (which falls back
 * to the platform-wide STRIPE_SECRET_KEY env var), every call here requires
 * an explicit secretKey — there is no tenant-agnostic default, since keys
 * are per-location.
 */
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_VERSION = "2024-10-28.acacia";

export async function stripeApiRequest(
  path: string,
  secretKey: string,
  init: { method?: string; body?: URLSearchParams } = {},
) {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Stripe-Version": STRIPE_VERSION,
      ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init.body?.toString(),
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || `Stripe API request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

/** 'sk_test_...' -> 'test', 'sk_live_...' -> 'live'. Throws on anything else. */
export function modeFromSecretKey(secretKey: string): "test" | "live" {
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  throw new Error("Secret key must start with sk_test_ or sk_live_");
}

/**
 * Validate a key pair against Stripe's /v1/account endpoint and return the
 * account id + display name. Throws if the secret key is invalid/revoked.
 */
export async function validateStripeAccount(secretKey: string): Promise<{ accountId: string; accountName: string | null }> {
  const account = await stripeApiRequest("/account", secretKey);
  return {
    accountId: account.id,
    accountName: account.business_profile?.name || account.settings?.dashboard?.display_name || null,
  };
}
