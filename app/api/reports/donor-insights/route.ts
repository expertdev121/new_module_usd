/**
 * GET /api/reports/donor-insights — one endpoint for every donor-centric
 * report (Phase 3), driven by ?type=. All read from the per-donor rollup
 * over the canonical source, so the numbers always agree.
 *
 * type = contribution | lybunt | sybunt | new | lapsed | consecutive
 * Params: year, minAmount, lapsedMonths, search, page, limit, export=csv,
 *         sort (total|last_gift|name), locationId (super_admin only)
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getReportContext, safeInt, safeNumber } from "@/lib/reports/guard";
import { rowsOf } from "@/lib/reports/donations-source";
import { buildDonorRollup, donorReportPredicate, type DonorRollupRow } from "@/lib/reports/donor-rollup";
import { streamCsvResponse } from "@/lib/reports/stream-csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = new Set(["contribution", "lybunt", "sybunt", "new", "lapsed", "consecutive"]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const guard = await getReportContext(searchParams.get("locationId") || undefined);
  if (guard.error) return guard.error;
  const locationId = guard.ctx.locationId;

  const type = (searchParams.get("type") || "contribution").toLowerCase();
  if (!TYPES.has(type)) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  const year = safeInt(searchParams.get("year")) ?? new Date().getUTCFullYear();
  const minAmount = safeNumber(searchParams.get("minAmount"));
  const lapsedMonths = safeInt(searchParams.get("lapsedMonths")) ?? 12;
  const search = (searchParams.get("search") || "").trim();
  const wantCsv = searchParams.get("export") === "csv";
  const page = Math.max(1, safeInt(searchParams.get("page")) ?? 1);
  const limit = Math.min(200, Math.max(1, safeInt(searchParams.get("limit")) ?? 50));
  const offset = (page - 1) * limit;

  const sortParam = searchParams.get("sort") || "total";
  const orderBy =
    sortParam === "last_gift"
      ? sql`ORDER BY last_gift_date DESC NULLS LAST`
      : sortParam === "name"
        ? sql`ORDER BY donor_name ASC`
        : sql`ORDER BY lifetime_total::numeric DESC NULLS LAST`;

  const rollup = buildDonorRollup(locationId, year);
  const predicate = donorReportPredicate(type, year, { minAmount, lapsedMonths });

  const digits = search.replace(/\D+/g, "");
  const searchPred = search
    ? sql`AND (
        d.donor_name ILIKE ${"%" + search + "%"}
        OR d.email ILIKE ${"%" + search + "%"}
        OR d.constituents_id ILIKE ${"%" + search + "%"}
        ${digits.length >= 4 ? sql`OR REGEXP_REPLACE(COALESCE(d.phone,''),'[^0-9]','','g') LIKE ${"%" + digits + "%"}` : sql``}
      )`
    : sql``;

  const filtered = sql`SELECT d.* FROM (${rollup}) d WHERE (${predicate}) ${searchPred}`;

  if (wantCsv) {
    return streamCsvResponse<DonorRollupRow>({
      source: filtered,
      orderBy: sql`ORDER BY lifetime_total::numeric DESC NULLS LAST`,
      header: ["Donor","Email","Phone","Partner ID","Lifetime Total","Gifts","First Gift","Last Gift","Last Gift Amount","This Year","Last Year","Years Giving"],
      toRow: (r) => [
        r.donor_name, r.email, r.phone, r.constituents_id,
        r.lifetime_total, r.gift_count, r.first_gift_date, r.last_gift_date,
        r.last_gift_amount, r.this_year_total, r.last_year_total, r.distinct_years,
      ],
      filename: `${type}-${year}-${new Date().toISOString().slice(0,10)}.csv`,
    });
  }

  const totalsResult = await db.execute(sql`
    SELECT COUNT(*)::int AS total_donors,
           COALESCE(SUM(lifetime_total::numeric),0)::text AS lifetime_sum,
           COALESCE(SUM(this_year_total::numeric),0)::text AS this_year_sum
    FROM (${filtered}) f`);
  const totals = rowsOf<{ total_donors: number; lifetime_sum: string; this_year_sum: string }>(totalsResult)[0]
    ?? { total_donors: 0, lifetime_sum: "0", this_year_sum: "0" };

  const pageResult = await db.execute(sql`SELECT * FROM (${filtered}) f ${orderBy} LIMIT ${limit} OFFSET ${offset}`);
  const donors = rowsOf<DonorRollupRow>(pageResult);

  return NextResponse.json({
    type, year,
    totalDonors: totals.total_donors,
    lifetimeSum: totals.lifetime_sum,
    thisYearSum: totals.this_year_sum,
    page, limit,
    donors,
  });
}
