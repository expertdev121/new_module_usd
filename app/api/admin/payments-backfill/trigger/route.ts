/**
 * POST /api/admin/payments-backfill/trigger
 *
 * Manually enqueue (or re-enqueue) the historical-payment backfill for
 * the current admin's location across all four GHL payment sources
 * (transactions, invoices, orders, subscriptions). Idempotent per kind —
 * if a job for a kind is already active, that one stays; missing kinds
 * get enqueued fresh.
 *
 * Returns a summary of what was created vs. reused. Like the contacts
 * trigger, an `?immediate=1` query param drains one inline chunk so the
 * admin sees instant progress.
 *
 * Auth: admin or super_admin only, scoped to session.user.locationId.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { enqueuePaymentsBackfill } from "@/lib/ghl/payments-backfill";
import { processNextChunk } from "@/lib/ghl/backfill";
import { getTokenRecord } from "@/lib/ghl/oauth-storage";
import { canSyncLocation } from "@/lib/ghl/connection-check";

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

  // Same gate as the contacts trigger — refuse if there's no working
  // GHL connection. Prevents queued jobs that would fail every chunk.
  const connection = await canSyncLocation(locationId);
  if (!connection.canSync) {
    return NextResponse.json(
      {
        error: "no_ghl_connection",
        reason: connection.reason,
        message: connection.message,
      },
      { status: 409 },
    );
  }

  const tokenRow = await getTokenRecord(locationId);

  // Policy for the historical-payment cutover:
  //   - Regular admin  → sinceDate = install date (tokenRow.createdAt).
  //     Only GHL payments dated on/after install flow into DHQ. Protects
  //     against duplicating pre-existing DHQ rows (CSV imports, old
  //     workflow syncs, CMN Stripe donations, etc.). ?fullHistory=1 has
  //     NO effect for a non-super-admin.
  //   - Super admin → same default; may pass ?fullHistory=1 to force a
  //     full historical pull (sinceDate = null).
  const wantsFullHistory = req.nextUrl.searchParams.get("fullHistory") === "1";
  const isSuperAdmin = session.user.role === "super_admin";
  const useFullHistory = wantsFullHistory && isSuperAdmin;
  const sinceDate = useFullHistory
    ? null
    : (tokenRow?.createdAt ? new Date(tokenRow.createdAt) : new Date());

  let result;
  try {
    result = await enqueuePaymentsBackfill({
      resourceId: tokenRow?.resourceId ?? locationId,
      locationId,
      companyId: tokenRow?.companyId ?? null,
      triggeredBy: "manual",
      sinceDate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "enqueue_failed", message },
      { status: 500 },
    );
  }

  // Optional inline drain — run one chunk so the user sees instant progress.
  const immediate = req.nextUrl.searchParams.get("immediate") === "1";
  let firstChunk: Awaited<ReturnType<typeof processNextChunk>> | null = null;
  if (immediate) {
    try {
      firstChunk = await processNextChunk();
    } catch (err) {
      console.error(
        "[payments-backfill-trigger] inline first chunk failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Audit.
  void (async () => {
    try {
      const { logAudit } = await import("@/lib/audit");
      await logAudit("ghl_payments_backfill_trigger", {
        entity: "ghl_backfill_jobs",
        locationId,
        triggeredBy: session.user.email ?? session.user.id ?? "unknown",
        created: result.created,
        skipped: result.skipped,
        sinceDate: sinceDate ? sinceDate.toISOString() : null,
        fullHistory: useFullHistory,
        role: session.user.role,
      });
    } catch (auditErr) {
      console.error(
        "[payments-backfill-trigger] audit failed (non-fatal):",
        auditErr instanceof Error ? auditErr.message : String(auditErr),
      );
    }
  })();

  return NextResponse.json({
    created: result.created,
    skipped: result.skipped,
    mode: useFullHistory ? "full_history" : "install_cutover",
    sinceDate: sinceDate ? sinceDate.toISOString() : null,
    jobs: result.jobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      processedCount: j.processedCount,
      upsertedCount: j.upsertedCount,
      totalEstimate: j.totalEstimate,
    })),
    firstChunk,
  });
}
