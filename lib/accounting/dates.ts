/**
 * Calendar-valid YYYY-MM-DD dates. A shape regex alone accepts 2026-13-45 or 2026-02-31, which then fail in
 * Postgres as a 500; this rejects them up front with a 400 and a clear message.
 */
import { z } from "zod";

export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const isoDate = (label: string) => z.string().refine(isRealDate, { message: `${label} must be a real date (YYYY-MM-DD)` });
