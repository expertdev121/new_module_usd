/**
 * GET /api/admin/backfill/cron
 *
 * Vercel cron worker for the historical-contact backfill. Triggered by the
 * cron entry in vercel.json (every minute on Pro plan). Drains the queue:
 * keeps calling processNextChunk() until either:
 *   - the queue returns "no_jobs" (caught up)
 *   - we burn through our wall-clock budget (240s on Pro — leaves headroom
 *     under the 300s function limit for the final response to flush)
 *
 * AUTH:
 *   Vercel injects an `Authorization: Bearer ${CRON_SECRET}` header on every
 *   cron invocation. We verify it. We also accept the same secret as a query
 *   param so an admin can manually pulse this endpoint from a browser.
 *
 *   In dev (no CRON_SECRET set), auth is disabled.
 */
import { NextResponse, type NextRequest } from "next/server";
import { processNextChunk } from "@/lib/ghl/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pro plan: 300s function limit. We cap ourselves at 300 here too — the
// in-route wall-clock budget below makes us return early so the tail of
// the response always has time to flush.
export const maxDuration = 300;

// 240s = 4 min of work per tick, leaves 60s for the response. With cron
// firing every 60s, the queue stays drained even under heavy backfill
// load (multiple sub-accounts catching up at once).
const WALL_CLOCK_BUDGET_MS = 240_000;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — skip auth in dev / preview environments. In
    // production we ALWAYS want CRON_SECRET set (Vercel auto-populates it).
    return true;
  }
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const qs = req.nextUrl.searchParams.get("secret");
  if (qs && qs === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const summary = {
    chunks_processed: 0,
    chunks_completed: 0,
    chunks_failed: 0,
    contacts_processed: 0,
    contacts_upserted: 0,
    elapsed_ms: 0,
    drained: false,
  };

  while (Date.now() - start < WALL_CLOCK_BUDGET_MS) {
    let result;
    try {
      result = await processNextChunk();
    } catch (err) {
      // processNextChunk should catch its own errors and reschedule — but
      // belt-and-braces, log + break out so a totally broken state doesn't
      // peg the cron invocation.
      console.error(
        "[backfill-cron] processNextChunk threw (unexpected):",
        err instanceof Error ? err.message : String(err),
      );
      break;
    }

    if (result.status === "no_jobs") {
      summary.drained = true;
      break;
    }

    summary.chunks_processed++;
    if (result.status === "completed") summary.chunks_completed++;
    if (result.status === "failed") summary.chunks_failed++;
    summary.contacts_processed += result.processed ?? 0;
    summary.contacts_upserted += result.upserted ?? 0;
  }

  summary.elapsed_ms = Date.now() - start;
  return NextResponse.json(summary, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
