/**
 * GET /api/dashboard/summary — everything the at-a-glance dashboard needs,
 * in ONE call, computed from the canonical donations source so every number
 * reconciles with the Reports and the Donations ledger.
 *
 * No pledges, no user-facing filters — the dashboard is a fixed, opinionated
 * overview:
 *   • hero KPIs        : ALL-TIME totals, with a this-year-vs-last-year delta
 *   • trend            : last 12 months, money raised per month
 *   • topFunds         : last 12 months, unified fund/campaign resolver
 *   • byMethod         : last 12 months, payment-method split
 *   • topDonors        : last 12 months
 *   • recentActivity   : latest completed gifts
 *   • donorHealth      : new / returning / lapsed / retention (calendar year)
 *
 * Tenant scope comes from the session guard (super_admin may pass
 * ?locationId=). Completed donations only.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getReportContext } from "@/lib/reports/guard";
import { buildDonationsSource, rowsOf } from "@/lib/reports/donations-source";
import { buildDonorRollup } from "@/lib/reports/donor-rollup";
import { FUND_EXPR } from "@/lib/reports/fund-expr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);

interface KpiRow { donations: number; donors: number; raised: string }
const kpiSelect = (src: ReturnType<typeof buildDonationsSource>) => sql`
  SELECT COUNT(*)::int AS donations,
         COUNT(DISTINCT contact_id)::int AS donors,
         COALESCE(SUM(amount::numeric),0)::text AS raised
  FROM (${src}) t`;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const guard = await getReportContext(searchParams.get("locationId") || undefined);
  if (guard.error) return guard.error;
  const locationId = guard.ctx.locationId;

  const now = new Date();
  const y = now.getUTCFullYear();
  const twelveMoStart = iso(new Date(Date.UTC(y, now.getUTCMonth() - 11, 1)));

  // "This year vs last year" compares like-for-like: Jan 1 → today this year
  // against Jan 1 → the SAME calendar day last year. Comparing a partial
  // current year against a full prior year would make every tenant look
  // down for most of the year, which is misleading.
  const todayThisYear = iso(now);
  const sameDayLastYear = iso(new Date(Date.UTC(y - 1, now.getUTCMonth(), now.getUTCDate())));

  const completed = { status: "completed" as const };
  const allSrc = buildDonationsSource(locationId, completed);
  const thisYearSrc = buildDonationsSource(locationId, { ...completed, startDate: `${y}-01-01`, endDate: todayThisYear });
  const lastYearSrc = buildDonationsSource(locationId, { ...completed, startDate: `${y - 1}-01-01`, endDate: sameDayLastYear });
  const last12Src = buildDonationsSource(locationId, { ...completed, startDate: twelveMoStart });

  const [
    orgRes, allKpiRes, thisKpiRes, lastKpiRes,
    trendRes, fundsRes, methodRes, topDonorsRes, activityRes, healthRes,
  ] = await Promise.all([
    db.execute(sql`SELECT org_name FROM organization_name WHERE location_id = ${locationId} LIMIT 1`),
    db.execute(kpiSelect(allSrc)),
    db.execute(kpiSelect(thisYearSrc)),
    db.execute(kpiSelect(lastYearSrc)),
    db.execute(sql`
      SELECT TO_CHAR(DATE_TRUNC('month', payment_date::date), 'YYYY-MM') AS month,
             COALESCE(SUM(amount::numeric),0)::text AS raised,
             COUNT(*)::int AS donations
      FROM (${last12Src}) t GROUP BY 1 ORDER BY 1`),
    db.execute(sql`
      SELECT ${FUND_EXPR} AS fund,
             COALESCE(SUM(amount::numeric),0)::text AS raised,
             COUNT(*)::int AS gifts
      FROM (${last12Src}) t
      GROUP BY ${FUND_EXPR}
      ORDER BY SUM(amount::numeric) DESC NULLS LAST LIMIT 8`),
    db.execute(sql`
      SELECT COALESCE(NULLIF(TRIM(payment_method), ''), 'unknown') AS method,
             COALESCE(SUM(amount::numeric),0)::text AS total,
             COUNT(*)::int AS gifts
      FROM (${last12Src}) t
      GROUP BY COALESCE(NULLIF(TRIM(payment_method), ''), 'unknown')
      ORDER BY SUM(amount::numeric) DESC NULLS LAST`),
    db.execute(sql`
      SELECT contact_id, MAX(donor_name) AS donor_name,
             COALESCE(SUM(amount::numeric),0)::text AS total,
             COUNT(*)::int AS gifts
      FROM (${last12Src}) t
      GROUP BY contact_id ORDER BY SUM(amount::numeric) DESC NULLS LAST LIMIT 8`),
    db.execute(sql`
      SELECT contact_id, donor_name, amount::text AS amount, payment_method, payment_date::text AS payment_date
      FROM (${allSrc}) t
      ORDER BY payment_date DESC NULLS LAST, donation_id DESC LIMIT 10`),
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE this_year_total::numeric > 0)::int AS active_this_year,
        COUNT(*) FILTER (WHERE last_year_total::numeric > 0)::int AS active_last_year,
        COUNT(*) FILTER (WHERE this_year_total::numeric > 0 AND last_year_total::numeric > 0)::int AS retained,
        COUNT(*) FILTER (WHERE this_year_total::numeric > 0 AND EXTRACT(YEAR FROM first_gift_date::date) = ${y})::int AS new_this_year,
        COUNT(*) FILTER (WHERE this_year_total::numeric > 0 AND EXTRACT(YEAR FROM first_gift_date::date) < ${y})::int AS returning_this_year,
        COUNT(*) FILTER (WHERE last_gift_date::date < (CURRENT_DATE - INTERVAL '13 months'))::int AS lapsed
      FROM (${buildDonorRollup(locationId, y)}) d`),
  ]);

  const all = rowsOf<KpiRow>(allKpiRes)[0] ?? { donations: 0, donors: 0, raised: "0" };
  const tY = rowsOf<KpiRow>(thisKpiRes)[0] ?? { donations: 0, donors: 0, raised: "0" };
  const lY = rowsOf<KpiRow>(lastKpiRes)[0] ?? { donations: 0, donors: 0, raised: "0" };

  const num = (s: string) => parseFloat(s) || 0;
  const pct = (a: number, b: number) => (b === 0 ? (a > 0 ? 100 : 0) : ((a - b) / b) * 100);
  const avg = (raised: string, n: number) => (n > 0 ? num(raised) / n : 0);

  const health = rowsOf<{ active_this_year: number; active_last_year: number; retained: number; new_this_year: number; returning_this_year: number; lapsed: number }>(healthRes)[0]
    ?? { active_this_year: 0, active_last_year: 0, retained: 0, new_this_year: 0, returning_this_year: 0, lapsed: 0 };

  return NextResponse.json({
    orgName: rowsOf<{ org_name: string }>(orgRes)[0]?.org_name ?? null,
    year: y,
    kpis: {
      raised:    { allTime: num(all.raised),    thisYear: num(tY.raised),    lastYear: num(lY.raised),    yoyPct: pct(num(tY.raised), num(lY.raised)) },
      donations: { allTime: all.donations,      thisYear: tY.donations,      lastYear: lY.donations,      yoyPct: pct(tY.donations, lY.donations) },
      donors:    { allTime: all.donors,         thisYear: tY.donors,         lastYear: lY.donors,         yoyPct: pct(tY.donors, lY.donors) },
      avgGift:   { allTime: avg(all.raised, all.donations), thisYear: avg(tY.raised, tY.donations), lastYear: avg(lY.raised, lY.donations), yoyPct: pct(avg(tY.raised, tY.donations), avg(lY.raised, lY.donations)) },
    },
    trend: rowsOf<{ month: string; raised: string; donations: number }>(trendRes),
    topFunds: rowsOf<{ fund: string; raised: string; gifts: number }>(fundsRes),
    byMethod: rowsOf<{ method: string; total: string; gifts: number }>(methodRes),
    topDonors: rowsOf<{ contact_id: number; donor_name: string; total: string; gifts: number }>(topDonorsRes),
    recentActivity: rowsOf<{ contact_id: number; donor_name: string; amount: string; payment_method: string | null; payment_date: string }>(activityRes),
    donorHealth: {
      newThisYear: health.new_this_year,
      returningThisYear: health.returning_this_year,
      lapsed: health.lapsed,
      retentionPct: health.active_last_year > 0 ? (health.retained / health.active_last_year) * 100 : 0,
    },
  });
}
