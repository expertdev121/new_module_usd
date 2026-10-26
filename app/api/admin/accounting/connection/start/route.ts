/**
 * POST /api/admin/accounting/connection/start — returns the Intuit sign-in URL for this admin.
 * The OAuth state is signed and bound to this admin's location and user, and expires in 10 minutes.
 */
import { NextResponse } from "next/server";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";
import { buildAuthUrl } from "@/lib/accounting/qbo/client";
import { QboConfigError, isQboConfigured } from "@/lib/accounting/qbo/config";
import { createState } from "@/lib/accounting/qbo/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    if (!isQboConfigured()) {
      return NextResponse.json({ error: "not_configured", message: "QuickBooks is not set up on this server yet. Ask your administrator to add the QuickBooks app keys." }, { status: 503 });
    }
    const state = createState({ locationId: guard.session.user.locationId, userId: guard.userId });
    return NextResponse.json({ url: buildAuthUrl(state) });
  } catch (err) {
    if (err instanceof QboConfigError) return NextResponse.json({ error: "not_configured", message: err.message }, { status: 503 });
    return accountingErrorResponse("accounting-connection-start", err);
  }
}
