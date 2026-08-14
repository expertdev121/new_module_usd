/**
 * Streamed CSV export (Phase 1 foundation).
 *
 * Pages through a query in chunks and streams CSV rows to the client
 * instead of buffering the whole result set in memory. Replaces the old
 * "re-run the full unbounded query and stringify it all at once" pattern
 * that would time out / OOM on large tenants (JOL: 80k+ donations).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { rowsOf } from "./donations-source";

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export interface StreamCsvOptions<T> {
  /** Inner source query — will be wrapped, ordered, and paged by this helper. */
  source: SQL;
  /** ORDER BY fragment (defaults to payment_date DESC, donation_id DESC). */
  orderBy?: SQL;
  header: string[];
  /** Map one source row → an array of cell values matching `header`. */
  toRow: (row: T) => unknown[];
  /** Rows fetched per page (default 2000). */
  chunkSize?: number;
  filename: string;
}

export function streamCsvResponse<T>(opts: StreamCsvOptions<T>): Response {
  const chunk = opts.chunkSize ?? 2000;
  const orderBy = opts.orderBy ?? sql`ORDER BY payment_date DESC, donation_id DESC`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(opts.header.map(csvCell).join(",") + "\n"));
      let offset = 0;
      // Hard cap so a runaway query can't stream forever.
      const MAX_PAGES = 5000;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await db.execute(
          sql`SELECT * FROM (${opts.source}) t ${orderBy} LIMIT ${chunk} OFFSET ${offset}`,
        );
        const rows = rowsOf<T>(result);
        if (rows.length === 0) break;
        let buf = "";
        for (const r of rows) buf += opts.toRow(r).map(csvCell).join(",") + "\n";
        controller.enqueue(enc.encode(buf));
        if (rows.length < chunk) break;
        offset += chunk;
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${opts.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
