/**
 * Build a ZIP containing one CSV per location-scoped table, for a single
 * location. Used by GET /api/admin/offboard/[locationId]/export so the
 * super admin can download a full snapshot before deleting anything.
 *
 * Uses jszip — small dep, runs in Node serverless, produces a Buffer we
 * can pipe directly to the HTTP response. We don't stream because the
 * data volumes are small (one client's data) and a single Buffer keeps
 * the response logic simple.
 */
import JSZip from "jszip";
import { stringify } from "csv-stringify/sync";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { OFFBOARD_TABLES } from "./tables";

export interface ExportResult {
  zip: Buffer;
  filename: string;
  tableCounts: Record<string, number>;
  totalRows: number;
}

export async function buildOffboardZip(
  locationId: string,
  opts: { locationName?: string | null } = {},
): Promise<ExportResult> {
  if (!locationId) throw new Error("buildOffboardZip: locationId required");

  const zip = new JSZip();
  const tableCounts: Record<string, number> = {};
  let totalRows = 0;

  for (const tbl of OFFBOARD_TABLES) {
    if (!tbl.exportable) continue;

    const rows = await fetchRowsForTable(tbl.name, tbl.scope, locationId);
    tableCounts[tbl.name] = rows.length;
    totalRows += rows.length;

    if (rows.length === 0) {
      // Still include an empty CSV with just the header so the export is
      // exhaustive (lets the recipient see "we have no tags" vs "we forgot
      // to include the tags file").
      zip.file(`${tbl.name}.csv`, "");
      continue;
    }
    const csv = stringify(rows, { header: true });
    zip.file(`${tbl.name}.csv`, csv);
  }

  // README explaining the bundle.
  const readme = buildReadme(locationId, opts.locationName, tableCounts, totalRows);
  zip.file("README.txt", readme);

  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const datePart = new Date().toISOString().slice(0, 10);
  const safeName = (opts.locationName || locationId)
    .replace(/[^a-z0-9-_]/gi, "-")
    .slice(0, 40);
  const filename = `donorhq-export-${safeName}-${datePart}.zip`;

  return { zip: buf, filename, tableCounts, totalRows };
}

/**
 * Fetch all rows for one table scoped to a location. Uses raw SQL via
 * db.execute because the table name is dynamic and we don't want to
 * import 20 Drizzle table definitions just to SELECT *.
 *
 * Trusts the table name from OFFBOARD_TABLES (hard-coded list, not user
 * input) — no SQL injection risk.
 */
async function fetchRowsForTable(
  tableName: string,
  scope: "location" | "contact_child" | "pledge_child" | "resource_id",
  locationId: string,
): Promise<Record<string, unknown>[]> {
  let whereClause: string;
  if (scope === "location") {
    // Most tables have a `location_id` column.
    whereClause = `WHERE location_id = $1`;
  } else if (scope === "contact_child") {
    whereClause = `WHERE contact_id IN (SELECT id FROM contact WHERE location_id = $1)`;
  } else if (scope === "pledge_child") {
    whereClause = `WHERE pledge_id IN (SELECT id FROM pledge WHERE contact_id IN (SELECT id FROM contact WHERE location_id = $1))`;
  } else {
    // resource_id (ghl_oauth_tokens) — match locationId OR resource_id
    // (covers Location-scoped and Company-scoped rows that map here).
    whereClause = `WHERE location_id = $1 OR resource_id = $1`;
  }

  const query = `SELECT * FROM "${tableName}" ${whereClause}`;
  const result = await db.execute(sql.raw(query.replace("$1", `'${escapeSqlLiteral(locationId)}'`)));
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  return rows as Record<string, unknown>[];
}

/**
 * Escape a string literal for embedding in raw SQL. Conservative — only
 * doubles single quotes. We control all callers (locationId comes from
 * the URL path which we already validated) so this is belt-and-braces.
 */
function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

function buildReadme(
  locationId: string,
  locationName: string | null | undefined,
  tableCounts: Record<string, number>,
  totalRows: number,
): string {
  const lines: string[] = [];
  lines.push("DonorHQ — Client Offboarding Data Export");
  lines.push("=========================================");
  lines.push("");
  lines.push(`Location ID:    ${locationId}`);
  lines.push(`Location name:  ${locationName ?? "(unknown)"}`);
  lines.push(`Exported at:    ${new Date().toISOString()}`);
  lines.push(`Total rows:     ${totalRows.toLocaleString()}`);
  lines.push("");
  lines.push("Contents (one CSV per table):");
  lines.push("");
  const widest = Math.max(...Object.keys(tableCounts).map((k) => k.length));
  for (const [name, count] of Object.entries(tableCounts).sort()) {
    lines.push(`  ${name.padEnd(widest + 2)} ${count.toLocaleString().padStart(10)} rows`);
  }
  lines.push("");
  lines.push("Notes:");
  lines.push("  - Empty CSV files mean the table has no rows for this location.");
  lines.push("    They are included so the bundle is exhaustive.");
  lines.push("  - `ghl_sync_writes` is intentionally excluded (ephemeral data).");
  lines.push("  - This bundle is the full set of rows that a Hard Delete will");
  lines.push("    remove. Keep this file safe before proceeding.");
  return lines.join("\n");
}
