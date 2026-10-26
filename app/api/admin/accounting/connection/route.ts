/**
 * GET    /api/admin/accounting/connection — QuickBooks connection status for this location, plus what
 *        needs attention (mappings pointing at inactive accounts, deposits waiting to post, last run).
 * DELETE /api/admin/accounting/connection — disconnect: revoke at QuickBooks and wipe the tokens.
 *        Mappings, deposits and history are kept.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";
import { sentDepositAlerts } from "@/lib/accounting/gift-drift";
import { rows } from "@/lib/accounting/sql-helpers";
import { isQboConfigured, qboEnvironment } from "@/lib/accounting/qbo/config";
import { disconnect, getConnection, publicConnection } from "@/lib/accounting/qbo/connection";
import { mappingsNeedingAttention } from "@/lib/accounting/qbo/lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const loc = guard.session.user.locationId;
    const conn = publicConnection(await getConnection(loc));
    const [pending] = await rows(sql`select count(*)::int as n from deposits where location_id = ${loc} and status = 'closed' and external_id is null`);
    const [last] = await rows(sql`select status, finished_at::text as finished_at, posted, failed, error from sync_runs where location_id = ${loc} and status <> 'running' order by id desc limit 1`);
    // Mapping problems, plus deposits already sent to accounting whose gifts changed afterwards.
    const attention = conn ? [...(await mappingsNeedingAttention(loc)), ...(await sentDepositAlerts(loc))] : [];
    return NextResponse.json({
      configured: isQboConfigured(),
      serverEnvironment: qboEnvironment(),
      connection: conn,
      pendingDeposits: Number(pending?.n ?? 0),
      attention,
      lastRun: last
        ? { status: String(last.status), finishedAt: (last.finished_at as string | null) ?? null, posted: Number(last.posted), failed: Number(last.failed), error: (last.error as string | null) ?? null }
        : null,
    });
  } catch (err) {
    return accountingErrorResponse("accounting-connection-get", err);
  }
}

export async function DELETE() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    await disconnect(guard.session.user.locationId, guard.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return accountingErrorResponse("accounting-connection-delete", err);
  }
}
