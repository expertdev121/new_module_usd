/**
 * Pure functions for talking to GHL's OAuth and Location APIs.
 *
 * No DB writes here — caller is responsible for persistence. No tokens are
 * ever logged in plaintext: maskToken() leaves only the last 4 chars visible.
 */
import type {
  GhlTokenResponse,
  GhlLocationInfo,
  GhlInstalledLocation,
  GhlLocationTokenResponse,
} from "./types";

const TOKEN_ENDPOINT = "/oauth/token";

function apiBase(): string {
  return process.env.GHL_API_BASE_URL || "https://services.leadconnectorhq.com";
}

function apiVersion(): string {
  return process.env.GHL_API_VERSION || "2021-07-28";
}

/**
 * Returns a token with everything but the last 4 chars replaced, so we can
 * safely include it in error logs.
 *   "eyJhbGciOiJIUzI1NiJ9.abc.xyzkXY9k" → "eyJh...xY9k"
 */
export function maskToken(token: string | null | undefined): string {
  if (!token) return "<empty>";
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * GHL Marketplace App ID — needed for the agency-level
 * `/oauth/installedLocations` call. Defaults to the portion of GHL_CLIENT_ID
 * before the first `-` (GHL client IDs are formatted as
 * `{appId}-{secretSuffix}`). Override with the GHL_APP_ID env var if your
 * client_id doesn't follow that pattern.
 */
function getAppId(): string {
  if (process.env.GHL_APP_ID) return process.env.GHL_APP_ID;
  return requireEnv("GHL_CLIENT_ID").split("-")[0];
}

/** Build the URL we send users to in order to start the GHL install flow. */
export function buildAuthorizeUrl(params: { state: string; scopes: string }): string {
  const url = new URL("/oauth/chooselocation", apiBase());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", requireEnv("GHL_CLIENT_ID"));
  url.searchParams.set("redirect_uri", requireEnv("GHL_REDIRECT_URI"));
  url.searchParams.set("scope", params.scopes);
  url.searchParams.set("state", params.state);
  return url.toString();
}

/**
 * Exchange an authorization code for tokens, specifying user_type.
 *
 * GHL requires `user_type` to MATCH how the customer installed:
 *   - Sub-account install (chose a specific location) → user_type=Location
 *   - Agency install (installed at the company / multiple locations) →
 *     user_type=Company
 *
 * If you don't know which path the user took, use `exchangeCodeFlexibly()`
 * — it tries Location first, falls back to Company on failure.
 */
export async function exchangeCodeForTokens(
  code: string,
  userType: "Location" | "Company" = "Location",
): Promise<GhlTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv("GHL_CLIENT_ID"),
    client_secret: requireEnv("GHL_CLIENT_SECRET"),
    grant_type: "authorization_code",
    code,
    user_type: userType,
    redirect_uri: requireEnv("GHL_REDIRECT_URI"),
  });

  const response = await fetch(`${apiBase()}${TOKEN_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `GHL token exchange failed (user_type=${userType}): HTTP ${response.status}. ${text.slice(0, 300)}`,
    );
  }

  return (await response.json()) as GhlTokenResponse;
}

/**
 * Try the token exchange as a Location install first; if that fails OR
 * succeeds but returns no locationId (which is how agency installs show up),
 * retry as a Company install. Returns whichever exchange yields a usable
 * token.
 *
 * Note: codes are single-use, so if the Location attempt actually CONSUMED
 * the code (succeeded), we can't retry with Company. We only retry when the
 * Location attempt FAILED (4xx response) before consuming the code.
 */
export async function exchangeCodeFlexibly(
  code: string,
): Promise<GhlTokenResponse> {
  try {
    const tokens = await exchangeCodeForTokens(code, "Location");
    // If GHL gave us back a Company-flavored response (no locationId,
    // userType=Company), the install was actually agency-level — we accept
    // the token as-is and let the caller handle the multi-location path.
    return tokens;
  } catch (locErr) {
    const locMsg = locErr instanceof Error ? locErr.message : "unknown";
    // Retry as Company. If the code was already consumed by the failed
    // attempt, this will also fail with HTTP 400 (code_expired/invalid).
    try {
      return await exchangeCodeForTokens(code, "Company");
    } catch (compErr) {
      const compMsg = compErr instanceof Error ? compErr.message : "unknown";
      throw new Error(
        `Token exchange failed in both modes. ` +
          `Location: ${locMsg}. Company: ${compMsg}`,
      );
    }
  }
}

/**
 * Exchange a refresh token for a fresh access token + refresh token.
 * GHL rotates the refresh token on each refresh, so callers MUST persist
 * the new refresh_token returned in the response.
 */
export async function refreshAccessToken(refreshToken: string): Promise<GhlTokenResponse> {
  const body = new URLSearchParams({
    client_id: requireEnv("GHL_CLIENT_ID"),
    client_secret: requireEnv("GHL_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    user_type: "Location",
  });

  const response = await fetch(`${apiBase()}${TOKEN_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(
      `GHL refresh failed: HTTP ${response.status}. refreshToken=${maskToken(refreshToken)}. ${text.slice(0, 300)}`,
    );
    // Tag 4xx as a hard failure so callers can distinguish from transient errors.
    (err as Error & { isClientError?: boolean }).isClientError =
      response.status >= 400 && response.status < 500;
    throw err;
  }

  return (await response.json()) as GhlTokenResponse;
}

/**
 * Agency-only: list the sub-accounts (locations) this app is installed on
 * under a given company. Called immediately after an agency-level token
 * exchange so we know which locations to provision rows for.
 *
 *   GET /oauth/installedLocations?companyId=...&appId=...
 *   Authorization: Bearer {agencyAccessToken}
 *   Version: 2021-07-28
 *
 * Returns `{ locations: [{ _id, name, address, isInstalled }, ...] }`.
 */
export async function fetchInstalledLocations(
  companyId: string,
  agencyAccessToken: string,
): Promise<GhlInstalledLocation[]> {
  const url = new URL(`${apiBase()}/oauth/installedLocations`);
  url.searchParams.set("companyId", companyId);
  url.searchParams.set("appId", getAppId());
  url.searchParams.set("limit", "500");
  // Ask GHL to return ONLY locations where this app is actually installed.
  // Without this, GHL returns every sub-account the agency owns — most of
  // which aren't installed, leading to a wave of 400s when we try to mint a
  // location-token for each.
  url.searchParams.set("isInstalled", "true");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${agencyAccessToken}`,
      Version: apiVersion(),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `GHL installedLocations fetch failed: HTTP ${response.status}. companyId=${companyId}. accessToken=${maskToken(agencyAccessToken)}. ${text.slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as
    | { locations?: GhlInstalledLocation[] }
    | GhlInstalledLocation[];

  const raw = Array.isArray(payload) ? payload : (payload.locations ?? []);

  // Defensive: even with isInstalled=true server-side, filter client-side too
  // — GHL has occasionally been observed ignoring the filter in some
  // versions. Keep entries that either explicitly mark isInstalled=true OR
  // omit the field entirely (older payloads).
  return raw.filter((loc) => loc.isInstalled !== false);
}

/**
 * Agency-only: exchange the agency-level access token for a location-scoped
 * access token. Used after fetchInstalledLocations() to provision one token
 * row per installed sub-account.
 *
 *   POST /oauth/locationToken
 *   Content-Type: application/x-www-form-urlencoded
 *   companyId=...&locationId=...
 *   Authorization: Bearer {agencyAccessToken}
 *   Version: 2021-07-28
 */
export async function exchangeCompanyTokenForLocationToken(
  companyId: string,
  locationId: string,
  agencyAccessToken: string,
): Promise<GhlLocationTokenResponse> {
  const body = new URLSearchParams({ companyId, locationId });

  const response = await fetch(`${apiBase()}/oauth/locationToken`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agencyAccessToken}`,
      Version: apiVersion(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `GHL locationToken exchange failed: HTTP ${response.status}. companyId=${companyId}, locationId=${locationId}. accessToken=${maskToken(agencyAccessToken)}. ${text.slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as GhlLocationTokenResponse;
  // Defensive: ensure locationId echoed in response. Some GHL endpoints
  // include it, some don't — fall back to the one we requested.
  if (!payload.locationId) payload.locationId = locationId;
  return payload;
}

/**
 * Fetch a GHL location (sub-account) by id. Used post-install to read the
 * human-readable name + company info for the success page.
 */
export async function getLocationInfo(
  locationId: string,
  accessToken: string,
): Promise<GhlLocationInfo> {
  const response = await fetch(`${apiBase()}/locations/${locationId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: apiVersion(),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `GHL location fetch failed: HTTP ${response.status}. locationId=${locationId}. accessToken=${maskToken(accessToken)}. ${text.slice(0, 300)}`,
    );
  }

  // GHL wraps the response in either { location: {...} } or returns the object directly
  // depending on endpoint version — handle both.
  const payload = (await response.json()) as unknown;
  if (payload && typeof payload === "object" && "location" in payload) {
    return (payload as { location: GhlLocationInfo }).location;
  }
  return payload as GhlLocationInfo;
}
