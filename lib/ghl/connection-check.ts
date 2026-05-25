/**
 * Determine whether a given location can actually sync with GHL right now.
 *
 * "Can sync" means at least one of:
 *   - An active Location-scoped token row exists for this locationId, OR
 *   - An active Company-scoped token row exists whose lazy-mint path can
 *     produce a per-location token for this locationId.
 *
 * If neither is true, the app effectively isn't installed for this
 * sub-account — clicking Sync Now would create a job that fails on the
 * first chunk with "no GHL connection found", which is exactly the bug
 * we're protecting against.
 *
 * We intentionally do NOT call GHL here (no network). The Company-scoped
 * check is conservative: if ANY active Company token exists in our DB,
 * we assume it could cover this location. This matches the lazy-mint
 * behaviour in getValidAccessToken (which iterates all Company tokens
 * trying to mint when no per-location token exists).
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export interface ConnectionCheckResult {
  canSync: boolean;
  /** Machine-readable reason. Useful for tests + audit log. */
  reason:
    | "ok_location_token"
    | "ok_company_fallback"
    | "no_install"
    | "all_revoked";
  /** Human-readable message for UI. */
  message: string;
}

export async function canSyncLocation(
  locationId: string,
): Promise<ConnectionCheckResult> {
  if (!locationId) {
    return {
      canSync: false,
      reason: "no_install",
      message: "No locationId on session — sign in again or contact support.",
    };
  }

  // 1. Look for an active Location-scoped token.
  const locRes = await db.execute(sql`
    SELECT id, status
      FROM ghl_oauth_tokens
     WHERE location_id = ${locationId}
       AND resource_type = 'Location'
     ORDER BY status = 'active' DESC, created_at DESC
     LIMIT 1
  `);
  const locRows = extractRows(locRes) as { status: string }[];
  if (locRows.length > 0 && locRows[0].status === "active") {
    return {
      canSync: true,
      reason: "ok_location_token",
      message: "GHL is connected to this sub-account.",
    };
  }

  // 2. Fall back: any active Company-scoped token at all? The lazy-mint
  // path inside getValidAccessToken will iterate these.
  const compRes = await db.execute(sql`
    SELECT id
      FROM ghl_oauth_tokens
     WHERE resource_type = 'Company'
       AND status = 'active'
     LIMIT 1
  `);
  const compRows = extractRows(compRes);
  if (compRows.length > 0) {
    return {
      canSync: true,
      reason: "ok_company_fallback",
      message: "GHL is connected via an agency-level install.",
    };
  }

  // 3. No live tokens of any kind. Distinguish "never installed" vs
  // "everything is revoked" so the UI message can be more specific.
  if (locRows.length > 0) {
    return {
      canSync: false,
      reason: "all_revoked",
      message:
        "GHL was previously connected but the token has been revoked. Reinstall the DonorHQ app on this sub-account or contact the GiveSuite developer team.",
    };
  }
  return {
    canSync: false,
    reason: "no_install",
    message:
      "The DonorHQ app isn't installed on this GoHighLevel sub-account yet. Contact the GiveSuite developer team to enable syncing.",
  };
}

function extractRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const r = result as { rows?: unknown[] };
    return r.rows ?? [];
  }
  return [];
}
