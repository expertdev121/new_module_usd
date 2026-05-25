/**
 * GET /api/admin/backfill/status
 *
 * Returns recent backfill jobs for the current admin's location. The
 * connections page polls this every few seconds while a job is running to
 * drive the progress bar.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBackfillStatus } from "@/lib/ghl/backfill";
import { canSyncLocation } from "@/lib/ghl/connection-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.locationId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Probe whether this location can actually sync (has an active token,
  // either Location- or Company-scoped). The UI uses this to decide
  // between showing the Sync UI vs a "contact developer team" message.
  const connection = await canSyncLocation(session.user.locationId);

  const jobs = await getBackfillStatus(session.user.locationId);

  // Sanitize — no internal lease tokens leave the server.
  const safe = jobs.map((j) => ({
    id: j.id,
    status: j.status,
    kind: j.kind,
    triggeredBy: j.triggeredBy,
    page: j.page,
    pageSize: j.pageSize,
    processedCount: j.processedCount,
    upsertedCount: j.upsertedCount,
    failedCount: j.failedCount,
    totalEstimate: j.totalEstimate,
    lastError: j.lastError,
    attemptCount: j.attemptCount,
    nextRunAt: j.nextRunAt,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    completedAt: j.completedAt,
  }));

  return NextResponse.json({
    jobs: safe,
    connection: {
      canSync: connection.canSync,
      reason: connection.reason,
      message: connection.message,
    },
  });
}
