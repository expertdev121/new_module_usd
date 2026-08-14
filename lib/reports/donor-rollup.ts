/**
 * Per-donor rollup (Phase 3) built on the canonical donations source.
 *
 * Produces one row per donor with the fields every donor-centric report
 * needs, so Donor Contribution / LYBUNT / SYBUNT / New / Lapsed /
 * Consecutive-year all share one query shape and always agree.
 *
 * `year` frames the "this year vs last year" comparison. Amounts count
 * only completed donations.
 */
import { sql, type SQL } from "drizzle-orm";
import { buildDonationsSource } from "./donations-source";

export interface DonorRollupRow {
  contact_id: number;
  donor_name: string;
  email: string | null;
  phone: string | null;
  constituents_id: string | null;
  lifetime_total: string;
  gift_count: number;
  first_gift_date: string | null;
  last_gift_date: string | null;
  last_gift_amount: string | null;
  this_year_total: string;
  last_year_total: string;
  distinct_years: number;
  max_year: number | null;
  min_year: number | null;
}

/**
 * Wraps the canonical source in a per-donor GROUP BY. Returns a SQL
 * fragment you can further filter/paginate: `SELECT * FROM (<this>) d`.
 */
export function buildDonorRollup(locationId: string, year: number): SQL {
  // Whole-history completed donations for this tenant.
  const src = buildDonationsSource(locationId, { status: "completed" });
  return sql`
    SELECT
      contact_id,
      MAX(donor_name) AS donor_name,
      MAX(email) AS email,
      MAX(phone) AS phone,
      MAX(constituents_id) AS constituents_id,
      COALESCE(SUM(amount::numeric), 0)::text AS lifetime_total,
      COUNT(*)::int AS gift_count,
      MIN(payment_date)::text AS first_gift_date,
      MAX(payment_date)::text AS last_gift_date,
      (ARRAY_AGG(amount::numeric ORDER BY payment_date DESC))[1]::text AS last_gift_amount,
      COALESCE(SUM(amount::numeric) FILTER (WHERE EXTRACT(YEAR FROM payment_date::date) = ${year}), 0)::text AS this_year_total,
      COALESCE(SUM(amount::numeric) FILTER (WHERE EXTRACT(YEAR FROM payment_date::date) = ${year - 1}), 0)::text AS last_year_total,
      COUNT(DISTINCT EXTRACT(YEAR FROM payment_date::date))::int AS distinct_years,
      MAX(EXTRACT(YEAR FROM payment_date::date))::int AS max_year,
      MIN(EXTRACT(YEAR FROM payment_date::date))::int AS min_year
    FROM (${src}) s
    GROUP BY contact_id
  `;
}

/**
 * HAVING/WHERE predicate for each donor report type, applied to the
 * rollup subquery (columns are the rollup's output names).
 */
export function donorReportPredicate(
  type: string,
  year: number,
  opts: { minAmount?: number | null; lapsedMonths?: number | null } = {},
): SQL {
  switch (type) {
    case "lybunt":
      // Gave LAST year, NOT this year.
      return sql`d.last_year_total::numeric > 0 AND d.this_year_total::numeric = 0`;
    case "sybunt":
      // Gave in SOME prior year, NOT this year (and not only last year —
      // any historical donor who lapsed this year).
      return sql`d.lifetime_total::numeric > 0 AND d.this_year_total::numeric = 0 AND d.max_year < ${year}`;
    case "new":
      // First gift falls in the selected year.
      return sql`EXTRACT(YEAR FROM d.first_gift_date::date) = ${year}`;
    case "lapsed": {
      const months = opts.lapsedMonths ?? 12;
      return sql`d.last_gift_date::date < (CURRENT_DATE - (${months} || ' months')::interval)`;
    }
    case "consecutive":
      // Gave in the selected year AND has multi-year giving history.
      return sql`d.this_year_total::numeric > 0 AND d.distinct_years >= 2`;
    case "contribution":
    default: {
      const min = opts.minAmount ?? 0;
      return min > 0 ? sql`d.lifetime_total::numeric >= ${min}` : sql`TRUE`;
    }
  }
}
