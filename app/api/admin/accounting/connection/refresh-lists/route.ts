/**
 * POST /api/admin/accounting/connection/refresh-lists — pull the chart of accounts and classes from
 * QuickBooks ("Refresh from QuickBooks"). Reads accounts and classes only, never transactions.
 */
import { NextResponse } from "next/server";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";
import { QboApiError, QboAuthError } from "@/lib/accounting/qbo/client";
import { markNeedsReconnect } from "@/lib/accounting/qbo/connection";
import { refreshFromQuickBooks } from "@/lib/accounting/qbo/lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  const loc = guard.session.user.locationId;
  try {
    return NextResponse.json({ ok: true, ...(await refreshFromQuickBooks(loc, guard.userId)) });
  } catch (err) {
    if (err instanceof QboAuthError) {
      await markNeedsReconnect(loc, err.message);
      return NextResponse.json({ error: "needs_reconnect", message: err.message }, { status: 409 });
    }
    if (err instanceof QboApiError) return NextResponse.json({ error: "quickbooks_error", message: err.message }, { status: 502 });
    return accountingErrorResponse("accounting-refresh-lists", err);
  }
}
