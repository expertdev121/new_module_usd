/**
 * GET /api/admin/accounting/undeposited?source=check&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Completed USD gifts of one payment type that are not in any deposit yet
 * (on or after the accounting start date).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { isoDate } from "@/lib/accounting/dates";
import { listUndeposited } from "@/lib/accounting/deposits";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const date = isoDate("Dates");
const Query = z.object({
  source: z.string().min(1).max(32),
  from: date.nullish(),
  to: date.nullish(),
});

export async function GET(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const sp = new URL(req.url).searchParams;
    const q = Query.parse({ source: sp.get("source") ?? "check", from: sp.get("from") || null, to: sp.get("to") || null });
    return NextResponse.json(await listUndeposited(guard.session.user.locationId, q));
  } catch (err) {
    return accountingErrorResponse("accounting-undeposited-get", err);
  }
}
