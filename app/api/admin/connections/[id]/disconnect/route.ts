/**
 * POST /api/admin/connections/[id]/disconnect
 *
 * Soft-revokes a GHL connection. Admin-only, and only for connections that
 * belong to the admin's own locationId. Never deletes — the row stays in
 * place with status='revoked' and revoked_reason='admin_disconnected'.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getConnectionById,
  markTokenRevoked,
  userCanManageConnection,
} from "@/lib/ghl/oauth-storage";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.locationId) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sign in required" },
      { status: 401 },
    );
  }
  if (session.user.role !== "admin" && session.user.role !== "super_admin") {
    return NextResponse.json(
      { error: "forbidden", message: "Admins only" },
      { status: 403 },
    );
  }

  const { id } = await params;
  const connection = await getConnectionById(id);
  if (!connection) {
    return NextResponse.json(
      { error: "not_found", message: "Connection not found" },
      { status: 404 },
    );
  }

  if (
    !(await userCanManageConnection(session.user.locationId, connection.locationId))
  ) {
    return NextResponse.json(
      { error: "forbidden", message: "This connection belongs to a different location" },
      { status: 403 },
    );
  }

  if (connection.status === "revoked") {
    // Idempotent — already revoked. Return 200 so the UI can refresh.
    return NextResponse.json({ ok: true, alreadyRevoked: true });
  }

  await markTokenRevoked(connection.locationId, "admin_disconnected");

  try {
    await logAudit("ghl_disconnect", {
      entity: "ghl_oauth_tokens",
      entityId: undefined,
      locationId: connection.locationId,
      locationName: connection.locationName,
      companyName: connection.companyName,
    });
  } catch (err) {
    console.error(
      "[ghl-oauth] audit log failed for disconnect (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }

  return NextResponse.json({ ok: true });
}
