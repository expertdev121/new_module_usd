/**
 * Proactive daily refresh of every active GHL OAuth token row.
 *
 * getValidAccessToken() only refreshes lazily, so a connection nobody touches
 * for a while can sit with an expired access token. This walks every active
 * row (Company and Location) and rotates it through the standard
 * refresh_token flow, persisting the rotated refresh token immediately.
 *
 * Failure handling mirrors getValidAccessToken():
 *   - 429 / 5xx / network → transient, row left untouched, retried next run
 *   - other 4xx on a Location row → try re-minting from its Company token,
 *     else flag needs_reinstall
 *   - other 4xx on a Company row → flag needs_reinstall
 */
import { listAllConnections, markTokenStatusByResource } from "./oauth-storage";
import { refreshAccessToken, maskToken } from "./oauth-client";
import { mintFromCompany } from "./get-access-token";
import { db } from "@/lib/db";
import { ghlOauthTokens, type GhlOauthToken } from "@/lib/db/schema-oauth";
import { eq } from "drizzle-orm";

const CONCURRENCY = 5;

export type RefreshOutcome = "refreshed" | "reminted" | "needs_reinstall" | "transient_error";

export interface RefreshResult {
  resourceId: string;
  resourceType: string;
  outcome: RefreshOutcome;
  error?: string;
}

async function refreshRow(row: GhlOauthToken): Promise<RefreshResult> {
  const base = { resourceId: row.resourceId, resourceType: row.resourceType };
  try {
    const fresh = await refreshAccessToken(row.refreshToken);
    await db
      .update(ghlOauthTokens)
      .set({
        accessToken: fresh.access_token,
        refreshToken: fresh.refresh_token,
        expiresAt: new Date(Date.now() + fresh.expires_in * 1000),
        scope: fresh.scope ?? undefined,
        tokenType: fresh.token_type ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(ghlOauthTokens.resourceId, row.resourceId));
    return { ...base, outcome: "refreshed" };
  } catch (err) {
    const e = err as Error & { isClientError?: boolean; status?: number };
    const message = e.message ?? String(err);
    const hard = e.isClientError === true && e.status !== 429 && e.status !== 408;
    if (!hard) return { ...base, outcome: "transient_error", error: message };

    if (row.resourceType === "Location" && row.locationId && row.companyId) {
      try {
        await mintFromCompany(row.companyId, row.locationId);
        return { ...base, outcome: "reminted" };
      } catch (mintErr) {
        console.error(
          `[ghl-refresh] re-mint failed for ${row.resourceId}:`,
          mintErr instanceof Error ? mintErr.message : String(mintErr),
        );
      }
    }
    await markTokenStatusByResource(row.resourceId, "needs_reinstall", "refresh_failed");
    console.error(
      `[ghl-refresh] refresh REJECTED for ${row.resourceId} (refresh_token=${maskToken(row.refreshToken)}); marked needs_reinstall`,
    );
    return { ...base, outcome: "needs_reinstall", error: message };
  }
}

export async function refreshAllGhlTokens(): Promise<RefreshResult[]> {
  const rows = (await listAllConnections()).filter((r) => r.status === "active");
  const results: RefreshResult[] = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = await Promise.all(rows.slice(i, i + CONCURRENCY).map(refreshRow));
    results.push(...batch);
  }
  return results;
}
