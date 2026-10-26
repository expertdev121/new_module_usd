/**
 * GET /api/admin/accounting/settings — current accounting settings (defaults if never saved).
 * PUT /api/admin/accounting/settings — save them. Admins only, scoped to the session's location.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { isoDate } from "@/lib/accounting/dates";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";
import { getSettings, saveSettings } from "@/lib/accounting/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  system: z.enum(["quickbooks_online", "generic_csv"]),
  basis: z.enum(["cash", "accrual"]),
  startDate: isoDate("Start date").nullable(),
  unmappedAccountId: z.number().int().positive().nullable(),
  entryType: z.enum(["deposit", "journal_entry"]),
  autoSyncEnabled: z.boolean(),
});

export async function GET() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json({ settings: await getSettings(guard.session.user.locationId) });
  } catch (err) {
    return accountingErrorResponse("accounting-settings-get", err);
  }
}

export async function PUT(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const body = Body.parse(await req.json());
    await saveSettings(guard.session.user.locationId, guard.userId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return accountingErrorResponse("accounting-settings-put", err);
  }
}
