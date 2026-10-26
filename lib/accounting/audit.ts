/**
 * accounting_audit helpers. The audit row must commit or fail TOGETHER with the change it records
 * (the Neon HTTP driver has no interactive transactions, so this is done inside one statement/batch):
 *
 *  - auditInsert(entry)    a Drizzle insert for db.batch([change, auditInsert(entry)])  (one HTTP transaction)
 *  - auditCte(name, entry) a data-modifying CTE for a raw `with ... select` statement
 *  - writeAuditSafe(entry) best effort, never throws: for summary rows (CSV import, list refresh, sync run)
 *                          where there is no single statement to attach to
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountingAudit } from "@/lib/db/schema-accounting";

export interface AuditEntry {
  locationId: string;
  userId: number | null;
  action: string;
  object: string;
  objectId?: string | number | null;
  before?: unknown;
  after?: unknown;
}

const json = (v: unknown) => (v == null ? null : JSON.stringify(v));

export function auditInsert(e: AuditEntry) {
  return db.insert(accountingAudit).values({
    locationId: e.locationId,
    userId: e.userId,
    action: e.action,
    object: e.object,
    objectId: e.objectId != null ? String(e.objectId) : null,
    before: (e.before ?? null) as never,
    after: (e.after ?? null) as never,
  });
}

/**
 * `<name> as (insert into accounting_audit ...)` for use in a `with` list.
 * `whenRows`: name of an earlier CTE; the audit row is written only if that CTE returned a row (and once).
 * `objectIdSql`: a SQL expression for the object id when it is only known inside the statement.
 */
export function auditCte(name: string, e: AuditEntry, opts: { whenRows?: string; objectIdSql?: SQL } = {}): SQL {
  const objectId = opts.objectIdSql ?? sql`${e.objectId != null ? String(e.objectId) : null}::text`;
  const select = sql`select ${e.locationId}::text, ${e.action}::varchar, ${e.object}::varchar, ${objectId}, ${json(e.before)}::jsonb, ${json(e.after)}::jsonb, ${e.userId}::int`;
  const from = opts.whenRows ? sql` from ${sql.raw(opts.whenRows)} limit 1` : sql``;
  return sql`${sql.raw(name)} as (insert into accounting_audit (location_id, action, object, object_id, before, after, user_id) ${select}${from})`;
}

export async function writeAuditSafe(e: AuditEntry): Promise<void> {
  try {
    await auditInsert(e);
  } catch (err) {
    console.error("[accounting-audit] could not write audit row (non-fatal):", err instanceof Error ? err.message : String(err));
  }
}
