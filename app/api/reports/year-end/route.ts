/**
 * Year-end giving statements (Phase 4).
 *   GET /api/reports/year-end?year=YYYY
 *     → summary: one row per donor with their annual total for tax letters.
 *   GET /api/reports/year-end?year=YYYY&export=csv
 *     → streamed CSV (donor + address + annual total + gift count).
 *   GET /api/reports/year-end?year=YYYY&contactId=N
 *     → itemized: every gift that donor made that year (for one statement).
 *
 * Reads the canonical source (completed donations only), tenant-scoped.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getReportContext, safeInt } from "@/lib/reports/guard";
import { buildDonationsSource, rowsOf } from "@/lib/reports/donations-source";
import { streamCsvResponse } from "@/lib/reports/stream-csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StatementRow {
  contact_id: number;
  donor_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  annual_total: string;
  gift_count: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const guard = await getReportContext(searchParams.get("locationId") || undefined);
  if (guard.error) return guard.error;
  const locationId = guard.ctx.locationId;

  const year = safeInt(searchParams.get("year")) ?? new Date().getUTCFullYear() - 1;
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const contactId = safeInt(searchParams.get("contactId"));
  const wantCsv = searchParams.get("export") === "csv";

  const src = buildDonationsSource(locationId, { status: "completed", startDate: start, endDate: end });

  // Itemized single-donor statement.
  if (contactId != null) {
    const itemResult = await db.execute(sql`
      SELECT payment_date, amount::text AS amount, currency, payment_method, campaign_name, reference_number
      FROM (${src}) s
      WHERE contact_id = ${contactId}
      ORDER BY payment_date ASC`);
    const items = rowsOf(itemResult);
    const [sumRow] = rowsOf<{ total: string; n: number; donor_name: string; email: string | null; phone: string | null }>(
      await db.execute(sql`
        SELECT COALESCE(SUM(amount::numeric),0)::text AS total, COUNT(*)::int AS n,
               MAX(donor_name) AS donor_name, MAX(email) AS email, MAX(phone) AS phone
        FROM (${src}) s WHERE contact_id = ${contactId}`),
    );
    return NextResponse.json({ year, contactId, donor: sumRow, items });
  }

  // Address is on the contact table — join it in via a wrapper.
  const summarySource = sql`
    SELECT s.contact_id,
           MAX(s.donor_name) AS donor_name,
           MAX(s.email) AS email,
           MAX(s.phone) AS phone,
           MAX(c.address) AS address,
           COALESCE(SUM(s.amount::numeric),0)::text AS annual_total,
           COUNT(*)::int AS gift_count
    FROM (${src}) s
    JOIN contact c ON c.id = s.contact_id
    GROUP BY s.contact_id`;

  if (wantCsv) {
    return streamCsvResponse<StatementRow>({
      source: summarySource,
      orderBy: sql`ORDER BY annual_total::numeric DESC NULLS LAST`,
      header: ["Donor","Email","Phone","Address",`${year} Total`,"Gifts"],
      toRow: (r) => [r.donor_name, r.email, r.phone, r.address, r.annual_total, r.gift_count],
      filename: `year-end-statements-${year}.csv`,
    });
  }

  const page = Math.max(1, safeInt(searchParams.get("page")) ?? 1);
  const limit = Math.min(200, Math.max(1, safeInt(searchParams.get("limit")) ?? 50));
  const offset = (page - 1) * limit;

  const totalsResult = await db.execute(sql`
    SELECT COUNT(*)::int AS donors, COALESCE(SUM(annual_total::numeric),0)::text AS total
    FROM (${summarySource}) t`);
  const totals = rowsOf<{ donors: number; total: string }>(totalsResult)[0] ?? { donors: 0, total: "0" };

  const pageResult = await db.execute(sql`
    SELECT * FROM (${summarySource}) t ORDER BY annual_total::numeric DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`);
  const donors = rowsOf<StatementRow>(pageResult);

  return NextResponse.json({ year, totalDonors: totals.donors, totalRaised: totals.total, page, limit, donors });
}
