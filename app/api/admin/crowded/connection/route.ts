/**
 * GET    /api/admin/crowded/connection — sanitized status for the UI.
 * DELETE /api/admin/crowded/connection — disconnect: mark revoked + best-effort
 *                                        DELETE the registered webhook on Crowded.
 *
 * Soft-revoke: never DELETE the row. Status flips to 'revoked' so the
 * audit trail stays intact and reconnecting is one click.
 */
import { NextResponse } from "next/server";
import { requireCrowdedAdmin } from "@/lib/crowded/auth-guard";
import {
  decryptApiToken,
  getConnectionForLocation,
  markRevoked,
  sanitizeForClient,
} from "@/lib/crowded/connection-storage";
import { CrowdedApiError, deleteWebhook } from "@/lib/crowded/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;

  const conn = await getConnectionForLocation(guard.session.user.locationId);
  if (!conn) {
    return NextResponse.json({ connection: null });
  }
  return NextResponse.json({ connection: sanitizeForClient(conn) });
}

export async function DELETE() {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;
  const locationId = guard.session.user.locationId;

  const conn = await getConnectionForLocation(locationId);
  if (!conn) {
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }

  // Best-effort: deregister the webhook so Crowded stops sending events.
  // If the call fails (token already invalid, network), we still mark the
  // local row revoked — webhook events for an unknown chapter get
  // skipped at the dispatcher anyway.
  let webhookError: string | null = null;
  if (conn.webhookRegistrationId) {
    try {
      const apiToken = decryptApiToken(conn);
      await deleteWebhook(apiToken, conn.webhookRegistrationId);
    } catch (err) {
      webhookError =
        err instanceof CrowdedApiError
          ? `Webhook deregister failed (HTTP ${err.status}).`
          : `Webhook deregister failed: ${err instanceof Error ? err.message : String(err)}.`;
      console.error(
        `[crowded] webhook deregister failed for location ${locationId}: ${webhookError}`,
      );
    }
  }

  await markRevoked(locationId, "admin_disconnected");

  void (async () => {
    try {
      const { logAudit } = await import("@/lib/audit");
      await logAudit("crowded_disconnect", {
        locationId,
        webhookError,
        triggeredBy: guard.session.user.email ?? guard.session.user.id,
      });
    } catch (auditErr) {
      console.error(
        "[crowded-disconnect] audit failed (non-fatal):",
        auditErr instanceof Error ? auditErr.message : String(auditErr),
      );
    }
  })();

  return NextResponse.json({ ok: true, webhookError });
}
