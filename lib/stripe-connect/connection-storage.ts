/**
 * Database access for stripe_connections — one row per location.
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
  stripeConnections,
  type StripeConnection,
  type NewStripeConnection,
} from "@/lib/db/schema-stripe-connect";
import { decryptSecret, encryptSecret } from "./crypto";

export type StripeConnectionStatus = "active" | "needs_reconnect" | "revoked";

/**
 * Look up the single Stripe connection for a location, or null. The
 * UNIQUE on location_id means at most one row.
 */
export async function getConnectionForLocation(locationId: string): Promise<StripeConnection | null> {
  if (!locationId) return null;
  const [row] = await db
    .select()
    .from(stripeConnections)
    .where(eq(stripeConnections.locationId, locationId))
    .limit(1);
  return row ?? null;
}

/**
 * Insert or replace the connection row for a location. The encryption
 * happens here — callers pass plaintext, this layer encrypts.
 *
 * If a row already exists for the location we UPSERT — admin can
 * re-paste their keys without us creating an orphan.
 */
export async function upsertConnection(input: {
  locationId: string;
  publishableKey: string;
  secretKeyPlain: string;
  accountId?: string | null;
  accountName?: string | null;
  mode: "test" | "live";
  createdBy?: number | null;
}): Promise<StripeConnection> {
  const values: NewStripeConnection = {
    locationId: input.locationId,
    publishableKey: input.publishableKey,
    secretKeyEnc: encryptSecret(input.secretKeyPlain),
    accountId: input.accountId ?? null,
    accountName: input.accountName ?? null,
    mode: input.mode,
    status: "active",
    lastValidatedAt: new Date(),
    createdBy: input.createdBy ?? null,
  };

  const [row] = await db
    .insert(stripeConnections)
    .values(values)
    .onConflictDoUpdate({
      target: stripeConnections.locationId,
      set: {
        publishableKey: values.publishableKey,
        secretKeyEnc: values.secretKeyEnc,
        accountId: values.accountId,
        accountName: values.accountName,
        mode: values.mode,
        status: "active",
        revokedAt: null,
        revokedReason: null,
        webhookRegistrationError: null,
        lastValidatedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/** Soft-revoke. We never DELETE rows — audit trail matters. */
export async function markRevoked(locationId: string, reason: string): Promise<void> {
  await db
    .update(stripeConnections)
    .set({ status: "revoked", revokedAt: new Date(), revokedReason: reason, updatedAt: new Date() })
    .where(eq(stripeConnections.locationId, locationId));
}

export async function markNeedsReconnect(locationId: string, reason: string): Promise<void> {
  await db
    .update(stripeConnections)
    .set({ status: "needs_reconnect", revokedReason: reason, updatedAt: new Date() })
    .where(eq(stripeConnections.locationId, locationId));
}

/**
 * Decrypt the stored secret key for a given connection. Used immediately
 * before calling the Stripe API. Never store the return value.
 */
export function decryptSecretKey(conn: StripeConnection): string {
  return decryptSecret(conn.secretKeyEnc);
}

/** Decrypt the stored webhook signing secret, or null if none is registered yet. */
export function decryptWebhookSecret(conn: StripeConnection): string | null {
  if (!conn.webhookSecretEnc) return null;
  return decryptSecret(conn.webhookSecretEnc);
}

/** Look up a connection by locationId — used by the incoming webhook route (URL embeds locationId). */
export async function getConnectionByLocationId(locationId: string): Promise<StripeConnection | null> {
  return getConnectionForLocation(locationId);
}

/**
 * Persist a freshly-registered Stripe webhook_endpoint (id + signing secret)
 * against a connection. Called right after POST /v1/webhook_endpoints
 * succeeds — see lib/stripe-connect/webhook-registration.ts.
 */
export async function saveWebhookRegistration(
  locationId: string,
  endpointId: string,
  webhookSecretPlain: string,
): Promise<void> {
  await db
    .update(stripeConnections)
    .set({
      webhookEndpointId: endpointId,
      webhookSecretEnc: encryptSecret(webhookSecretPlain),
      webhookRegistrationError: null,
      updatedAt: new Date(),
    })
    .where(eq(stripeConnections.locationId, locationId));
}

/**
 * Record why the last webhook registration attempt failed or was skipped
 * (e.g. "app_url_not_https" or a Stripe API error message), so the admin UI
 * can surface it instead of silently looking fully connected.
 */
export async function markWebhookRegistrationFailed(locationId: string, reason: string): Promise<void> {
  await db
    .update(stripeConnections)
    .set({ webhookRegistrationError: reason, updatedAt: new Date() })
    .where(eq(stripeConnections.locationId, locationId));
}

/**
 * Strip the encrypted secret key before returning a connection over HTTP.
 * Always call this on outbound responses.
 */
export function sanitizeForClient(conn: StripeConnection): Record<string, unknown> {
  return {
    id: conn.id,
    locationId: conn.locationId,
    publishableKey: conn.publishableKey,
    accountId: conn.accountId,
    accountName: conn.accountName,
    mode: conn.mode,
    status: conn.status,
    lastValidatedAt: conn.lastValidatedAt,
    revokedAt: conn.revokedAt,
    revokedReason: conn.revokedReason,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
    // Display-only: a hint that *a* secret key is on file, without the value.
    secretKeyMask: "••••••••",
    webhookRegistered: conn.webhookEndpointId != null,
    webhookRegistrationError: conn.webhookRegistrationError,
  };
}
