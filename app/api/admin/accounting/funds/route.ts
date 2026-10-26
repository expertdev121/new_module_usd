/**
 * GET /api/admin/accounting/funds — campaigns (= funds) with their account/class mapping
 *     and how many completed gifts each had in the last 90 days.
 * PUT /api/admin/accounting/funds — map one campaign.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";
import { listFunds, saveFund } from "@/lib/accounting/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.number().int().positive().nullable();
const Body = z.object({
  campaignId: z.number().int().positive(),
  incomeAccountId: id,
  dimensionId: id,
  arAccountId: id,
});

export async function GET() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json({ funds: await listFunds(guard.session.user.locationId) });
  } catch (err) {
    return accountingErrorResponse("accounting-funds-get", err);
  }
}

export async function PUT(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const { campaignId, ...rest } = Body.parse(await req.json());
    await saveFund(guard.session.user.locationId, guard.userId, campaignId, rest);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return accountingErrorResponse("accounting-funds-put", err);
  }
}
