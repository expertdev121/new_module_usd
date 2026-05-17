/**
 * Public helper: returns a valid GHL access token for a given locationId.
 *
 * - If the stored token has more than 1 hour of life left, returns it as-is.
 * - Otherwise (or if already expired) calls GHL's refresh endpoint, persists
 *   the rotated tokens, and returns the fresh access_token.
 * - Concurrent refresh attempts for the same locationId are deduped via an
 *   in-process Map<locationId, Promise> so only one HTTP call is in flight
 *   at a time per location.
 *
 * Other modules should ALWAYS go through this function rather than reading
 * access_token from the DB directly, so refresh handling is centralized.
 *
 * Usage:
 *   const token = await getValidAccessToken(locationId);
 *   const res = await fetch("https://services.leadconnectorhq.com/contacts/...",
 *                           { headers: { Authorization: `Bearer ${token}` } });
 */
import { refreshAccessToken, maskToken } from "./oauth-client";
import {
  getTokenRecord,
  updateTokensAfterRefresh,
  markTokenStatus,
} from "./oauth-storage";

const REFRESH_BEFORE_MS = 60 * 60 * 1000; // refresh if < 1 hour to expiry

/** Per-location in-flight refresh promises, so concurrent callers share work. */
const inFlightRefreshes = new Map<string, Promise<string>>();

export async function getValidAccessToken(locationId: string): Promise<string> {
  if (!locationId) {
    throw new Error("getValidAccessToken: locationId is required");
  }

  const record = await getTokenRecord(locationId);
  if (!record) {
    throw new Error(
      `No GHL connection found for location ${locationId}. The user must install the Donor HQ app on this sub-account first.`,
    );
  }

  // A revoked connection (user uninstalled, admin disconnected, or refresh
  // previously rejected) must be re-installed before we can use it again.
  // Refusing here avoids burning the refresh token, surfaces the right
  // re-install CTA to the user.
  if (record.status !== "active") {
    throw new Error(
      `GHL connection for location ${locationId} is ${record.status}. The user must reinstall the Donor HQ app.`,
    );
  }

  const msUntilExpiry = record.expiresAt.getTime() - Date.now();
  if (msUntilExpiry > REFRESH_BEFORE_MS) {
    return record.accessToken;
  }

  // Token is close to expiry or already expired — refresh, dedup concurrent callers.
  const existing = inFlightRefreshes.get(locationId);
  if (existing) return existing;

  const refreshPromise = (async () => {
    try {
      const fresh = await refreshAccessToken(record.refreshToken);
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
      // 4xx from GHL means the refresh token is rejected — the connection is broken
      // and the user has to re-install. Surface a clear, descriptive error so callers
      // can react (e.g. show a "reconnect" banner).
      if (error.isClientError) {
        // Mark the connection so the connections page can show "Reconnect"
        // and so subsequent callers fail fast without burning more tokens.
        try {
          await markTokenStatus(locationId, "needs_reinstall", "refresh_failed");
        } catch (markErr) {
          console.error(
            `[ghl] Failed to flag connection as needs_reinstall: ${markErr instanceof Error ? markErr.message : String(markErr)}`,
          );
        }
        console.error(
          `[ghl] Refresh REJECTED for location ${locationId} ` +
            `(refresh_token=${maskToken(record.refreshToken)}). ` +
            `User must reinstall the Donor HQ app on this sub-account.`,
        );
        throw new Error(
          `GHL connection for location ${locationId} is no longer valid. The user must reinstall the Donor HQ app.`,
        );
      }
      console.error(`[ghl] Refresh failed for location ${locationId}: ${error.message}`);
      throw error;
    } finally {
      inFlightRefreshes.delete(locationId);
    }
  })();

  inFlightRefreshes.set(locationId, refreshPromise);
  return refreshPromise;
}
