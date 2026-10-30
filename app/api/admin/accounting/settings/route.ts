/**
 * GET /api/admin/accounting/settings — current accounting settings (defaults if never saved).
 * PUT /api/admin/accounting/settings — save them. Admins only, scoped to the session's location.
 */
import { NextResponse } from "next/server";
import { emailAlertsAvailable } from "@/lib/accounting/alerts";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";
import { SettingsBody } from "@/lib/accounting/schemas";
import { getSettings, saveSettings } from "@/lib/accounting/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json({ settings: await getSettings(guard.session.user.locationId), emailAlertsAvailable: emailAlertsAvailable() });
  } catch (err) {
    return accountingErrorResponse("accounting-settings-get", err);
  }
}

export async function PUT(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const body = SettingsBody.parse(await req.json());
    await saveSettings(guard.session.user.locationId, guard.userId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return accountingErrorResponse("accounting-settings-put", err);
  }
}
