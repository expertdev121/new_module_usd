/**
 * GET /api/oauth/callback
 *
 * Official GHL Marketplace pattern (matches the canonical template at
 * github.com/GoHighLevel/ghl-marketplace-app-template — `index.ts`'s
 * /authorize-handler + `ghl.ts`'s authorizationHandler).
 *
 * Flow:
 *   1. Validate CSRF state IF we set a cookie (Donor-HQ-initiated install).
 *      Marketplace-initiated installs have no cookie — that's fine.
 *   2. POST /oauth/token (no user_type). GHL returns whatever shape matches
 *      the install:
 *        - Sub-account install → userType=Location + locationId + companyId
 *        - Agency install      → userType=Company + companyId (no locationId)
 *   3. Compute resource_id (locationId for Location, companyId for Company).
 *   4. UPSERT one row in ghl_oauth_tokens keyed on resource_id.
 *   5. Redirect to /oauth/success?resourceId=...
 *
 * Locations-under-a-company are NOT pre-provisioned. When the app later
 * needs to act on a specific sub-account, it asks `getValidAccessToken()`
 * which lazily mints a location-token from the company token if needed.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeCodeForTokens,
  getLocationInfo,
  maskToken,
} from "@/lib/ghl/oauth-client";
import { upsertTokenRecord } from "@/lib/ghl/oauth-storage";
import { isStateValid, STATE_COOKIE_NAME, getStateCookieOptions } from "@/lib/ghl/state-cookie";
import type { OauthErrorReason } from "@/lib/ghl/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appBase(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
}

function redirectError(
  req: NextRequest,
  reason: OauthErrorReason,
  detail?: string,
) {
  const url = new URL("/oauth/error", appBase(req));
  url.searchParams.set("reason", reason);
  if (detail) {
    // Keep the detail short so it survives query length limits + cookies.
    url.searchParams.set("detail", detail.slice(0, 240));
  }
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE_NAME, "", { ...getStateCookieOptions(), maxAge: 0 });
  return response;
}

function redirectSuccess(
  req: NextRequest,
  resourceId: string,
  opts: { wasNew?: boolean } = {},
) {
  const url = new URL("/oauth/success", appBase(req));
  // Keep `locationId` param for backwards compat with the success page —
  // but it's really the resource_id (locationId or companyId).
  url.searchParams.set("locationId", resourceId);
  if (opts.wasNew === false) {
    // Tells the success page to render the "Already connected — tokens
    // refreshed" variant instead of the generic first-install message.
    url.searchParams.set("reconnected", "1");
  }
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE_NAME, "", { ...getStateCookieOptions(), maxAge: 0 });
  return response;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateFromQuery = req.nextUrl.searchParams.get("state");
  const stateFromCookie = req.cookies.get(STATE_COOKIE_NAME)?.value ?? null;

  // CSRF: enforce only when we set the cookie ourselves (i.e. install was
  // initiated via /api/oauth/install). Marketplace installs skip this.
  if (stateFromCookie && !isStateValid(stateFromQuery, stateFromCookie)) {
    console.warn(
      "[ghl-oauth] callback rejected — state cookie set but query state doesn't match.",
    );
    return redirectError(req, "invalid_state");
  }

  if (!code) return redirectError(req, "missing_code");

  // ── 1. Exchange code (no user_type — GHL infers from the code). ──
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ghl-oauth] token exchange failed:", message);
    // Surface the error message on the error page so the user can see
    // WHY (e.g. redirect_uri mismatch, invalid client_secret). Stays
    // safe because we never include the code or secrets in the message.
    return redirectError(req, "token_exchange_failed", message);
  }

  // ── 2. Determine resource_id + resource_type from the token shape. ──
  // The official template uses the same dictionary key for both:
  // `installationObjects[locationId ?? companyId] = details`.
  const companyId =
    tokens.companyId || req.nextUrl.searchParams.get("companyId") || "";
  const locationId = tokens.locationId ?? null;

  let resourceId: string;
  let resourceType: "Location" | "Company";

  if (tokens.userType === "Location" && locationId) {
    resourceId = locationId;
    resourceType = "Location";
  } else if (tokens.userType === "Company" && companyId) {
    resourceId = companyId;
    resourceType = "Company";
  } else if (locationId) {
    // GHL didn't tag userType but did give us a locationId — treat as Location.
    resourceId = locationId;
    resourceType = "Location";
  } else if (companyId) {
    resourceId = companyId;
    resourceType = "Company";
  } else {
    console.error(
      `[ghl-oauth] Token response had neither locationId nor companyId. access_token=${maskToken(tokens.access_token)}`,
    );
    return redirectError(req, "missing_location");
  }

  // ── 3. Fetch display names — best effort, never fatal. ──
  let locationName: string | null = null;
  let companyName: string | null = null;
  if (resourceType === "Location" && locationId) {
    try {
      const info = await getLocationInfo(locationId, tokens.access_token);
      locationName = info.name ?? null;
      companyName = info.business?.name ?? null;
    } catch (err) {
      console.error(
        `[ghl-oauth] location info fetch failed for ${locationId} (access_token=${maskToken(tokens.access_token)}):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  // For Company-scoped rows we don't have a cheap company-name endpoint, so
  // we leave companyName blank — the connections UI can show "Agency:
  // <companyId>" as a fallback.

  // ── 4. Upsert ONE row, keyed on resource_id. ──
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  let wasNew = true;
  try {
    const result = await upsertTokenRecord({
      resourceId,
      resourceType,
      locationId,
      companyId,
      userId: tokens.userId ?? null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      scope: tokens.scope ?? null,
      tokenType: tokens.token_type ?? "Bearer",
      userType: tokens.userType ?? resourceType,
      locationName,
      companyName,
    });
    wasNew = result.wasNew;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[ghl-oauth] DB upsert failed for resource ${resourceId} (${resourceType}): ${message}`,
    );
    return redirectError(req, "storage_failed", message);
  }

  // ── 5. Audit-log + redirect. ──
  void (async () => {
    try {
      const { logAudit } = await import("@/lib/audit");
      await logAudit("ghl_install", {
        entity: "ghl_oauth_tokens",
        resourceId,
        resourceType,
        locationId,
        companyId,
        locationName,
        companyName,
        scope: tokens.scope ?? null,
      });
    } catch (auditErr) {
      console.error(
        "[ghl-oauth] audit log failed (non-fatal):",
        auditErr instanceof Error ? auditErr.message : String(auditErr),
      );
    }
  })();

  return redirectSuccess(req, resourceId, { wasNew });
}
