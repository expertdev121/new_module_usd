/**
 * GET /api/ghl-token-refresh-cron — daily GHL OAuth token refresh, called by the cron entry in vercel.json.
 *
 * Rotates every active ghl_oauth_tokens row so access tokens never lapse between uses.
 * Outside the session middleware on purpose (cron has no user), so it authenticates itself:
 * Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Fails closed like /api/accounting-cron.
 */
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { refreshAllGhlTokens } from "@/lib/ghl/refresh-all";

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
    const results = await refreshAllGhlTokens();
    const count = (o: string) => results.filter((r) => r.outcome === o).length;
    const summary = {
      total: results.length,
      refreshed: count("refreshed"),
      reminted: count("reminted"),
      needs_reinstall: count("needs_reinstall"),
      transient_error: count("transient_error"),
    };
    console.log("[ghl-token-refresh-cron]", JSON.stringify(summary));
    return NextResponse.json({
      ok: true,
      ...summary,
      failures: results.filter((r) => r.outcome === "needs_reinstall" || r.outcome === "transient_error"),
    });
  } catch (err) {
    console.error("[ghl-token-refresh-cron] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
