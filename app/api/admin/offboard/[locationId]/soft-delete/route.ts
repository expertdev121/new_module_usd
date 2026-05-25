/**
 * POST /api/admin/offboard/[locationId]/soft-delete
 *
 * Soft-deletes a location: blocks admin logins + revokes the OAuth token.
 * Reversible via the /restore endpoint. Doesn't touch contacts, pledges,
 * payments, tags, etc.
 *
 * Super admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/offboard/auth-guard";
import { softDeleteLocation } from "@/lib/offboard/soft-delete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ locationId: string }> },
) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;

  const { locationId } = await params;
  if (!locationId) {
    return NextResponse.json({ error: "missing locationId" }, { status: 400 });
  }

  try {
    const result = await softDeleteLocation(
      locationId,
      guard.session.user.email ?? "unknown",
    );
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[offboard.soft-delete] failed for ${locationId}:`, message);
    return NextResponse.json(
      { error: "soft_delete_failed", message },
      { status: 500 },
    );
  }
}
