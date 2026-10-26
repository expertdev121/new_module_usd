/**
 * GET /api/admin/accounting/sources — payment sources with their deposit/fee accounts.
 * PUT /api/admin/accounting/sources — set the accounts for one source.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";
import { listSources, saveSource } from "@/lib/accounting/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.number().int().positive().nullable();
const Body = z.object({
  source: z.string().min(1).max(32),
  depositAccountId: id,
  feeAccountId: id,
});

export async function GET() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json({ sources: await listSources(guard.session.user.locationId) });
  } catch (err) {
    return accountingErrorResponse("accounting-sources-get", err);
  }
}

export async function PUT(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const { source, ...rest } = Body.parse(await req.json());
    await saveSource(guard.session.user.locationId, guard.userId, source, rest);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return accountingErrorResponse("accounting-sources-put", err);
  }
}
