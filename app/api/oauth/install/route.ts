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

// Reasonable default scope set for Donor HQ. Override via GHL_SCOPES env var.
// Keep this in sync with the scopes enabled on the GHL Marketplace App listing —
// requesting a scope here that's NOT enabled in the marketplace UI causes the
// install to fail with "invalid_scope".
const DEFAULT_SCOPES = [
  "contacts.readonly",
  "contacts.write",
  "locations.readonly",
  "users.readonly",
  "opportunities.readonly",
  "opportunities.write",
  "payments/orders.readonly",
  "payments/transactions.readonly",
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
