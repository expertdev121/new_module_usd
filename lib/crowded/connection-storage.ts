/**
 * Database access for crowded_connections — one row per location.
 *
 * Always returns the encrypted bytes from disk. Decryption happens at the
 * boundary where we actually need the plaintext (i.e. immediately before
 * an API call), so plaintext never sits in scope longer than necessary.
 *
 * All returned shapes that leave the server (via API responses) are
 * sanitized via `sanitizeForClient` — never return the encrypted column.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  crowdedConnections,
  type CrowdedConnection,
  type NewCrowdedConnection,
} from "@/lib/db/schema-crowded";
import { decryptSecret, encryptSecret } from "./crypto";

export type CrowdedConnectionStatus = "active" | "needs_reconnect" | "revoked";

/**
 * Look up the single Crowded connection for a location, or null. The
 * partial UNIQUE on location_id means at most one row.
 */
export async function getConnectionForLocation(
  locationId: string,
): Promise<CrowdedConnection | null> {
  if (!locationId) return null;
  const [row] = await db
    .select()
    .from(crowdedConnections)
    .where(eq(crowdedConnections.locationId, locationId))
    .limit(1);
  return row ?? null;
}

/**
 * Look up by Crowded chapterId — used by the webhook receiver to
 * resolve `context.chapterId` back to a DonorHQ location.
 */
export async function getConnectionByChapterId(
  chapterId: string,
): Promise<CrowdedConnection | null> {
  if (!chapterId) return null;
  const [row] = await db
    .select()
    .from(crowdedConnections)
    .where(eq(crowdedConnections.chapterId, chapterId))
    .limit(1);
  return row ?? null;
}

/**
 * Insert or replace the connection row for a location. The encryption
 * happens here — callers pass plaintext, this layer encrypts.
 *
 * If a row already exists for the location we UPSERT — admin can
 * re-paste their token without us creating an orphan.
 */
export async function upsertConnection(input: {
  locationId: string;
  apiTokenPlain: string;
  webhookSecretPlain?: string | null;
  orgId?: string | null;
  chapterId: string;
  chapterName?: string | null;
  webhookRegistrationId?: string | null;
  createdBy?: number | null;
}): Promise<CrowdedConnection> {
  const values: NewCrowdedConnection = {
    locationId: input.locationId,
    apiTokenEnc: encryptSecret(input.apiTokenPlain),
    webhookSecretEnc: input.webhookSecretPlain
      ? encryptSecret(input.webhookSecretPlain)
      : null,
    orgId: input.orgId ?? null,
    chapterId: input.chapterId,
    chapterName: input.chapterName ?? null,
    webhookRegistrationId: input.webhookRegistrationId ?? null,
    status: "active",
    lastValidatedAt: new Date(),
    createdBy: input.createdBy ?? null,
  };

  const [row] = await db
    .insert(crowdedConnections)
    .values(values)
    .onConflictDoUpdate({
      target: crowdedConnections.locationId,
      set: {
        apiTokenEnc: values.apiTokenEnc,
        webhookSecretEnc: values.webhookSecretEnc,
        orgId: values.orgId,
        chapterId: values.chapterId,
        chapterName: values.chapterName,
        webhookRegistrationId: values.webhookRegistrationId,
        status: "active",
        revokedAt: null,
        revokedReason: null,
        lastValidatedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/**
 * Update the webhook registration AFTER creating the connection — used
 * when we register the webhook separately from the initial save.
 */
export async function setWebhookRegistration(
  locationId: string,
  webhookRegistrationId: string,
  webhookSecretPlain: string,
): Promise<void> {
  await db
    .update(crowdedConnections)
    .set({
      webhookRegistrationId,
      webhookSecretEnc: encryptSecret(webhookSecretPlain),
      updatedAt: new Date(),
    })
    .where(eq(crowdedConnections.locationId, locationId));
}

/**
 * Soft-revoke. We never DELETE rows — audit trail matters.
 */
export async function markRevoked(
  locationId: string,
  reason: string,
): Promise<void> {
  await db
    .update(crowdedConnections)
    .set({
      status: "revoked",
      revokedAt: new Date(),
      revokedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(crowdedConnections.locationId, locationId));
}

export async function markNeedsReconnect(locationId: string): Promise<void> {
  await db
    .update(crowdedConnections)
    .set({ status: "needs_reconnect", updatedAt: new Date() })
    .where(eq(crowdedConnections.locationId, locationId));
}

/**
 * Decrypt the stored API token for a given connection. Used immediately
 * before calling the Crowded API. Never store the return value.
 */
export function decryptApiToken(conn: CrowdedConnection): string {
  return decryptSecret(conn.apiTokenEnc);
}

export function decryptWebhookSecret(conn: CrowdedConnection): string | null {
  if (!conn.webhookSecretEnc) return null;
  return decryptSecret(conn.webhookSecretEnc);
}

/**
 * Strip the encrypted secrets before returning a connection over HTTP.
 * Always call this on outbound responses.
 */
export function sanitizeForClient(conn: CrowdedConnection): Record<string, unknown> {
  return {
    id: conn.id,
    locationId: conn.locationId,
    orgId: conn.orgId,
    chapterId: conn.chapterId,
    chapterName: conn.chapterName,
    webhookRegistrationId: conn.webhookRegistrationId,
    status: conn.status,
    lastValidatedAt: conn.lastValidatedAt,
    revokedAt: conn.revokedAt,
    revokedReason: conn.revokedReason,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    // Display-only: a hint that *a* token is on file, without the value.
    apiTokenMask: "••••••••",
    hasWebhookSecret: Boolean(conn.webhookSecretEnc),
  };
}
