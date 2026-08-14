/**
 * Canonical fund/campaign label resolver, shared by the campaign report
 * and the dashboard so both group giving the same way.
 *
 * Resolution order against a canonical donations row:
 *   1. campaign_name  (campaign table via manual_donation.campaign_id)
 *   2. category_name  (category table via manual_donation.category_id)
 *   3. "Fund NNNN" recovered from import notes
 *   4. '(Unassigned)'
 *
 * NOTE: we deliberately do NOT parse "PTI Type: ..." from notes — that
 * field is the PAYMENT METHOD (Credit Card / Check / Cash / ACH), not a
 * fund. Tenants that track neither campaign nor category roll up entirely
 * under '(Unassigned)'. See lib/reports memory note.
 */
import { sql } from "drizzle-orm";

export const FUND_EXPR = sql`
  COALESCE(
    NULLIF(TRIM(campaign_name), ''),
    NULLIF(TRIM(category_name), ''),
    NULLIF('Fund ' || TRIM(SUBSTRING(notes FROM 'Fund\\s+([0-9A-Za-z-]+)')), 'Fund '),
    '(Unassigned)'
  )`;
