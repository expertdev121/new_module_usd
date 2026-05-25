/**
 * GET /api/admin/offboard/list
 *
 * Returns every GHL connection (active + soft-deleted) with summary
 * counts so the offboarding UI can render the table.
 *
 * Super admin only.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/offboard/auth-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;

  // One row per location (joining location-based or resource_id-based
  // OAuth records). We use raw SQL so we can count contacts/pledges/etc.
  // in one trip without 10 round-trips.
  const result = await db.execute(sql`
    WITH locations AS (
      SELECT
        COALESCE(t.location_id, t.resource_id) AS location_id,
        t.location_name,
        t.company_name,
        t.company_id,
        t.resource_type,
        t.status              AS oauth_status,
        t.data_soft_deleted_at,
        t.created_at          AS connected_at,
        t.revoked_at,
        t.revoked_reason,
        on1.org_name          AS organization_name
      FROM ghl_oauth_tokens t
      LEFT JOIN organization_name on1
        ON on1.location_id = COALESCE(t.location_id, t.resource_id)
      WHERE COALESCE(t.location_id, t.resource_id) IS NOT NULL
    )
    SELECT
      l.location_id,
      l.location_name,
      l.organization_name,
      l.company_name,
      l.company_id,
      l.resource_type,
      l.oauth_status,
      l.data_soft_deleted_at,
      l.connected_at,
      l.revoked_at,
      l.revoked_reason,
      (SELECT COUNT(*)::int FROM contact WHERE location_id = l.location_id)         AS contact_count,
      (SELECT COUNT(*)::int FROM pledge WHERE contact_id IN
        (SELECT id FROM contact WHERE location_id = l.location_id))                 AS pledge_count,
      (SELECT COUNT(*)::int FROM payment WHERE pledge_id IN
        (SELECT id FROM pledge WHERE contact_id IN
          (SELECT id FROM contact WHERE location_id = l.location_id)))              AS payment_count,
      (SELECT COUNT(*)::int FROM manual_donation WHERE contact_id IN
        (SELECT id FROM contact WHERE location_id = l.location_id))                 AS manual_donation_count,
      (SELECT COUNT(*)::int FROM tag WHERE location_id = l.location_id)             AS tag_count,
      (SELECT COUNT(*)::int FROM "user" WHERE location_id = l.location_id)          AS admin_user_count
    FROM locations l
    ORDER BY l.data_soft_deleted_at NULLS LAST, l.connected_at DESC
  `);

  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);

  return NextResponse.json({ locations: rows });
}
