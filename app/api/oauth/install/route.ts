/**
 * GET /api/oauth/install
 *
 * Entry point for installing the Donor HQ app on a sub-account.
 * 1. Generates a CSRF state token and stores it in an HTTP-only cookie.
 * 2. 302-redirects to the provider's authorize URL with the same state value
 *    in the query string.
 *
 * The provider will eventually redirect the user back to /api/oauth/callback
 * with `?code=...&state=...` where the state must match the cookie.
 *
 * NOTE: route paths intentionally don't contain "ghl" or "highlevel" — the
 * GHL Marketplace UI rejects redirect URLs that reference those names.
 *
 * Use this as the value for GHL_INSTALL_URL so the "Try again" button on the
 * error page kicks off the flow cleanly.
 */
import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/lib/ghl/oauth-client";
import { generateStateToken, getStateCookieOptions } from "@/lib/ghl/state-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Default scope set — taken from the install URL GHL generates inside the
 * marketplace developer console for this app. Keep in sync with the scopes
 * actually enabled in the marketplace app settings, because requesting a
 * scope NOT enabled there fails with "invalid_scope".
 *
 * Override per-environment with the GHL_SCOPES env var (space-separated).
 */
const DEFAULT_SCOPES = [
  "contacts.readonly",
  "contacts.write",
  "payments/orders.readonly",
  "payments/orders.write",
  "payments/orders.collectPayment",
  "payments/integration.readonly",
  "payments/integration.write",
  "payments/transactions.readonly",
  "payments/subscriptions.readonly",
  "payments/coupons.readonly",
  "payments/coupons.write",
  "payments/custom-provider.readonly",
  "payments/custom-provider.write",
  "invoices.readonly",
  "invoices.write",
  "invoices/schedule.readonly",
  "invoices/schedule.write",
  "invoices/template.readonly",
  "invoices/template.write",
  "invoices/estimate.readonly",
  "invoices/estimate.write",
  "locations/customFields.readonly",
  "locations/customFields.write",
  "forms.readonly",
  "forms.write",
  "locations.readonly",
  "locations/customValues.readonly",
  "locations/customValues.write",
  "oauth.write",
  "oauth.readonly",
  "opportunities.readonly",
  "opportunities.write",
  "users.readonly",
  "users.write",
].join(" ");

export async function GET() {
  try {
    const state = generateStateToken();
    const scopes = process.env.GHL_SCOPES?.trim() || DEFAULT_SCOPES;

    const authorizeUrl = buildAuthorizeUrl({ state, scopes });
    const response = NextResponse.redirect(authorizeUrl);

    const cookieOpts = getStateCookieOptions();
    response.cookies.set(cookieOpts.name, state, {
      httpOnly: cookieOpts.httpOnly,
      secure: cookieOpts.secure,
      sameSite: cookieOpts.sameSite,
      path: cookieOpts.path,
      maxAge: cookieOpts.maxAge,
    });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ghl-oauth] install start failed:", message);
    return NextResponse.redirect(
      new URL("/oauth/error?reason=unknown", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
    );
  }
}
