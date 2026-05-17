/**
 * Database access for ghl_oauth_tokens. Uses Drizzle explicit-table form
 * (db.insert(ghlOauthTokens)...) since this table is intentionally not
 * registered with db.query.* — see lib/db/schema-oauth.ts for why.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ghlOauthTokens, type GhlOauthToken, type NewGhlOauthToken } from "@/lib/db/schema-oauth";

export type TokenStatus = "active" | "needs_reinstall" | "revoked";
export type RevokedReason =
  | "user_uninstalled"
  | "admin_disconnected"
  | "refresh_failed"
  | "other";

export async function getTokenRecord(locationId: string): Promise<GhlOauthToken | null> {
  const rows = await db
    .select()
    .from(ghlOauthTokens)
    .where(eq(ghlOauthTokens.locationId, locationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Insert a new token row, or update the existing one for this location.
 * Re-installing on the same sub-account just overwrites the existing row.
 */
export async function upsertTokenRecord(input: {
  locationId: string;
  companyId: string;
  userId?: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope?: string | null;
  tokenType?: string | null;
  userType?: string | null;
  locationName?: string | null;
  companyName?: string | null;
  isWhitelabelCompany?: boolean;
}): Promise<GhlOauthToken> {
  const now = new Date();

  const insertValues: NewGhlOauthToken = {
    locationId: input.locationId,
    companyId: input.companyId,
    userId: input.userId ?? null,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresAt,
    scope: input.scope ?? null,
    tokenType: input.tokenType ?? "Bearer",
    userType: input.userType ?? null,
    locationName: input.locationName ?? null,
    companyName: input.companyName ?? null,
    isWhitelabelCompany: input.isWhitelabelCompany ?? false,
    // Every fresh install (or re-install on a previously revoked row) reactivates
    // the connection. Clear any prior revocation so the connection is usable.
    status: "active",
    revokedAt: null,
    revokedReason: null,
    updatedAt: now,
  };

  const [row] = await db
    .insert(ghlOauthTokens)
    .values(insertValues)
    .onConflictDoUpdate({
      target: ghlOauthTokens.locationId,
      set: {
        companyId: insertValues.companyId,
        userId: insertValues.userId,
        accessToken: insertValues.accessToken,
        refreshToken: insertValues.refreshToken,
        expiresAt: insertValues.expiresAt,
        scope: insertValues.scope,
        tokenType: insertValues.tokenType,
        userType: insertValues.userType,
        locationName: insertValues.locationName,
        companyName: insertValues.companyName,
        isWhitelabelCompany: insertValues.isWhitelabelCompany,
        status: "active",
        revokedAt: null,
        revokedReason: null,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

/**
 * Soft-revoke a connection. The token row stays in place for audit; we just
 * stamp status, revoked_at, and revoked_reason. getValidAccessToken() will
 * refuse to refresh once status != 'active'.
 *
 * Called by:
 *   - AppUninstall webhook handler → reason='user_uninstalled'
 *   - Disconnect button on /admin/connections → reason='admin_disconnected'
 *   - getValidAccessToken on 4xx refresh response → reason='refresh_failed'
 */
export async function markTokenRevoked(
  locationId: string,
  reason: RevokedReason,
): Promise<void> {
  await db
    .update(ghlOauthTokens)
    .set({
      status: "revoked",
      revokedAt: new Date(),
      revokedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(ghlOauthTokens.locationId, locationId));
}

/**
 * Used when a refresh succeeds but the connection should be flagged as
 * needing user attention (rare). Currently unused — included for symmetry.
 */
export async function markTokenStatus(
  locationId: string,
  status: TokenStatus,
  reason?: string | null,
): Promise<void> {
  await db
    .update(ghlOauthTokens)
    .set({
      status,
      revokedReason: reason ?? null,
      revokedAt: status === "active" ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(ghlOauthTokens.locationId, locationId));
}

/**
 * List connections for a given Donor HQ location. Admins on
 * /admin/connections see only the row(s) that match their own user.locationId.
 * Returns active + revoked rows so the UI can show history.
 */
export async function listConnectionsForLocation(
  locationId: string,
): Promise<GhlOauthToken[]> {
  return db
    .select()
    .from(ghlOauthTokens)
    .where(eq(ghlOauthTokens.locationId, locationId));
}

/** Single connection by id — used by the disconnect endpoint. */
export async function getConnectionById(id: string): Promise<GhlOauthToken | null> {
  const rows = await db
    .select()
    .from(ghlOauthTokens)
    .where(eq(ghlOauthTokens.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Authorization check used by the connections page + disconnect endpoint.
 * A Donor HQ admin can only see/disconnect their OWN locationId's connections.
 */
export async function userCanManageConnection(
  userLocationId: string,
  connectionLocationId: string,
): Promise<boolean> {
  return userLocationId === connectionLocationId;
}

/**
 * Partial update used after a successful refresh. We intentionally only
 * touch the token-related columns so manual edits to other fields
 * (e.g. donor_hq_user_id) are preserved.
 */
export async function updateTokensAfterRefresh(
  locationId: string,
  patch: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scope?: string | null;
    tokenType?: string | null;
  },
): Promise<void> {
  await db
    .update(ghlOauthTokens)
    .set({
      accessToken: patch.accessToken,
      refreshToken: patch.refreshToken,
      expiresAt: patch.expiresAt,
      scope: patch.scope ?? undefined,
      tokenType: patch.tokenType ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(ghlOauthTokens.locationId, locationId));
}
