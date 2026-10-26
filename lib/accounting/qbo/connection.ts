/**
 * Per-location QuickBooks connection: storage, encrypted tokens, and safe token refresh.
 * Refresh tokens rotate, so a refresh is stored with a compare-and-swap on the old token; if another
 * request refreshed first, we use theirs instead of overwriting it.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ledgerConnections, type LedgerConnection } from "@/lib/db/schema-accounting";
import { auditInsert } from "../audit";
import { QboAuthError, refreshTokens, revokeToken, type TokenSet } from "./client";
import { qboEnvironment, type QboEnvironment } from "./config";
import { decryptToken, encryptToken } from "./crypto";

const REFRESH_SKEW_MS = 2 * 60 * 1000;

export async function getConnection(locationId: string): Promise<LedgerConnection | null> {
  const [row] = await db.select().from(ledgerConnections).where(eq(ledgerConnections.locationId, locationId)).limit(1);
  return row ?? null;
}

/** What the browser is allowed to see: never tokens or the realm id. */
export function publicConnection(c: LedgerConnection | null) {
  if (!c || c.status === "disconnected") return null;
  return {
    status: c.status as "active" | "needs_reconnect",
    companyName: c.companyName,
    environment: c.environment,
    connectedAt: c.connectedAt.toISOString(),
    lastError: c.lastError,
    wrongEnvironment: c.environment !== qboEnvironment(),
  };
}

export async function saveConnection(params: {
  locationId: string;
  userId: number | null;
  realmId: string;
  companyName: string | null;
  tokens: TokenSet;
  environment: QboEnvironment;
}) {
  const values = {
    system: "quickbooks_online",
    environment: params.environment,
    realmId: params.realmId,
    companyName: params.companyName,
    accessTokenEnc: encryptToken(params.tokens.accessToken),
    refreshTokenEnc: encryptToken(params.tokens.refreshToken),
    accessExpiresAt: params.tokens.accessExpiresAt,
    refreshExpiresAt: params.tokens.refreshExpiresAt,
    status: "active",
    lastError: null,
    connectedAt: new Date(),
    connectedBy: params.userId,
    updatedAt: new Date(),
  };
  const [before] = await db.select({ realmId: ledgerConnections.realmId }).from(ledgerConnections).where(eq(ledgerConnections.locationId, params.locationId)).limit(1);
  await db.batch([
    db
      .insert(ledgerConnections)
      .values({ locationId: params.locationId, ...values })
      .onConflictDoUpdate({ target: ledgerConnections.locationId, set: values }),
    auditInsert({
      locationId: params.locationId,
      userId: params.userId,
      action: "qbo_connect",
      object: "ledger_connection",
      before: before ? { realmId: before.realmId } : null,
      after: { realmId: params.realmId, companyName: params.companyName, environment: params.environment },
    }),
  ]);
}

export async function markNeedsReconnect(locationId: string, reason: string) {
  await db
    .update(ledgerConnections)
    .set({ status: "needs_reconnect", lastError: reason.slice(0, 400), updatedAt: new Date() })
    .where(and(eq(ledgerConnections.locationId, locationId), eq(ledgerConnections.status, "active")));
}

/** Stops syncing and wipes the tokens. Mappings, deposits and history stay. */
export async function disconnect(locationId: string, userId: number | null) {
  const conn = await getConnection(locationId);
  if (!conn) return;
  if (conn.refreshTokenEnc) {
    try {
      await revokeToken(decryptToken(conn.refreshTokenEnc));
    } catch (err) {
      console.error("[qbo-disconnect] revoke failed (non-fatal):", err instanceof Error ? err.message : String(err));
    }
  }
  await db.batch([
    db
      .update(ledgerConnections)
      .set({ status: "disconnected", accessTokenEnc: null, refreshTokenEnc: null, accessExpiresAt: null, refreshExpiresAt: null, lastError: null, updatedAt: new Date() })
      .where(eq(ledgerConnections.locationId, locationId)),
    auditInsert({ locationId, userId, action: "qbo_disconnect", object: "ledger_connection", before: { companyName: conn.companyName } }),
  ]);
}

export interface AccessContext {
  accessToken: string;
  realmId: string;
  env: QboEnvironment;
}

/** A usable access token, refreshing it first when it is about to expire. Throws QboAuthError when reconnecting is needed. */
export async function getAccessContext(locationId: string): Promise<AccessContext> {
  let conn = await getConnection(locationId);
  if (!conn || conn.status === "disconnected" || !conn.refreshTokenEnc) throw new QboAuthError("QuickBooks is not connected.");
  if (conn.status === "needs_reconnect") throw new QboAuthError(conn.lastError ?? "QuickBooks needs to be reconnected.");
  if (conn.environment !== qboEnvironment()) {
    throw new QboAuthError(`This connection was made to QuickBooks ${conn.environment}, but the server is set to ${qboEnvironment()}. Reconnect QuickBooks.`);
  }

  const fresh = conn.accessTokenEnc && conn.accessExpiresAt && conn.accessExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS;
  if (!fresh) {
    const oldRefresh = conn.refreshTokenEnc;
    let tokens: TokenSet;
    try {
      tokens = await refreshTokens(decryptToken(oldRefresh));
    } catch (err) {
      if (err instanceof QboAuthError) await markNeedsReconnect(locationId, err.message);
      throw err;
    }
    const updated = await db
      .update(ledgerConnections)
      .set({
        accessTokenEnc: encryptToken(tokens.accessToken),
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        accessExpiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
        updatedAt: new Date(),
      })
      .where(and(eq(ledgerConnections.locationId, locationId), eq(ledgerConnections.refreshTokenEnc, oldRefresh)))
      .returning({ id: ledgerConnections.id });
    if (updated.length === 0) {
      // Someone else refreshed first. Use what they stored.
      conn = await getConnection(locationId);
      if (!conn?.accessTokenEnc) throw new QboAuthError("QuickBooks is not connected.");
    } else {
      return { accessToken: tokens.accessToken, realmId: conn.realmId, env: conn.environment as QboEnvironment };
    }
  }
  return { accessToken: decryptToken(conn.accessTokenEnc!), realmId: conn.realmId, env: conn.environment as QboEnvironment };
}
