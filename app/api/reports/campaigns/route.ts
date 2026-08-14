/**
 * Campaign / fund performance (Phase 5).
 *   GET /api/reports/campaigns?year=YYYY
 *     → per campaign/fund: raised, donors, gifts, avg gift, and the same
 *       for the prior year (comparison). export=csv streams the full set.
 *
 * Fund/campaign key resolution, in order:
 *   1. campaign_name  (campaign table via manual_donation.campaign_id)
 *   2. category_name  (category table via manual_donation.category_id)
 *   3. "Fund NNNN" recovered from notes (older CSV imports buried the
 *      accounting fund there instead of linking a campaign/category)
 *   4. '(Unassigned)'
 *
 * NOTE: we deliberately do NOT parse "PTI Type: ..." from notes — that
 * field is the PAYMENT METHOD (Credit Card / Check / Cash / ACH), not a
 * fund, so grouping by it would mislabel payment types as campaigns.
 * Tenants that track neither campaign nor category (e.g. PTI) correctly
 * roll up entirely under '(Unassigned)'.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getReportContext, safeInt } from "@/lib/reports/guard";
import { buildDonationsSource, rowsOf } from "@/lib/reports/donations-source";
import { streamCsvResponse } from "@/lib/reports/stream-csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SQL expression that resolves a fund/campaign label from a canonical row. */
const FUND_EXPR = sql`
  COALESCE(
    NULLIF(TRIM(campaign_name), ''),
    NULLIF(TRIM(category_name), ''),
    NULLIF('Fund ' || TRIM(SUBSTRING(notes FROM 'Fund\\s+([0-9A-Za-z-]+)')), 'Fund '),
    '(Unassigned)'
  )`;

interface CampaignRow {
  fund: string;
  raised: string;
  donors: number;
  gifts: number;
  prior_raised: string;
  prior_donors: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const guard = await getReportContext(searchParams.get("locationId") || undefined);
  if (guard.error) return guard.error;
  const locationId = guard.ctx.locationId;

  const year = safeInt(searchParams.get("year")) ?? new Date().getUTCFullYear();
  const curStart = `${year}-01-01`, curEnd = `${year}-12-31`;
  const priStart = `${year - 1}-01-01`, priEnd = `${year - 1}-12-31`;
  const wantCsv = searchParams.get("export") === "csv";

  const curSrc = buildDonationsSource(locationId, { status: "completed", startDate: curStart, endDate: curEnd });
  const priSrc = buildDonationsSource(locationId, { status: "completed", startDate: priStart, endDate: priEnd });

  // Aggregate each year by resolved fund, then full-join on fund.
  const perYear = (src: typeof curSrc) => sql`
    SELECT ${FUND_EXPR} AS fund,
           COALESCE(SUM(amount::numeric),0)::numeric AS raised,
           COUNT(DISTINCT contact_id)::int AS donors,
           COUNT(*)::int AS gifts
    FROM (${src}) s
    GROUP BY ${FUND_EXPR}`;

  const joined = sql`
    SELECT COALESCE(cur.fund, pri.fund) AS fund,
           COALESCE(cur.raised, 0)::text AS raised,
           COALESCE(cur.donors, 0) AS donors,
           COALESCE(cur.gifts, 0) AS gifts,
           COALESCE(pri.raised, 0)::text AS prior_raised,
           COALESCE(pri.donors, 0) AS prior_donors
    FROM (${perYear(curSrc)}) cur
    FULL OUTER JOIN (${perYear(priSrc)}) pri ON cur.fund = pri.fund`;

  if (wantCsv) {
    return streamCsvResponse<CampaignRow>({
      source: joined,
      orderBy: sql`ORDER BY raised::numeric DESC NULLS LAST`,
      header: ["Fund / Campaign", `${year} Raised`, `${year} Donors`, `${year} Gifts`, `${year - 1} Raised`, `${year - 1} Donors`],
      toRow: (r) => [r.fund, r.raised, r.donors, r.gifts, r.prior_raised, r.prior_donors],
      filename: `campaign-performance-${year}.csv`,
    });
  }

  const result = await db.execute(sql`
    SELECT * FROM (${joined}) t ORDER BY raised::numeric DESC NULLS LAST`);
  const campaigns = rowsOf<CampaignRow>(result);

  const totalRaised = campaigns.reduce((s, c) => s + parseFloat(c.raised), 0);
  const totalPrior = campaigns.reduce((s, c) => s + parseFloat(c.prior_raised), 0);

  return NextResponse.json({ year, totalRaised, totalPrior, campaigns });
}
