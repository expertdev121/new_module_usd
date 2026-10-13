/**
 * GET    /api/admin/stripe-connect/connection — sanitized status for the UI.
 * DELETE /api/admin/stripe-connect/connection — disconnect: mark revoked.
 *
 * Soft-revoke: never DELETE the row. Status flips to 'revoked' so the
 * audit trail stays intact and reconnecting is one click.
 */
import { NextResponse } from "next/server";
import { requireStripeConnectAdmin } from "@/lib/stripe-connect/auth-guard";
import { getConnectionForLocation, markRevoked, sanitizeForClient } from "@/lib/stripe-connect/connection-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireStripeConnectAdmin();
  if (guard.error) return guard.error;

  const conn = await getConnectionForLocation(guard.session.user.locationId);
  if (!conn) {
    return NextResponse.json({ connection: null });
  }
  return NextResponse.json({ connection: sanitizeForClient(conn) });
}

export async function DELETE() {
  const guard = await requireStripeConnectAdmin();
  if (guard.error) return guard.error;
  const locationId = guard.session.user.locationId;

  const conn = await getConnectionForLocation(locationId);
  if (!conn) {
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }

  await markRevoked(locationId, "admin_disconnected");

  void (async () => {
    try {
      const { logAudit } = await import("@/lib/audit");
      await logAudit("stripe_connect_disconnect", {
        locationId,
        triggeredBy: guard.session.user.email ?? guard.session.user.id,
      });
    } catch (auditErr) {
      console.error("[stripe-connect-disconnect] audit failed (non-fatal):", auditErr instanceof Error ? auditErr.message : String(auditErr));
    }
  })();

  return NextResponse.json({ ok: true });
}
