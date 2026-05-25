/**
 * GET /api/admin/offboard/[locationId]/export
 *
 * Streams back a ZIP of CSV exports for every location-scoped table.
 * Recommended BEFORE either soft-delete or hard-delete so the super
 * admin has a snapshot in hand.
 *
 * Super admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/offboard/auth-guard";
import { buildOffboardZip } from "@/lib/offboard/export-zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ locationId: string }> },
) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;

  const { locationId } = await params;
  if (!locationId) {
    return NextResponse.json({ error: "missing locationId" }, { status: 400 });
  }

  // Look up location name for the filename. Best-effort.
  let locationName: string | null = null;
  try {
    const res = await db.execute(sql`
      SELECT COALESCE(t.location_name, on1.org_name) AS name
        FROM ghl_oauth_tokens t
        LEFT JOIN organization_name on1
          ON on1.location_id = COALESCE(t.location_id, t.resource_id)
       WHERE t.location_id = ${locationId} OR t.resource_id = ${locationId}
       LIMIT 1
    `);
    const rows = Array.isArray(res)
      ? res
      : ((res as { rows?: unknown[] }).rows ?? []);
    locationName = (rows[0] as { name?: string } | undefined)?.name ?? null;
  } catch {
    /* non-fatal */
  }

  try {
    const { zip, filename, tableCounts, totalRows } = await buildOffboardZip(
      locationId,
      { locationName },
    );

    try {
      const { logAudit } = await import("@/lib/audit");
      await logAudit("location_data_export", {
        locationId,
        triggeredBy: guard.session.user.email,
        tableCounts,
        totalRows,
        sizeBytes: zip.length,
      });
    } catch (auditErr) {
      console.error(
        "[offboard] audit log failed (non-fatal):",
        auditErr instanceof Error ? auditErr.message : String(auditErr),
      );
    }

    // Convert Buffer → Uint8Array for the Response body (Next/Web fetch
    // wants a stream/blob-compatible body; Buffer is fine but the typings
    // are cleaner this way).
    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(zip.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[offboard.export] failed for ${locationId}:`, message);
    return NextResponse.json(
      { error: "export_failed", message },
      { status: 500 },
    );
  }
}
