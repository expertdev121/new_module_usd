import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";

export type Row = Record<string, unknown>;

/** Runs raw SQL on the Neon HTTP driver and returns the result rows. */
export async function rows(query: SQL): Promise<Row[]> {
  const res = (await db.execute(query)) as unknown as { rows?: Row[] } | Row[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

/** Drizzle wraps driver errors ("Failed query: ..."); the Postgres message is on .cause. */
export function errorText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur instanceof Error; i++) {
    parts.push(cur.message);
    cur = (cur as Error & { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

/** Runs `run` over `items` in slices, one awaited call per slice (db.batch / multi-row insert sized work). */
export async function inChunks<T>(items: T[], run: (chunk: T[]) => Promise<unknown>, size = 80): Promise<void> {
  for (let i = 0; i < items.length; i += size) await run(items.slice(i, i + size));
}

export const textArray = (values: string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
export const intArray = (values: number[]) => sql`array[${sql.join(values.map((v) => sql`${v}::int`), sql`, `)}]::int[]`;
