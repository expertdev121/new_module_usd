/**
 * Public helper: returns a valid GHL access token for a given locationId.
 *
 * Lookup order (matches the official GHL Marketplace template's lazy
 * `getLocationTokenFromCompanyToken` pattern):
 *
 *   1. Find an existing Location-scoped row for `locationId`.
 *        - If status != 'active' → throw "needs reinstall"
 *        - If access token has >1h life → return as-is
 *        - Otherwise call the standard refresh-token flow and return new token
 *
 *   2. No location row exists. Fall back to the agency:
 *        - Caller passed `companyId` (always true for webhook handlers, which
 *          receive `companyId` in the payload) → look up the Company token
 *          → call /oauth/locationToken with companyId + locationId
 *          → store the new location-scoped row → return its access_token
 *
 *   3. No company token either → throw "not installed."
 *
 * Concurrent callers for the same locationId share an in-process Promise to
 * avoid burning multiple refresh tokens (or minting multiple identical rows).
 *
 * Usage:
 *   const token = await getValidAccessToken(locationId, { companyId });
 *   await fetch("https://services.leadconnectorhq.com/contacts/...", {
 *     headers: { Authorization: `Bearer ${token}` },
 *   });
 */
import {
  refreshAccessToken,
  exchangeCompanyTokenForLocationToken,
  maskToken,
} from "./oauth-client";
import {
  getTokenRecord,
  updateTokensAfterRefresh,
  markTokenStatus,
  findActiveCompanyToken,
  upsertTokenRecord,
  getTokenRecordByResource,
} from "./oauth-storage";

const REFRESH_BEFORE_MS = 60 * 60 * 1000; // 1h before expiry, proactively refresh

/** Dedup map for concurrent callers of the SAME locationId. */
const inFlight = new Map<string, Promise<string>>();

interface Opts {
  /**
   * Optional companyId — when provided AND no location row exists, we use
   * the company's token to mint a fresh location-token. Webhook handlers
   * always have it (GHL puts it in every webhook payload), so they pass it.
   */
  companyId?: string;
}

export async function getValidAccessToken(
  locationId: string,
  opts: Opts = {},
): Promise<string> {
  if (!locationId) {
    throw new Error("getValidAccessToken: locationId is required");
  }

  const existing = inFlight.get(locationId);
  if (existing) return existing;

  const promise = resolveLocationToken(locationId, opts).finally(() => {
    inFlight.delete(locationId);
  });
  inFlight.set(locationId, promise);
  return promise;
}

async function resolveLocationToken(
  locationId: string,
  opts: Opts,
): Promise<string> {
  // Step 1: try the per-location row.
  const locRow = await getTokenRecord(locationId);
  if (locRow) {
    if (locRow.status !== "active") {
      throw new Error(
        `GHL connection for location ${locationId} is ${locRow.status}. The user must reinstall the Donor HQ app.`,
      );
    }

    const msUntilExpiry = locRow.expiresAt.getTime() - Date.now();
    if (msUntilExpiry > REFRESH_BEFORE_MS) {
      return locRow.accessToken;
    }

    // Refresh — standard OAuth refresh_token flow. GHL rotates the refresh
    // token, so we persist whatever comes back.
    try {
      const fresh = await refreshAccessToken(locRow.refreshToken);
      const newExpiresAt = new Date(Date.now() + fresh.expires_in * 1000);
      await updateTokensAfterRefresh(locationId, {
        accessToken: fresh.access_token,
        refreshToken: fresh.refresh_token,
        expiresAt: newExpiresAt,
        scope: fresh.scope,
        tokenType: fresh.token_type,
      });
      return fresh.access_token;
    } catch (err) {
      const error = err as Error & { isClientError?: boolean };
      if (error.isClientError) {
        // 4xx — refresh token rejected. Try to recover by re-minting from
        // the parent company token (if we have one) BEFORE giving up.
        if (locRow.companyId) {
          try {
            const minted = await mintFromCompany(locRow.companyId, locationId);
            return minted;
          } catch (mintErr) {
            // Fallthrough to marking the location row needs_reinstall.
            console.error(
              `[ghl] Fallback mint-from-company failed for ${locationId}:`,
              mintErr instanceof Error ? mintErr.message : String(mintErr),
            );
          }
        }
        try {
          await markTokenStatus(locationId, "needs_reinstall", "refresh_failed");
        } catch {
          /* ignore — best effort */
        }
        console.error(
          `[ghl] Refresh REJECTED for ${locationId} (refresh_token=${maskToken(locRow.refreshToken)}). ` +
            `User must reinstall.`,
        );
        throw new Error(
          `GHL connection for location ${locationId} is no longer valid. The user must reinstall the Donor HQ app.`,
        );
      }
      // 5xx / network — surface as-is.
      throw error;
    }
  }

  // Step 2: no per-location row. Try the company token if we know which.
  const companyId = opts.companyId;
  if (!companyId) {
    throw new Error(
      `No GHL connection found for location ${locationId} and no companyId provided to attempt a fallback mint. ` +
        `Either the app was never installed on this sub-account or the caller must pass { companyId }.`,
    );
  }

  return mintFromCompany(companyId, locationId);
}

/**
 * Mint a fresh location-token from an active Company token, store it as a
 * Location-scoped row, and return the access_token. The new row has the
 * same companyId so future calls can re-mint if needed.
 *
 * This is the official template's `getLocationTokenFromCompanyToken` path,
 * called lazily instead of preemptively.
 */
async function mintFromCompany(
  companyId: string,
  locationId: string,
): Promise<string> {
  const companyRow = await findActiveCompanyToken(companyId);
  if (!companyRow) {
    throw new Error(
      `No active GHL connection for company ${companyId}. ` +
        `User must (re)install Donor HQ at the agency level or directly on sub-account ${locationId}.`,
    );
  }

  // Ensure the company token itself is fresh enough to authenticate the
  // /oauth/locationToken call. If close to expiry, refresh it first.
  let companyAccess = companyRow.accessToken;
  const companyMs = companyRow.expiresAt.getTime() - Date.now();
  if (companyMs <= REFRESH_BEFORE_MS) {
    try {
      const fresh = await refreshAccessToken(companyRow.refreshToken);
      const newExpiresAt = new Date(Date.now() + fresh.expires_in * 1000);
      // Update the Company-scoped row by its resource_id (NOT location_id —
      // company rows have NULL location_id).
      await upsertTokenRecord({
        resourceId: companyRow.resourceId,
        resourceType: "Company",
        locationId: null,
        companyId,
        userId: companyRow.userId ?? null,
        accessToken: fresh.access_token,
        refreshToken: fresh.refresh_token,
        expiresAt: newExpiresAt,
        scope: fresh.scope ?? companyRow.scope,
        tokenType: fresh.token_type ?? "Bearer",
        userType: "Company",
        locationName: null,
        companyName: companyRow.companyName,
      });
      companyAccess = fresh.access_token;
    } catch (err) {
      throw new Error(
        `Failed to refresh company token before minting location token for ${locationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Mint the location-scoped token.
  const locTokens = await exchangeCompanyTokenForLocationToken(
    companyId,
    locationId,
    companyAccess,
  );

  // Store as a new Location-scoped row keyed on locationId.
  const newExpiresAt = new Date(Date.now() + locTokens.expires_in * 1000);
  await upsertTokenRecord({
    resourceId: locationId,
    resourceType: "Location",
    locationId,
    companyId,
    userId: companyRow.userId ?? null,
    accessToken: locTokens.access_token,
    refreshToken: locTokens.refresh_token,
    expiresAt: newExpiresAt,
    scope: locTokens.scope ?? companyRow.scope,
    tokenType: locTokens.token_type ?? "Bearer",
    userType: "Location",
    // We don't have a name here unless we fetch /locations/{id}. Leave null
    // — the connections UI will fall back to showing the location id.
    locationName: null,
    companyName: companyRow.companyName,
  });

  return locTokens.access_token;
}

/**
 * Get an access token for a Company-scoped resource (rarely needed — most
 * code goes through getValidAccessToken(locationId)). Used by the lazy
 * mint path when refreshing the company token itself.
 */
export async function getCompanyAccessToken(companyId: string): Promise<string> {
  const row = await getTokenRecordByResource(companyId);
  if (!row) {
    throw new Error(
      `No GHL connection found for company ${companyId}. User must install Donor HQ at the agency level.`,
    );
  }
  if (row.status !== "active") {
    throw new Error(
      `GHL connection for company ${companyId} is ${row.status}. User must reinstall.`,
    );
  }
  const ms = row.expiresAt.getTime() - Date.now();
  if (ms > REFRESH_BEFORE_MS) return row.accessToken;

  const fresh = await refreshAccessToken(row.refreshToken);
  const newExpiresAt = new Date(Date.now() + fresh.expires_in * 1000);
  await upsertTokenRecord({
    resourceId: companyId,
    resourceType: "Company",
    locationId: null,
    companyId,
    userId: row.userId ?? null,
    accessToken: fresh.access_token,
    refreshToken: fresh.refresh_token,
    expiresAt: newExpiresAt,
    scope: fresh.scope ?? row.scope,
    tokenType: fresh.token_type ?? "Bearer",
    userType: "Company",
    locationName: null,
    companyName: row.companyName,
  });
  return fresh.access_token;
}
