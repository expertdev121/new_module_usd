/**
 * Comma-safe money parsing.
 *
 * WHY THIS EXISTS: `parseFloat("1,000.00")` returns `1` — it stops reading at
 * the first comma. `Number("1,000.00")` returns `NaN`. Both silently corrupt
 * thousands-formatted amounts. A real CSV import once stored $1,000.00 gifts as
 * $1.00 for exactly this reason. Every amount that originates from user text
 * (CSV cells, form inputs, webhook string payloads) MUST go through here.
 *
 * It strips currency symbols and thousands separators, then parses. It does NOT
 * floor, round, or otherwise alter the real value — "1,000.00" -> 1000, always.
 */

/**
 * Parse a possibly comma/currency-formatted amount into a finite number.
 * Returns `null` when the input has no parseable numeric value.
 *
 * Accepts: "1,000.00", "$1,000.00", "1 000,00" is NOT assumed (see note),
 * "  250 ", 1000 (number passthrough).
 *
 * NOTE: We treat "," strictly as a thousands separator and "." as the decimal
 * point (US/most-of-our-data convention). Inputs that already are numbers pass
 * through untouched.
 */
export function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Remove everything that isn't a digit, a decimal point, or a sign.
  // This drops currency symbols ($, £, €), spaces, and thousands commas.
  const cleaned = trimmed.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") {
    return null;
  }

  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse an amount and require it to be a positive, finite number.
 * Returns `null` for anything that isn't strictly greater than zero.
 */
export function parsePositiveAmount(raw: unknown): number | null {
  const value = parseAmount(raw);
  if (value === null || value <= 0) return null;
  return value;
}

/**
 * Parse a positive amount into integer cents (for Stripe et al.).
 * Returns `null` when the amount is missing or not strictly positive.
 */
export function parseAmountToCents(raw: unknown): number | null {
  const value = parsePositiveAmount(raw);
  if (value === null) return null;
  return Math.round(value * 100);
}
