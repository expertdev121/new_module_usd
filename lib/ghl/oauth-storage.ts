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

/**
 * Look up a token row by its resource_id. Resource_id is locationId for a
 * sub-account install or companyId for an agency install.
 */
export async function getTokenRecordByResource(
  resourceId: string,
): Promise<GhlOauthToken | null> {
  const rows = await db
    .select()
    .from(ghlOauthTokens)
    .where(eq(ghlOauthTokens.resourceId, resourceId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Legacy lookup-by-locationId. Returns the Location-scoped row only.
 * Webhook handlers and `getValidAccessToken(locationId)` use this. If you
 * also want to find a Company row that covers this location, call
 * findCompanyTokenForLocation() below.
 */
export async function getTokenRecord(locationId: string): Promise<GhlOauthToken | null> {
  const rows = await db
    .select()
    .from(ghlOauthTokens)
    .where(eq(ghlOauthTokens.locationId, locationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Find an ACTIVE Company-scoped token row for the given companyId. Used by
 * the lazy location-token mint path: if no per-location row exists, we look
 * for an agency token that can be exchanged for one.
 */
export async function findActiveCompanyToken(
  companyId: string,
): Promise<GhlOauthToken | null> {
  const rows = await db
    .select()
    .from(ghlOauthTokens)
    .where(eq(ghlOauthTokens.companyId, companyId))
    .limit(50);
  return (
    rows.find(
      (r) => r.resourceType === "Company" && r.status === "active",
    ) ?? null
  );
}

/**
 * Insert or update a token row, keyed on `resource_id` (which is locationId
 * for sub-account installs OR companyId for agency installs). Mirrors the
 * official template's `installationObjects[resourceId]` dictionary.
 *
 * Re-installing on the same resource flips status back to 'active' and
 * clears any prior revocation. We never delete rows.
 */
export async function upsertTokenRecord(input: {
  resourceId: string;
  resourceType: "Location" | "Company";
  locationId: string | null;
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
}): Promise<{ row: GhlOauthToken; wasNew: boolean }> {
  const now = new Date();

  // Probe BEFORE the upsert so we can tell the caller whether this was a
  // brand-new install or a re-install of an existing (possibly active or
  // revoked) row. The success page uses this to show "Already connected —
  // tokens refreshed" instead of a generic success message.
  const existing = await getTokenRecordByResource(input.resourceId);

  const insertValues: NewGhlOauthToken = {
    resourceId: input.resourceId,
    resourceType: input.resourceType,
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
    status: "active",
    revokedAt: null,
    revokedReason: null,
    updatedAt: now,
  };

  const [row] = await db
    .insert(ghlOauthTokens)
    .values(insertValues)
    .onConflictDoUpdate({
      target: ghlOauthTokens.resourceId,
      set: {
        resourceType: insertValues.resourceType,
        locationId: insertValues.locationId,
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

  return { row, wasNew: !existing };
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
/**
 * Soft-revoke by resource_id (the canonical key). Use this whenever
 * AppUninstall fires or an admin clicks Disconnect.
 */
export async function markTokenRevokedByResource(
  resourceId: string,
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
    .where(eq(ghlOauthTokens.resourceId, resourceId));
}

/**
 * Legacy: revoke by locationId. Kept for the AppUninstall handler that
 * receives a webhook with `locationId` in the payload — under the hood,
 * resolves the row and revokes via resource_id. For Location rows
 * locationId == resourceId so this is equivalent to the resource-id call.
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
 * needing user attention. Targets by locationId for backward compatibility
 * with the getValidAccessToken refresh-failure path.
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
 * Same as markTokenStatus but keyed by resource_id (which also covers
 * Company-scoped rows whose location_id is NULL).
 */
export async function markTokenStatusByResource(
  resourceId: string,
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
    .where(eq(ghlOauthTokens.resourceId, resourceId));
}

/**
 * List connections for a given Donor HQ location. Returns Location-scoped
 * AND any matching Company-scoped rows (a company connection's
 * locationId is NULL but if any Donor HQ admin's user.locationId belongs
 * to that company, we want to show both).
 *
 * Implementation: returns Location rows where location_id == userLocationId
 * AND Company rows where companyId == (company of that location, if known
 * via the existing rows).
 */
export async function listConnectionsForLocation(
  locationId: string,
): Promise<GhlOauthToken[]> {
  // 1) Any per-location row for the admin's own sub-account.
  const direct = await db
    .select()
    .from(ghlOauthTokens)
    .where(eq(ghlOauthTokens.locationId, locationId));

  // 2) All Company-scoped rows. An agency-level install covers many
  //    sub-accounts including (potentially) this admin's — without an
  //    explicit user→company mapping we surface all of them so the admin
  //    can see the agency install that's keeping their sub-account synced.
  const companyRows = await db
    .select()
    .from(ghlOauthTokens)
    .where(eq(ghlOauthTokens.resourceType, "Company"));

  // Dedupe by id (in case a row matches both queries somehow).
  const seen = new Set<string>();
  const out: GhlOauthToken[] = [];
  for (const r of [...direct, ...companyRows]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * Used by super_admin views — returns ALL rows regardless of location.
 */
export async function listAllConnections(): Promise<GhlOauthToken[]> {
  return db.select().from(ghlOauthTokens);
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
