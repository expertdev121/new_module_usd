/**
 * GET  /api/admin/accounting/deposits?status=open|closed|exported|voided — deposits for this location.
 * POST /api/admin/accounting/deposits — create an open deposit from undeposited gifts
 *      ({ source, depositDate, bankReference?, giftIds }).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { isoDate } from "@/lib/accounting/dates";
import { createDeposit, listDeposits } from "@/lib/accounting/deposits";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateBody = z.object({
  source: z.string().min(1).max(32),
  depositDate: isoDate("Deposit date"),
  bankReference: z.string().trim().max(100).nullish(),
  giftIds: z.array(z.number().int().positive()).min(1, "Pick at least one gift").max(500),
});

export async function GET(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const status = new URL(req.url).searchParams.get("status");
    const ok = status && ["open", "closed", "exported", "voided"].includes(status) ? status : null;
    return NextResponse.json({ deposits: await listDeposits(guard.session.user.locationId, ok) });
  } catch (err) {
    return accountingErrorResponse("accounting-deposits-get", err);
  }
}

export async function POST(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const body = CreateBody.parse(await req.json());
    const result = await createDeposit(guard.session.user.locationId, guard.userId, body);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return accountingErrorResponse("accounting-deposits-post", err);
  }
}
