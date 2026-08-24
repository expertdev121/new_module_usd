/**
 * DELETE /api/admin/api-keys/:id — revoke a key.
 *
 * Soft-revoke (sets revoked_at) rather than a hard delete, so the audit
 * trail of who used the key and when survives. A revoked key stops
 * authenticating immediately. Scoped to the caller's account so one tenant
 * can never revoke another's key.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiKey } from "@/lib/db/schema-api";
import { and, eq, isNull } from "drizzle-orm";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = session.user.role;
  const locationId = session.user.locationId;
  if (role !== "admin" && role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!locationId) {
    return NextResponse.json({ error: "No account on session" }, { status: 400 });
  }

  const { id } = await params;

  const [revoked] = await db
    .update(apiKey)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(apiKey.id, id),
        eq(apiKey.locationId, locationId),
        isNull(apiKey.revokedAt),
      ),
    )
    .returning({ id: apiKey.id });

  if (!revoked) {
    return NextResponse.json(
      { error: "Key not found or already revoked." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, id: revoked.id });
}
