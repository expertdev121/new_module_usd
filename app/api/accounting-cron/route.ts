/**
 * GET /api/accounting-cron — nightly QuickBooks sync, called by the cron entry in vercel.json.
 *
 * Posts closed deposits for every organization that turned on nightly sync and has a live connection.
 * Outside the session middleware on purpose (cron has no user), so it authenticates itself:
 * Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Unlike the older backfill cron this FAILS CLOSED:
 * with no CRON_SECRET it refuses everything except local development.
 */
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runNightlySyncs } from "@/lib/accounting/qbo/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "development";
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const results = await runNightlySyncs(240_000);
    return NextResponse.json({ ok: true, organizations: results.length, results });
  } catch (err) {
    console.error("[accounting-cron] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
