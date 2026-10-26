/**
 * POST /api/admin/accounting/exports/preview — the rows that would be exported for these closed
 * deposits, plus problems (block the export) and warnings. Changes nothing.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { previewExport } from "@/lib/accounting/exports";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  depositIds: z.array(z.number().int().positive()).min(1, "Pick at least one deposit").max(200),
});

export async function POST(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const body = Body.parse(await req.json());
    return NextResponse.json(await previewExport(guard.session.user.locationId, body.depositIds));
  } catch (err) {
    return accountingErrorResponse("accounting-exports-preview", err);
  }
}
