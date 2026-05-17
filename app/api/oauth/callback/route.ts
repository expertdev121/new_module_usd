/**
 * GET /api/oauth/callback
 *
 * Single entry point for ALL GHL Marketplace install flows. We support:
 *
 *   A) Sub-account install (user picked a specific location)
 *      → token response has `userType=Location` + `locationId`
 *      → we store ONE row in ghl_oauth_tokens
 *      → redirect to /oauth/success?locationId=...
 *
 *   B) Agency install (user installed at the company level — possibly
 *      across many sub-accounts at once)
 *      → token response has `userType=Company` + `companyId`, NO locationId
 *      → we call GHL's /oauth/installedLocations to enumerate sub-accounts
 *      → for each one we call /oauth/locationToken to exchange the agency
 *        token for a location-scoped token
 *      → we store ONE row PER location, all sharing the same companyId
 *      → redirect to /oauth/success?locationId=<first> so the success page
 *        renders correctly; the rest are visible at /admin/connections
 *
 * Every failure logs a server-side error (tokens masked) and redirects to
 * /oauth/error?reason=... with a stable reason code.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeCodeFlexibly,
  fetchInstalledLocations,
  exchangeCompanyTokenForLocationToken,
  getLocationInfo,
  maskToken,
} from "@/lib/ghl/oauth-client";
import { upsertTokenRecord } from "@/lib/ghl/oauth-storage";
import { isStateValid, STATE_COOKIE_NAME, getStateCookieOptions } from "@/lib/ghl/state-cookie";
import type { OauthErrorReason, GhlTokenResponse } from "@/lib/ghl/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appBase(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
}

function redirectError(req: NextRequest, reason: OauthErrorReason) {
  const url = new URL("/oauth/error", appBase(req));
  url.searchParams.set("reason", reason);
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE_NAME, "", { ...getStateCookieOptions(), maxAge: 0 });
  return response;
}

function redirectSuccess(req: NextRequest, locationId: string, extra?: Record<string, string>) {
  const url = new URL("/oauth/success", appBase(req));
  url.searchParams.set("locationId", locationId);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  }
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE_NAME, "", { ...getStateCookieOptions(), maxAge: 0 });
  return response;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateFromQuery = req.nextUrl.searchParams.get("state");
  const stateFromCookie = req.cookies.get(STATE_COOKIE_NAME)?.value ?? null;

  /* CSRF state validation — enforce only when a cookie was set on our side.
     See git history for the full reasoning; in short: state cookie present
     means WE initiated the install, so the query state MUST match. No cookie
     means GHL Marketplace initiated the install, where CSRF doesn't apply. */
  if (stateFromCookie && !isStateValid(stateFromQuery, stateFromCookie)) {
    console.warn(
      "[ghl-oauth] callback rejected — state cookie set but query state doesn't match.",
    );
    return redirectError(req, "invalid_state");
  }

  if (!code) return redirectError(req, "missing_code");

  // ── 1. Exchange code for tokens (Location-then-Company fallback). ──
  let tokens: GhlTokenResponse;
  try {
    tokens = await exchangeCodeFlexibly(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ghl-oauth] token exchange failed:", message);
    return redirectError(req, "token_exchange_failed");
  }

  const companyId =
    tokens.companyId || req.nextUrl.searchParams.get("companyId") || "";

  // ── 2. Branch on userType. ──
  if (tokens.userType === "Company" && !tokens.locationId) {
    return await handleAgencyInstall(req, tokens, companyId);
  }
  return await handleLocationInstall(req, tokens, companyId);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-ACCOUNT install — single location, single token row.
// ─────────────────────────────────────────────────────────────────────────────
async function handleLocationInstall(
  req: NextRequest,
  tokens: GhlTokenResponse,
  companyId: string,
): Promise<NextResponse> {
  const locationId =
    tokens.locationId || req.nextUrl.searchParams.get("locationId") || "";

  if (!locationId) {
    console.error(
      `[ghl-oauth] Location install succeeded but no locationId returned. access_token=${maskToken(tokens.access_token)}`,
    );
    return redirectError(req, "missing_location");
  }

  // Fetch location/company display names (best-effort, never blocks).
  let locationName: string | null = null;
  let companyName: string | null = null;
  try {
    const info = await getLocationInfo(locationId, tokens.access_token);
    locationName = info.name ?? null;
    companyName = info.business?.name ?? null;
  } catch (err) {
    console.error(
      `[ghl-oauth] location fetch failed for ${locationId} (access_token=${maskToken(tokens.access_token)}):`,
      err instanceof Error ? err.message : String(err),
    );
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  try {
    await upsertTokenRecord({
      locationId,
      companyId,
      userId: tokens.userId ?? null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      scope: tokens.scope ?? null,
      tokenType: tokens.token_type ?? "Bearer",
      userType: tokens.userType ?? "Location",
      locationName,
      companyName,
    });
  } catch (err) {
    console.error(
      `[ghl-oauth] DB upsert failed for location ${locationId} (access_token=${maskToken(tokens.access_token)}):`,
      err instanceof Error ? err.message : String(err),
    );
    return redirectError(req, "storage_failed");
  }

  void auditInstall({ locationId, companyId, locationName, companyName, scope: tokens.scope, mode: "location" });
  return redirectSuccess(req, locationId);
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENCY install — fan out: list installed sub-accounts, exchange agency
// token for a per-location token, store one row per location.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAgencyInstall(
  req: NextRequest,
  agencyTokens: GhlTokenResponse,
  companyId: string,
): Promise<NextResponse> {
  if (!companyId) {
    console.error(
      `[ghl-oauth] Company install but no companyId returned. access_token=${maskToken(agencyTokens.access_token)}`,
    );
    return redirectError(req, "missing_location");
  }

  // 1. Enumerate installed locations under the company.
  let locations: { _id: string; name?: string | null }[];
  try {
    locations = await fetchInstalledLocations(companyId, agencyTokens.access_token);
  } catch (err) {
    console.error(
      `[ghl-oauth] installedLocations fetch failed (companyId=${companyId}):`,
      err instanceof Error ? err.message : String(err),
    );
    return redirectError(req, "location_fetch_failed");
  }

  if (locations.length === 0) {
    console.error(
      `[ghl-oauth] Company install but 0 installed locations returned. companyId=${companyId}`,
    );
    return redirectError(req, "missing_location");
  }

  // 2. For each location, swap the agency token for a location token, then upsert.
  let successCount = 0;
  let firstLocationId: string | null = null;
  for (const loc of locations) {
    const locationId = loc._id;
    if (!locationId) continue;

    try {
      const locTokens = await exchangeCompanyTokenForLocationToken(
        companyId,
        locationId,
        agencyTokens.access_token,
      );

      // Best-effort location/company name fetch.
      let locationName: string | null = loc.name ?? null;
      let companyName: string | null = null;
      try {
        const info = await getLocationInfo(locationId, locTokens.access_token);
        locationName = info.name ?? locationName;
        companyName = info.business?.name ?? null;
      } catch {
        // Not fatal — keep what we have.
      }

      const expiresAt = new Date(Date.now() + locTokens.expires_in * 1000);
      await upsertTokenRecord({
        locationId,
        companyId,
        userId: agencyTokens.userId ?? null,
        accessToken: locTokens.access_token,
        refreshToken: locTokens.refresh_token,
        expiresAt,
        scope: locTokens.scope ?? agencyTokens.scope ?? null,
        tokenType: locTokens.token_type ?? "Bearer",
        userType: "Location",
        locationName,
        companyName,
      });

      void auditInstall({
        locationId,
        companyId,
        locationName,
        companyName,
        scope: locTokens.scope ?? null,
        mode: "agency_fanout",
      });

      if (!firstLocationId) firstLocationId = locationId;
      successCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Two expected per-location skips that aren't real errors:
      //   • "Location is not active" — sub-account is paused/disabled in GHL
      //   • "Invalid locationId or accessToken does not have access" — app
      //     not actually installed on this sub-account (just listed by
      //     /installedLocations because it exists under the company)
      // Log these at info level so they don't drown the logs in red.
      const expected =
        msg.includes("Location is not active") ||
        msg.includes("does not have access to following location");
      if (expected) {
        console.log(
          `[ghl-oauth] Skipped location ${locationId} (expected): ${msg.slice(0, 140)}`,
        );
      } else {
        console.error(
          `[ghl-oauth] Agency-fanout failed for location ${locationId} under company ${companyId}: ${msg}`,
        );
      }
      // Continue — partial success is better than total failure.
    }
  }

  if (successCount === 0 || !firstLocationId) {
    console.error(
      `[ghl-oauth] Agency install for company ${companyId}: zero sub-accounts could be provisioned. ` +
        `Either the app isn't installed on any sub-account, or all installed sub-accounts are paused. ` +
        `Ask the customer to choose specific sub-accounts during install on GHL.`,
    );
    return redirectError(req, "missing_location");
  }

  // Land the user on the success page for the first location.
  // /admin/connections shows the full list.
  return redirectSuccess(req, firstLocationId, {
    installed: String(successCount),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function auditInstall(meta: {
  locationId: string;
  companyId: string;
  locationName: string | null;
  companyName: string | null;
  scope?: string | null;
  mode: "location" | "agency_fanout";
}): Promise<void> {
  try {
    const { logAudit } = await import("@/lib/audit");
    await logAudit("ghl_install", {
      entity: "ghl_oauth_tokens",
      ...meta,
    });
  } catch (err) {
    console.error(
      "[ghl-oauth] audit log failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}
