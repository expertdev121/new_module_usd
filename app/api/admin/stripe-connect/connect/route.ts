/**
 * POST /api/admin/stripe-connect/connect
 *
 * Final step of the admin's connect flow:
 *   1. Take their pasted publishable + secret key
 *   2. Validate the secret key (call GET /v1/account)
 *   3. Encrypt + persist to stripe_connections
 *   4. Register a per-tenant webhook endpoint (Phase 3) so fundraising
 *      Checkout donations get confirmed — non-fatal, skipped on non-https
 *      app URLs (local dev)
 *   5. Return sanitized status
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireStripeConnectAdmin } from "@/lib/stripe-connect/auth-guard";
import { modeFromSecretKey, validateStripeAccount } from "@/lib/stripe-connect/api-client";
import {
  getConnectionForLocation,
  markWebhookRegistrationFailed,
  sanitizeForClient,
  upsertConnection,
} from "@/lib/stripe-connect/connection-storage";
import { registerFundraisingWebhook } from "@/lib/stripe-connect/webhook-registration";
import { getCanonicalAppUrl } from "@/lib/config/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConnectBody {
  publishableKey?: string;
  secretKey?: string;
}

export async function POST(req: NextRequest) {
  const guard = await requireStripeConnectAdmin();
  if (guard.error) return guard.error;
  const locationId = guard.session.user.locationId;

  const body = (await req.json().catch(() => ({}))) as ConnectBody;
  const publishableKey = body.publishableKey?.trim();
  const secretKey = body.secretKey?.trim();

  if (!publishableKey || !secretKey) {
    return NextResponse.json(
      { error: "missing_fields", message: "Both publishableKey and secretKey are required." },
      { status: 400 },
    );
  }
  if (!publishableKey.startsWith("pk_")) {
    return NextResponse.json(
      { error: "invalid_publishable_key", message: "Publishable key must start with pk_." },
      { status: 400 },
    );
  }

  let mode: "test" | "live";
  try {
    mode = modeFromSecretKey(secretKey);
  } catch {
    return NextResponse.json(
      { error: "invalid_secret_key", message: "Secret key must start with sk_test_ or sk_live_." },
      { status: 400 },
    );
  }

  const publishableMode = publishableKey.startsWith("pk_test_") ? "test" : publishableKey.startsWith("pk_live_") ? "live" : null;
  if (publishableMode && publishableMode !== mode) {
    return NextResponse.json(
      { error: "mode_mismatch", message: "Publishable and secret keys must both be test or both be live." },
      { status: 400 },
    );
  }

  let accountId: string;
  let accountName: string | null;
  try {
    const account = await validateStripeAccount(secretKey);
    accountId = account.accountId;
    accountName = account.accountName;
  } catch (err) {
    return NextResponse.json(
      { error: "stripe_error", message: err instanceof Error ? err.message : "Stripe rejected this secret key." },
      { status: 401 },
    );
  }

  const conn = await upsertConnection({
    locationId,
    publishableKey,
    secretKeyPlain: secretKey,
    accountId,
    accountName,
    mode,
    createdBy: guard.session.user.id ? parseInt(String(guard.session.user.id), 10) || null : null,
  });

  void (async () => {
    try {
      const { logAudit } = await import("@/lib/audit");
      await logAudit("stripe_connect_connect", {
        entity: "stripe_connections",
        locationId,
        accountId,
        mode,
        triggeredBy: guard.session.user.email ?? guard.session.user.id,
      });
    } catch (auditErr) {
      console.error("[stripe-connect-connect] audit failed (non-fatal):", auditErr instanceof Error ? auditErr.message : String(auditErr));
    }
  })();

  let webhookRegistered = false;
  try {
    const appBaseUrl = getCanonicalAppUrl({ request: req });
    const result = await registerFundraisingWebhook(locationId, secretKey, appBaseUrl);
    webhookRegistered = result.registered;
    if (!result.registered) {
      await markWebhookRegistrationFailed(locationId, result.reason ?? "unknown");
    }
  } catch (webhookErr) {
    const message = webhookErr instanceof Error ? webhookErr.message : String(webhookErr);
    console.error("[stripe-connect-connect] webhook registration failed (non-fatal):", message);
    await markWebhookRegistrationFailed(locationId, message);
  }

  const finalConn = (await getConnectionForLocation(locationId)) ?? conn;
  return NextResponse.json({ success: true, connection: sanitizeForClient(finalConn), webhookRegistered });
}
