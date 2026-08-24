/**
 * GET /api/donations — every donation for the caller's location as ONE
 * flat ledger. Now reads from the canonical donations source (Phase 1),
 * the same module every report uses, so totals always agree.
 *
 * Query params: page, limit, search, export=csv, plus the shared filters
 * (startDate, endDate, minAmount, maxAmount, method, status, source).
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { db } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { safeDate, safeNumber } from "@/lib/reports/guard";
import {
  buildDonationsSource,
  rowsOf,
  type CanonicalDonationRow,
  type DonationFilters,
} from "@/lib/reports/donations-source";
import { streamCsvResponse } from "@/lib/reports/stream-csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const locationId = session.user.locationId;
  if (!locationId) {
    return NextResponse.json(
      { error: "missing_location", message: "Your session has no locationId." },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
  const offset = (page - 1) * limit;
  const wantCsv = searchParams.get("export") === "csv";

  const filters: DonationFilters = {
    search: searchParams.get("search"),
    startDate: safeDate(searchParams.get("startDate")),
    endDate: safeDate(searchParams.get("endDate")),
    minAmount: safeNumber(searchParams.get("minAmount")),
    maxAmount: safeNumber(searchParams.get("maxAmount")),
    paymentMethod: searchParams.get("method"),
    status: searchParams.get("status"),
    source: searchParams.get("source"),
    tagId: safeNumber(searchParams.get("tagId")),
  };

  const source = buildDonationsSource(locationId, filters);
  const orderBy = sql`ORDER BY payment_date DESC, donation_id DESC`;

  if (wantCsv) {
    return streamCsvResponse<CanonicalDonationRow>({
      source,
      orderBy,
      header: ["Date","Donor Name","Email","Phone","Partner ID","Amount","Currency","Method","Status","Campaign","Reference #","Source","Import Source","Notes"],
      toRow: (r) => [
        r.payment_date, r.donor_name, r.email, r.phone, r.constituents_id,
        r.amount, r.currency, r.payment_method, r.payment_status,
        r.campaign_name, r.reference_number, r.source, r.import_source, r.notes,
      ],
      filename: `donations-${new Date().toISOString().slice(0, 10)}.csv`,
    });
  }

  const totalsResult = await db.execute(sql`
    SELECT COUNT(*)::int AS total,
           COALESCE(SUM(revenue_amount::numeric), 0)::text AS total_amount,
           COALESCE(SUM(amount::numeric), 0)::text AS gross_amount
    FROM (${source}) t
  `);
  const totals = rowsOf<{ total: number; total_amount: string; gross_amount: string }>(totalsResult)[0]
    ?? { total: 0, total_amount: "0", gross_amount: "0" };

  // Per-status breakdown for the filter chips — built WITHOUT the status
  // filter so every status (and its amount) stays visible even when one is
  // selected. `amount` here is the net (revenue) contribution per status.
  const summarySource = buildDonationsSource(locationId, { ...filters, status: null });
  const summaryResult = await db.execute(sql`
    SELECT payment_status AS status, COUNT(*)::int AS count,
           COALESCE(SUM(amount::numeric), 0)::text AS gross,
           COALESCE(SUM(revenue_amount::numeric), 0)::text AS net
    FROM (${summarySource}) t
    GROUP BY payment_status
    ORDER BY SUM(amount::numeric) DESC NULLS LAST
  `);
  const statusSummary = rowsOf<{ status: string; count: number; gross: string; net: string }>(summaryResult);

  const pageResult = await db.execute(sql`
    SELECT * FROM (${source}) t ${orderBy} LIMIT ${limit} OFFSET ${offset}
  `);
  const donations = rowsOf<CanonicalDonationRow>(pageResult).map((r) => ({
    source: r.source,
    donationId: r.donation_id,
    contactId: r.contact_id,
    donorName: r.donor_name || "(no name)",
    email: r.email,
    phone: r.phone,
    constituentsId: r.constituents_id,
    amount: r.amount,
    currency: r.currency,
    paymentDate: r.payment_date,
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    campaignName: r.campaign_name,
    referenceNumber: r.reference_number,
  }));

  return NextResponse.json({
    donations,
    page,
    limit,
    total: totals.total,
    totalAmount: totals.total_amount, // net of refunds/failed/cancelled
    grossAmount: totals.gross_amount, // face value of all rows
    statusSummary,
  });
}
