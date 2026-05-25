/**
 * POST /api/admin/offboard/[locationId]/restore
 *
 * Undoes a soft-delete. Admins regain login, OAuth token goes back to
 * active. No data was lost during soft-delete, so this fully restores
 * the location to its pre-offboard state.
 *
 * Super admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/offboard/auth-guard";
import { restoreLocation } from "@/lib/offboard/restore";

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
    const result = await restoreLocation(
      locationId,
      guard.session.user.email ?? "unknown",
    );
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[offboard.restore] failed for ${locationId}:`, message);
    return NextResponse.json(
      { error: "restore_failed", message },
      { status: 500 },
    );
  }
}
