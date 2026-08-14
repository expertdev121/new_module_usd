/**
 * Canonical donations source (Phase 1 foundation).
 *
 * ONE normalized view of every donation for a tenant, unioned across the
 * two ledgers (manual_donation + pledge-linked payment). Every report in
 * Phases 2–5 reads from here so the numbers ALWAYS agree — this replaces
 * the per-report hand-written SQL that produced three different totals
 * for the same donor.
 *
 * Split-payment note: payments that carry payment_allocations are the
 * allocation rows' parents; to avoid double counting we currently take
 * the payment row as authoritative and do NOT also sum allocations
 * (matching the /api/donations behavior). Allocation-aware splitting is a
 * later refinement; the totals reconcile to the raw table sums today.
 *
 * SECURITY: locationId is ALWAYS supplied by the caller from the Phase-0
 * session guard, never from the client. Every filter value is bound as a
 * SQL parameter (no string interpolation).
 */
import { sql, type SQL } from "drizzle-orm";

export interface DonationFilters {
  /** Free-text: donor name / email / phone digits / Partner ID. */
  search?: string | null;
  /** Inclusive ISO date bounds (YYYY-MM-DD). Validate with safeDate first. */
  startDate?: string | null;
  endDate?: string | null;
  /** Amount bounds (major units). */
  minAmount?: number | null;
  maxAmount?: number | null;
  /** Payment method ('credit_card', 'ach', 'check', 'cash', 'other', ...). */
  paymentMethod?: string | null;
  /** Status ('completed', 'refunded', 'pending', ...). */
  status?: string | null;
  /** Provenance tag on manual_donation.import_source. */
  source?: string | null;
  /** manual_donation only: campaign id. */
  campaignId?: number | null;
  /** Restrict to a single ledger. */
  ledger?: "manual_donation" | "payment" | null;
}

export interface CanonicalDonationRow {
  source: "manual_donation" | "payment";
  donation_id: number;
  contact_id: number;
  first_name: string | null;
  last_name: string | null;
  donor_name: string;
  email: string | null;
  phone: string | null;
  constituents_id: string | null;
  amount: string;
  amount_usd: string | null;
  currency: string;
  payment_date: string;
  payment_method: string | null;
  payment_status: string;
  campaign_name: string | null;
  category_name: string | null;
  import_source: string | null;
  reference_number: string | null;
  notes: string | null;
}

/**
 * Build the canonical UNION query. Returns a Drizzle SQL fragment you can
 * wrap: `SELECT ... FROM (${buildDonationsSource(...)}) t`, paginate,
 * aggregate, or stream. Ordered newest-first by default caller choice.
 */
export function buildDonationsSource(
  locationId: string,
  filters: DonationFilters = {},
): SQL {
  const search = (filters.search ?? "").trim();
  const digits = search.replace(/\D+/g, "");
  const pattern = `%${search}%`;

  // Shared donor search predicate — applied on the joined contact.
  const contactSearch = search
    ? sql`AND (
        c.first_name ILIKE ${pattern}
        OR c.last_name ILIKE ${pattern}
        OR (COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) ILIKE ${pattern}
        OR c.display_name ILIKE ${pattern}
        OR c.email ILIKE ${pattern}
        OR c.constituents_id ILIKE ${pattern}
        ${digits.length >= 4
          ? sql`OR REGEXP_REPLACE(COALESCE(c.phone,''), '[^0-9]', '', 'g') LIKE ${"%" + digits + "%"}`
          : sql``}
      )`
    : sql``;

  // WHERE clauses are stitched per-half so each uses its own column names.
  const mdWhere = sql`
    WHERE c.location_id = ${locationId}
    ${contactSearch}
    ${filters.startDate ? sql`AND md.payment_date >= ${filters.startDate}` : sql``}
    ${filters.endDate ? sql`AND md.payment_date <= ${filters.endDate}` : sql``}
    ${filters.status ? sql`AND md.payment_status = ${filters.status}` : sql``}
    ${filters.paymentMethod ? sql`AND md.payment_method = ${filters.paymentMethod}` : sql``}
    ${filters.source ? sql`AND md.import_source = ${filters.source}` : sql``}
    ${filters.campaignId != null ? sql`AND md.campaign_id = ${filters.campaignId}` : sql``}
    ${filters.minAmount != null ? sql`AND md.amount >= ${filters.minAmount}` : sql``}
    ${filters.maxAmount != null ? sql`AND md.amount <= ${filters.maxAmount}` : sql``}
  `;

  const payWhere = sql`
    WHERE c.location_id = ${locationId}
    ${contactSearch}
    ${filters.startDate ? sql`AND p.payment_date >= ${filters.startDate}` : sql``}
    ${filters.endDate ? sql`AND p.payment_date <= ${filters.endDate}` : sql``}
    ${filters.status ? sql`AND p.payment_status = ${filters.status}` : sql``}
    ${filters.paymentMethod ? sql`AND p.payment_method = ${filters.paymentMethod}` : sql``}
    ${filters.minAmount != null ? sql`AND p.amount >= ${filters.minAmount}` : sql``}
    ${filters.maxAmount != null ? sql`AND p.amount <= ${filters.maxAmount}` : sql``}
    ${filters.source ? sql`AND FALSE` : sql``}
  `;

  const manualHalf = sql`
    SELECT
      'manual_donation' AS source,
      md.id AS donation_id,
      c.id AS contact_id,
      c.first_name, c.last_name,
      TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS donor_name,
      c.email, c.phone, c.constituents_id,
      md.amount::text AS amount,
      md.amount_usd::text AS amount_usd,
      md.currency::text AS currency,
      md.payment_date::text AS payment_date,
      md.payment_method,
      md.payment_status::text AS payment_status,
      camp.name AS campaign_name,
      cat.name AS category_name,
      md.import_source,
      md.reference_number,
      md.notes
    FROM manual_donation md
    JOIN contact c ON c.id = md.contact_id
    LEFT JOIN campaign camp ON camp.id = md.campaign_id
    LEFT JOIN category cat ON cat.id = md.category_id
    ${mdWhere}
  `;

  const paymentHalf = sql`
    SELECT
      'payment' AS source,
      p.id AS donation_id,
      c.id AS contact_id,
      c.first_name, c.last_name,
      TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS donor_name,
      c.email, c.phone, c.constituents_id,
      p.amount::text AS amount,
      p.amount_usd::text AS amount_usd,
      p.currency::text AS currency,
      p.payment_date::text AS payment_date,
      p.payment_method,
      p.payment_status::text AS payment_status,
      NULL AS campaign_name,
      NULL AS category_name,
      NULL AS import_source,
      p.reference_number,
      p.notes
    FROM payment p
    JOIN contact c ON c.id = p.payer_contact_id
    ${payWhere}
  `;

  const includeManual = filters.ledger !== "payment";
  const includePayment = filters.ledger !== "manual_donation";
  // manual_donation-only filters (source/campaign) exclude the payment
  // half automatically because payWhere adds `AND FALSE` when source is set.
  if (includeManual && includePayment) {
    return sql`(${manualHalf}) UNION ALL (${paymentHalf})`;
  }
  if (includeManual) return manualHalf;
  return paymentHalf;
}

/** Unwrap neon-http execute() results into a plain array. */
export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: unknown[] }).rows ?? (result as unknown[])) as T[];
}
