/**
 * POST /api/admin/backfill/cancel
 *
 * Marks every queued/running ghl_backfill_jobs row for the current
 * admin's location as cancelled. Powers the "Cancel sync" button on
 * /admin/connections — useful when:
 *   - A sync was kicked off by mistake
 *   - The cron worker isn't running (e.g. local dev) and jobs are
 *     stuck in 'queued' forever
 *   - A job is failing repeatedly and the admin wants to stop it
 *     instead of waiting for the 8-attempt backoff to give up
 *
 * Optional body parameters:
 *   { kinds: ["contacts" | "payments_*" | "push_*" | ...] }
 *     If present, only cancel jobs matching one of these kinds. If
 *     absent, cancel everything active for the location.
 *
 * Auth: admin or super_admin only, scoped to session.user.locationId.
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql, and, eq, inArray } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { db } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { ghlBackfillJobs } from "@/lib/db/schema-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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

  const locationId = session.user.locationId;

  // Optional kind filter from the body.
  const body = (await req.json().catch(() => ({}))) as { kinds?: string[] };
  const kinds =
    Array.isArray(body.kinds) && body.kinds.length > 0
      ? body.kinds
      : null;

  // Build the WHERE: always scope to this location + status active. If
  // kinds supplied, add the IN clause.
  const whereCondition = kinds
    ? and(
        eq(ghlBackfillJobs.locationId, locationId),
        inArray(ghlBackfillJobs.status, ["queued", "running"]),
        inArray(ghlBackfillJobs.kind, kinds),
      )
    : and(
        eq(ghlBackfillJobs.locationId, locationId),
        inArray(ghlBackfillJobs.status, ["queued", "running"]),
      );

  const cancelled = await db
    .update(ghlBackfillJobs)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      lastError: `Cancelled by ${session.user.email ?? session.user.id ?? "admin"}`,
      // Drop any active lease so a racing worker can't claim it back.
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(whereCondition)
    .returning({
      id: ghlBackfillJobs.id,
      kind: ghlBackfillJobs.kind,
    });

  // Best-effort audit.
  void (async () => {
    try {
      const { logAudit } = await import("@/lib/audit");
      await logAudit("ghl_backfill_cancel", {
        locationId,
        kinds: kinds ?? "all",
        cancelledCount: cancelled.length,
        cancelledJobs: cancelled,
        triggeredBy: session.user.email ?? session.user.id ?? "unknown",
      });
    } catch (auditErr) {
      console.error(
        "[backfill-cancel] audit failed (non-fatal):",
        auditErr instanceof Error ? auditErr.message : String(auditErr),
      );
    }
  })();

  return NextResponse.json({
    cancelledCount: cancelled.length,
    cancelledJobs: cancelled,
  });

  // Keep sql in the import graph for future raw-SQL needs in this route.
  void sql;
}
