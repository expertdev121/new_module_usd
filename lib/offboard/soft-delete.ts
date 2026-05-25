/**
 * Soft-delete a location.
 *
 * - Marks every admin user under this location with deleted_at = NOW().
 *   The authorize() callback in lib/auth.ts rejects login when this is
 *   non-null. No admin can log in until restored.
 * - Marks the GHL OAuth token row as revoked + data_soft_deleted_at = NOW()
 *   so webhook receivers stop processing inbound events AND the offboard
 *   UI can list it in the "Soft-deleted" section.
 *
 * Does NOT touch contact / pledge / payment / tag / etc. — the data
 * remains intact in the DB so it can be fully restored. With no
 * logged-in admin and no incoming webhooks, the data is effectively
 * invisible to everyone until either Restore or Hard Delete.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export interface SoftDeleteResult {
  locationId: string;
  usersDeactivated: number;
  oauthRowsRevoked: number;
  alreadySoftDeleted: boolean;
}

export async function softDeleteLocation(
  locationId: string,
  superAdminEmail: string,
): Promise<SoftDeleteResult> {
  if (!locationId) throw new Error("softDeleteLocation: locationId required");

  // Check if already soft-deleted so we can report idempotently.
  const existing = (await db.execute(sql`
    SELECT id FROM ghl_oauth_tokens
    WHERE (location_id = ${locationId} OR resource_id = ${locationId})
      AND data_soft_deleted_at IS NOT NULL
    LIMIT 1
  `)) as unknown;
  const existingRows = extractRows(existing);
  const alreadySoftDeleted = existingRows.length > 0;

  // 1. Block admin login for all users on this location.
  const userRes = await db.execute(sql`
    UPDATE "user"
       SET deleted_at = NOW(),
           updated_at = NOW()
     WHERE location_id = ${locationId}
       AND deleted_at IS NULL
    RETURNING id
  `);
  const usersDeactivated = extractRows(userRes).length;

  // 2. Revoke OAuth token + mark data_soft_deleted_at.
  const oauthRes = await db.execute(sql`
    UPDATE ghl_oauth_tokens
       SET status = 'revoked',
           revoked_at = COALESCE(revoked_at, NOW()),
           revoked_reason = 'admin_offboarded_soft',
           data_soft_deleted_at = NOW(),
           updated_at = NOW()
     WHERE (location_id = ${locationId} OR resource_id = ${locationId})
       AND data_soft_deleted_at IS NULL
    RETURNING id
  `);
  const oauthRowsRevoked = extractRows(oauthRes).length;

  // 3. Audit trail.
  try {
    const { logAudit } = await import("@/lib/audit");
    await logAudit("location_soft_delete", {
      locationId,
      usersDeactivated,
      oauthRowsRevoked,
      triggeredBy: superAdminEmail,
    });
  } catch (auditErr) {
    console.error(
      "[offboard] audit log failed (non-fatal):",
      auditErr instanceof Error ? auditErr.message : String(auditErr),
    );
  }

  return {
    locationId,
    usersDeactivated,
    oauthRowsRevoked,
    alreadySoftDeleted,
  };
}

/** Drizzle's db.execute returns shape varies by driver. Be defensive. */
function extractRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const r = result as { rows?: unknown[] };
    return r.rows ?? [];
  }
  return [];
}
