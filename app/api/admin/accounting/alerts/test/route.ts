/**
 * POST /api/admin/accounting/alerts/test — sends a sample alert to the SAVED GoHighLevel webhook so the
 * workflow can be built and checked. Admins only. It never takes a URL from the request.
 */
import { NextResponse } from "next/server";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { sendTestAlert } from "@/lib/accounting/alerts";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const result = await sendTestAlert(guard.session.user.locationId);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return accountingErrorResponse("accounting-alert-test", err);
  }
}
