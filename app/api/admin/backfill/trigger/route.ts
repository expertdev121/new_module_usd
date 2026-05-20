/**
 * POST /api/admin/backfill/trigger
 *
 * Manually enqueue (or re-enqueue) a historical-contact backfill for the
 * current admin's location. Used by the "Sync historical contacts" button
 * on the connections page.
 *
 * Idempotent — if an active job already exists for this location, returns
 * 200 with `{ created: false, job }` so the UI can show progress on an
 * already-running backfill. To force a fresh re-sync after a previous job
 * completed/failed, the admin can use this same endpoint; we'll spawn a
 * new job because the unique constraint only catches active rows.
 *
 * Optionally drains the queue inline (synchronous) so the very first chunk
 * runs immediately and the user sees instant progress — the cron then takes
 * over for subsequent chunks. Pass `?immediate=1` to opt in.
 *
 * AUTH: admin or super_admin only, scoped by session.user.locationId.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enqueueContactBackfill, processNextChunk } from "@/lib/ghl/backfill";
import { getTokenRecord } from "@/lib/ghl/oauth-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  // Confirm GHL is actually installed for this location. We accept either
  // a per-location token row OR a Company-scoped row that can lazy-mint —
  // matching the webhook receiver's policy.
  const tokenRow = await getTokenRecord(locationId);
  // Don't gate hard on tokenRow being null — the lazy-mint path in
  // backfill.ts will iterate Company tokens. But surface a hint in the
  // response so the UI can show a sensible message if the install really
  // is missing.

  let result;
  try {
    result = await enqueueContactBackfill({
      resourceId: tokenRow?.resourceId ?? locationId,
      resourceType: (tokenRow?.resourceType as "Location" | "Company") ?? "Location",
      locationId,
      companyId: tokenRow?.companyId ?? null,
      triggeredBy: "manual",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "enqueue_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // Optional inline first-chunk drain — gives the user immediate feedback
  // instead of "queued, check back in 60s".
  const immediate = req.nextUrl.searchParams.get("immediate") === "1";
  let firstChunk: Awaited<ReturnType<typeof processNextChunk>> | null = null;
  if (immediate) {
    try {
      firstChunk = await processNextChunk();
    } catch (err) {
      console.error(
        "[backfill-trigger] inline first chunk failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Audit — best-effort.
  void (async () => {
    try {
      const { logAudit } = await import("@/lib/audit");
      await logAudit("ghl_backfill_trigger", {
        entity: "ghl_backfill_jobs",
        jobId: result.job.id,
        locationId,
        triggeredBy: session.user.email ?? session.user.id ?? "unknown",
        created: result.created,
      });
    } catch (auditErr) {
      console.error(
        "[backfill-trigger] audit log failed (non-fatal):",
        auditErr instanceof Error ? auditErr.message : String(auditErr),
      );
    }
  })();

  return NextResponse.json({
    created: result.created,
    job: {
      id: result.job.id,
      status: result.job.status,
      page: result.job.page,
      processedCount: result.job.processedCount,
      upsertedCount: result.job.upsertedCount,
      totalEstimate: result.job.totalEstimate,
    },
    firstChunk,
  });
}
