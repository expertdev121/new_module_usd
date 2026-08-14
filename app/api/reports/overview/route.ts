/**
 * GET /api/reports/overview — the Reports dashboard data (Phase 2).
 *
 * All metrics come from the canonical donations source so they agree
 * with the Donations page and every other report. Tenant scope from the
 * session (super_admin may pass ?locationId=). One period + its
 * immediately-preceding equal-length period for % change.
 *
 * Query params:
 *   preset  = this_month | this_quarter | ytd | last_year | last_12m | all  (default last_12m)
 *   start,end  custom ISO range (overrides preset when both present)
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getReportContext, safeDate } from "@/lib/reports/guard";
import { buildDonationsSource, rowsOf } from "@/lib/reports/donations-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolvePeriod(preset: string, startQ: string | null, endQ: string | null) {
  const start = safeDate(startQ);
  const end = safeDate(endQ);
  if (start && end) return { start, end, label: "custom" };

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const todayIso = iso(now);

  switch (preset) {
    case "this_month":
      return { start: iso(new Date(Date.UTC(y, m, 1))), end: todayIso, label: preset };
    case "this_quarter": {
      const qStart = Math.floor(m / 3) * 3;
      return { start: iso(new Date(Date.UTC(y, qStart, 1))), end: todayIso, label: preset };
    }
    case "ytd":
      return { start: iso(new Date(Date.UTC(y, 0, 1))), end: todayIso, label: preset };
    case "last_year":
      return { start: iso(new Date(Date.UTC(y - 1, 0, 1))), end: iso(new Date(Date.UTC(y - 1, 11, 31))), label: preset };
    case "all":
      return { start: "1900-01-01", end: todayIso, label: preset };
    case "last_12m":
    default:
      return { start: iso(new Date(Date.UTC(y, m - 11, 1))), end: todayIso, label: "last_12m" };
  }
}

/** Given a period, the equal-length window immediately before it. */
function priorPeriod(start: string, end: string) {
  const s = new Date(start + "T00:00:00Z").getTime();
  const e = new Date(end + "T00:00:00Z").getTime();
  const len = e - s;
  const day = 86400000;
  const priorEnd = new Date(s - day);
  const priorStart = new Date(s - day - len);
  return { start: priorStart.toISOString().slice(0, 10), end: priorEnd.toISOString().slice(0, 10) };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const guard = await getReportContext(searchParams.get("locationId") || undefined);
  if (guard.error) return guard.error;
  const locationId = guard.ctx.locationId;

  const preset = searchParams.get("preset") || "last_12m";
  const { start, end, label } = resolvePeriod(preset, searchParams.get("start"), searchParams.get("end"));
  const prior = priorPeriod(start, end);

  // Only completed donations count toward fundraising KPIs.
  const completed = { status: "completed" as const };

  const curSource = buildDonationsSource(locationId, { ...completed, startDate: start, endDate: end });
  const priSource = buildDonationsSource(locationId, { ...completed, startDate: prior.start, endDate: prior.end });

  // ── KPIs (current + prior) ───────────────────────────────────────────────
  const [curKpi, priKpi] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS donations,
             COUNT(DISTINCT contact_id)::int AS donors,
             COALESCE(SUM(amount::numeric),0)::text AS raised
      FROM (${curSource}) t`),
    db.execute(sql`
      SELECT COUNT(*)::int AS donations,
             COUNT(DISTINCT contact_id)::int AS donors,
             COALESCE(SUM(amount::numeric),0)::text AS raised
      FROM (${priSource}) t`),
  ]);
  const cur = rowsOf<{ donations: number; donors: number; raised: string }>(curKpi)[0] ?? { donations: 0, donors: 0, raised: "0" };
  const pri = rowsOf<{ donations: number; donors: number; raised: string }>(priKpi)[0] ?? { donations: 0, donors: 0, raised: "0" };
  const curRaised = parseFloat(cur.raised);
  const priRaised = parseFloat(pri.raised);
  const avgGift = cur.donations > 0 ? curRaised / cur.donations : 0;
  const priAvg = pri.donations > 0 ? priRaised / pri.donations : 0;
  const pct = (a: number, b: number) => (b === 0 ? (a > 0 ? 100 : 0) : ((a - b) / b) * 100);

  // ── Monthly trend (last 24 months, ignores the period filter on purpose) ──
  const trendStart = new Date();
  trendStart.setUTCMonth(trendStart.getUTCMonth() - 23);
  trendStart.setUTCDate(1);
  const trendSource = buildDonationsSource(locationId, { ...completed, startDate: trendStart.toISOString().slice(0, 10) });
  const trendResult = await db.execute(sql`
    SELECT TO_CHAR(DATE_TRUNC('month', payment_date::date), 'YYYY-MM') AS month,
           COALESCE(SUM(amount::numeric),0)::text AS raised,
           COUNT(*)::int AS donations
    FROM (${trendSource}) t
    GROUP BY 1 ORDER BY 1`);
  const trend = rowsOf<{ month: string; raised: string; donations: number }>(trendResult);

  // ── Top donors (current period) ───────────────────────────────────────────
  const topDonorsResult = await db.execute(sql`
    SELECT contact_id, MAX(donor_name) AS donor_name,
           COALESCE(SUM(amount::numeric),0)::text AS total,
           COUNT(*)::int AS gifts
    FROM (${curSource}) t
    GROUP BY contact_id ORDER BY SUM(amount::numeric) DESC NULLS LAST LIMIT 10`);
  const topDonors = rowsOf<{ contact_id: number; donor_name: string; total: string; gifts: number }>(topDonorsResult);

  // ── Top campaigns (current period; manual_donation carries campaign) ──────
  const topCampaignsResult = await db.execute(sql`
    SELECT COALESCE(campaign_name, '(Unassigned)') AS campaign,
           COALESCE(SUM(amount::numeric),0)::text AS total,
           COUNT(*)::int AS donations
    FROM (${curSource}) t
    GROUP BY COALESCE(campaign_name, '(Unassigned)')
    ORDER BY SUM(amount::numeric) DESC NULLS LAST LIMIT 8`);
  const topCampaigns = rowsOf<{ campaign: string; total: string; donations: number }>(topCampaignsResult);

  // ── By payment method (current period) ────────────────────────────────────
  const byMethodResult = await db.execute(sql`
    SELECT COALESCE(NULLIF(TRIM(payment_method), ''), 'unknown') AS method,
           COALESCE(SUM(amount::numeric),0)::text AS total,
           COUNT(*)::int AS donations
    FROM (${curSource}) t
    GROUP BY COALESCE(NULLIF(TRIM(payment_method), ''), 'unknown')
    ORDER BY SUM(amount::numeric) DESC NULLS LAST`);
  const byMethod = rowsOf<{ method: string; total: string; donations: number }>(byMethodResult);

  return NextResponse.json({
    period: { preset: label, start, end, prior },
    kpis: {
      raised: curRaised,
      raisedPriorPct: pct(curRaised, priRaised),
      donations: cur.donations,
      donationsPriorPct: pct(cur.donations, pri.donations),
      donors: cur.donors,
      donorsPriorPct: pct(cur.donors, pri.donors),
      avgGift,
      avgGiftPriorPct: pct(avgGift, priAvg),
    },
    trend,
    topDonors,
    topCampaigns,
    byMethod,
  });
}
