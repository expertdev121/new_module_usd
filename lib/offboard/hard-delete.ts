/**
 * Hard-delete every row belonging to a location, irreversibly.
 *
 * Walks OFFBOARD_TABLES in order (deepest children first) so FKs don't
 * trip. All DELETEs happen inside a single transaction — if any fail,
 * NOTHING is removed.
 *
 * Logs an audit_log entry BEFORE truncating audit_log for the location
 * so the super-admin action itself is captured outside the deleted scope.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { OFFBOARD_TABLES } from "./tables";

export interface HardDeleteResult {
  locationId: string;
  rowsDeleted: Record<string, number>;
  totalRowsDeleted: number;
}

export async function hardDeleteLocation(
  locationId: string,
  superAdminEmail: string,
): Promise<HardDeleteResult> {
  if (!locationId) throw new Error("hardDeleteLocation: locationId required");

  // STEP 1: capture row counts BEFORE the destructive transaction so the
  // audit entry can name what was about to vanish.
  const preCounts: Record<string, number> = {};
  for (const tbl of OFFBOARD_TABLES) {
    preCounts[tbl.name] = await countRows(tbl.name, tbl.scope, locationId);
  }
  const totalToDelete = Object.values(preCounts).reduce((a, b) => a + b, 0);

  // STEP 2: audit BEFORE the destructive op so we keep the record even
  // when audit_log itself is part of the delete.
  try {
    const { logAudit } = await import("@/lib/audit");
    await logAudit("location_hard_delete_started", {
      locationId,
      triggeredBy: superAdminEmail,
      preCounts,
      totalToDelete,
    });
  } catch (auditErr) {
    console.error(
      "[offboard] pre-delete audit failed (non-fatal):",
      auditErr instanceof Error ? auditErr.message : String(auditErr),
    );
  }

  // STEP 3: run the destructive transaction.
  const rowsDeleted: Record<string, number> = {};
  await db.transaction(async (tx) => {
    for (const tbl of OFFBOARD_TABLES) {
      const whereClause = buildWhereClause(tbl.scope, locationId);
      const query = `DELETE FROM "${tbl.name}" ${whereClause}`;
      const res = await tx.execute(sql.raw(query));
      const rows = extractRows(res);
      rowsDeleted[tbl.name] = rows.length;
    }
  });

  const totalDeleted = Object.values(rowsDeleted).reduce((a, b) => a + b, 0);

  // STEP 4: post-delete audit (also writes outside the dropped scope
  // since location_id no longer matches anything).
  try {
    const { logAudit } = await import("@/lib/audit");
    await logAudit("location_hard_delete_completed", {
      locationId,
      triggeredBy: superAdminEmail,
      rowsDeleted,
      totalDeleted,
    });
  } catch (auditErr) {
    console.error(
      "[offboard] post-delete audit failed (non-fatal):",
      auditErr instanceof Error ? auditErr.message : String(auditErr),
    );
  }

  return { locationId, rowsDeleted, totalRowsDeleted: totalDeleted };
}

/**
 * Count rows for a table in the location scope. Used for the pre-delete
 * audit so we know what we're about to nuke even if the transaction
 * runs to completion silently.
 */
async function countRows(
  tableName: string,
  scope: "location" | "contact_child" | "pledge_child" | "resource_id",
  locationId: string,
): Promise<number> {
  const whereClause = buildWhereClause(scope, locationId);
  const res = await db.execute(
    sql.raw(`SELECT COUNT(*)::int AS c FROM "${tableName}" ${whereClause}`),
  );
  const rows = extractRows(res) as { c: number }[];
  return rows[0]?.c ?? 0;
}

function buildWhereClause(
  scope: "location" | "contact_child" | "pledge_child" | "resource_id",
  locationId: string,
): string {
  const safe = escapeSqlLiteral(locationId);
  if (scope === "location") {
    return `WHERE location_id = '${safe}'`;
  }
  if (scope === "contact_child") {
    return `WHERE contact_id IN (SELECT id FROM contact WHERE location_id = '${safe}')`;
  }
  if (scope === "pledge_child") {
    return `WHERE pledge_id IN (SELECT id FROM pledge WHERE contact_id IN (SELECT id FROM contact WHERE location_id = '${safe}'))`;
  }
  // resource_id
  return `WHERE location_id = '${safe}' OR resource_id = '${safe}'`;
}

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

function extractRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const r = result as { rows?: unknown[] };
    return r.rows ?? [];
  }
  return [];
}
