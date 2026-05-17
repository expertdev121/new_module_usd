/**
 * GET /api/admin/connections
 *
 * Lists GHL connections (active + revoked) for the current admin's location.
 * Admins only see their OWN locationId's connections — this is the
 * identity-binding-by-location pattern (option (a) in the production task).
 *
 * Response is sanitized — NO access_token or refresh_token leaves the server.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listConnectionsForLocation } from "@/lib/ghl/oauth-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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

  const rows = await listConnectionsForLocation(session.user.locationId);

  // Strip token columns before returning to the client.
  const safe = rows.map((r) => ({
    id: r.id,
    locationId: r.locationId,
    locationName: r.locationName,
    companyId: r.companyId,
    companyName: r.companyName,
    scope: r.scope,
    status: r.status,
    revokedAt: r.revokedAt,
    revokedReason: r.revokedReason,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return NextResponse.json({ connections: safe });
}
