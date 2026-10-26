/**
 * GET /api/admin/accounting/exports/:id — download a previously generated CSV.
 * Downloading never changes any deposit's status.
 */
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { getExportFile } from "@/lib/accounting/exports";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const id = Number.parseInt((await params).id, 10);
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "invalid_input", message: "Invalid export id" }, { status: 400 });
    const file = await getExportFile(guard.session.user.locationId, id);
    return new Response(file.content, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return accountingErrorResponse("accounting-export-download", err);
  }
}
