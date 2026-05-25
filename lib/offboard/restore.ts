/**
 * Restore a soft-deleted location back to active.
 *
 * Inverse of softDeleteLocation:
 *   - Clears user.deleted_at so admins can log in again
 *   - Clears OAuth token revocation + data_soft_deleted_at marker
 *
 * Safe to call on a not-soft-deleted location — it's a no-op.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export interface RestoreResult {
  locationId: string;
  usersReactivated: number;
  oauthRowsRestored: number;
}

export async function restoreLocation(
  locationId: string,
  superAdminEmail: string,
): Promise<RestoreResult> {
  if (!locationId) throw new Error("restoreLocation: locationId required");

  const userRes = await db.execute(sql`
    UPDATE "user"
       SET deleted_at = NULL,
           updated_at = NOW()
     WHERE location_id = ${locationId}
       AND deleted_at IS NOT NULL
    RETURNING id
  `);
  const usersReactivated = extractRows(userRes).length;

  const oauthRes = await db.execute(sql`
    UPDATE ghl_oauth_tokens
       SET status = 'active',
           revoked_at = NULL,
           revoked_reason = NULL,
           data_soft_deleted_at = NULL,
           updated_at = NOW()
     WHERE (location_id = ${locationId} OR resource_id = ${locationId})
       AND data_soft_deleted_at IS NOT NULL
    RETURNING id
  `);
  const oauthRowsRestored = extractRows(oauthRes).length;

  try {
    const { logAudit } = await import("@/lib/audit");
    await logAudit("location_restore", {
      locationId,
      usersReactivated,
      oauthRowsRestored,
      triggeredBy: superAdminEmail,
    });
  } catch (auditErr) {
    console.error(
      "[offboard] audit log failed (non-fatal):",
      auditErr instanceof Error ? auditErr.message : String(auditErr),
    );
  }

  return { locationId, usersReactivated, oauthRowsRestored };
}

function extractRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const r = result as { rows?: unknown[] };
    return r.rows ?? [];
  }
  return [];
}
