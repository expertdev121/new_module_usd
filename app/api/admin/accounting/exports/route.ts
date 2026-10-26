/**
 * GET  /api/admin/accounting/exports — export history (newest first).
 * POST /api/admin/accounting/exports — export closed deposits as a QuickBooks journal-entry CSV
 *      ({ depositIds }). Marks them exported and returns the file id to download.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { createExport, listExports } from "@/lib/accounting/exports";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  depositIds: z.array(z.number().int().positive()).min(1, "Pick at least one deposit").max(200),
});

export async function GET() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json({ exports: await listExports(guard.session.user.locationId) });
  } catch (err) {
    return accountingErrorResponse("accounting-exports-get", err);
  }
}

export async function POST(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const body = Body.parse(await req.json());
    const result = await createExport(guard.session.user.locationId, guard.userId, body.depositIds);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return accountingErrorResponse("accounting-exports-post", err);
  }
}
