/**
 * POST /api/admin/offboard/[locationId]/hard-delete
 *
 * Permanently DELETES every row belonging to this location across:
 *   payment, manual_donation, pledge, contact_tags, student_roles,
 *   contact_roles, relationships, contact, tag, solicitor, category*,
 *   payment_methods, payment_method_details, campaign, organization_name,
 *   ghl_webhook_events, ghl_backfill_jobs, ghl_sync_writes, audit_log,
 *   user, ghl_oauth_tokens.
 *
 * Wrapped in a single transaction — all-or-nothing.
 *
 * Requires the caller to send `{ confirmName }` matching the location's
 * name in the body, so a misclick can't nuke a client's data.
 *
 * Super admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/offboard/auth-guard";
import { hardDeleteLocation } from "@/lib/offboard/hard-delete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ locationId: string }> },
) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;

  const { locationId } = await params;
  if (!locationId) {
    return NextResponse.json({ error: "missing locationId" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { confirmName?: string };
  const confirmName = (body.confirmName ?? "").trim();
  if (!confirmName) {
    return NextResponse.json(
      {
        error: "missing_confirm",
        message:
          "Include `confirmName` in the request body matching the location's name to proceed.",
      },
      { status: 400 },
    );
  }

  // Verify the typed name matches the actual location.
  const lookup = await db.execute(sql`
    SELECT
      COALESCE(t.location_name, on1.org_name, t.company_name) AS name
      FROM ghl_oauth_tokens t
      LEFT JOIN organization_name on1
        ON on1.location_id = COALESCE(t.location_id, t.resource_id)
     WHERE t.location_id = ${locationId} OR t.resource_id = ${locationId}
     LIMIT 1
  `);
  const rows = Array.isArray(lookup)
    ? lookup
    : ((lookup as { rows?: unknown[] }).rows ?? []);
  const actualName = (rows[0] as { name?: string } | undefined)?.name ?? null;

  if (!actualName) {
    return NextResponse.json(
      { error: "location_not_found" },
      { status: 404 },
    );
  }
  if (confirmName.toLowerCase() !== actualName.toLowerCase()) {
    return NextResponse.json(
      {
        error: "confirm_mismatch",
        message: `Typed name does not match. Expected: "${actualName}".`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await hardDeleteLocation(
      locationId,
      guard.session.user.email ?? "unknown",
    );
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[offboard.hard-delete] failed for ${locationId}:`, message);
    return NextResponse.json(
      { error: "hard_delete_failed", message },
      { status: 500 },
    );
  }
}
