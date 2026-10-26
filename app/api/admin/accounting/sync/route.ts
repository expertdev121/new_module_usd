/**
 * GET  /api/admin/accounting/sync — recent sync runs with each deposit's outcome (the sync log).
 * POST /api/admin/accounting/sync — "Sync now": post every closed, unposted deposit to QuickBooks.
 *      { depositId } retries just that deposit. One sync runs at a time per organization.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";
import { listSyncRuns, runSync } from "@/lib/accounting/qbo/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ depositId: z.number().int().positive().optional() }).strict();

export async function GET() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json({ runs: await listSyncRuns(guard.session.user.locationId) });
  } catch (err) {
    return accountingErrorResponse("accounting-sync-get", err);
  }
}

export async function POST(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const body = Body.parse(await req.json().catch(() => ({})));
    const summary = await runSync({
      locationId: guard.session.user.locationId,
      trigger: body.depositId ? "retry" : "manual",
      userId: guard.userId,
      depositId: body.depositId,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return accountingErrorResponse("accounting-sync-post", err);
  }
}
