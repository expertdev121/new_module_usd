/**
 * GET /api/donations — every donation for the caller's location as ONE
 * flat ledger: manual_donation UNION payment, joined to contact.
 *
 * Tenant scoping goes through contact.location_id (NOT md.location_id):
 * legacy manual_donation rows for several tenants predate that column
 * and still carry NULL there, but every row has a contact.
 *
 * Query params:
 *   page   (default 1)
 *   limit  (default 50, max 200)
 *   search — matches donor first/last/display name, email, phone digits,
 *            or constituents_id (external Partner ID)
 *   export=csv — streams the ENTIRE filtered set as a CSV download
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { db } from "@/lib/db";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LedgerRow {
  source: string;
  donation_id: number;
  contact_id: number;
  donor_name: string;
  email: string | null;
  phone: string | null;
  constituents_id: string | null;
  amount: string;
  currency: string;
  payment_date: string;
  payment_method: string | null;
  payment_status: string;
  campaign_name: string | null;
  reference_number: string | null;
  notes: string | null;
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: unknown[] }).rows ?? (result as unknown[])) as T[];
}

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
  const search = (searchParams.get("search") || "").trim();
  const wantCsv = searchParams.get("export") === "csv";

  const searchDigits = search.replace(/\D+/g, "");
  const pattern = `%${search}%`;

  // Search predicate shared by both halves of the union (applied on the
  // joined contact). Phone matches on digits so "(718) 263-2483" is found
  // by "7182632483" and vice versa.
  const contactSearch = search
    ? sql`AND (
        c.first_name ILIKE ${pattern}
        OR c.last_name ILIKE ${pattern}
        OR (c.first_name || ' ' || c.last_name) ILIKE ${pattern}
        OR c.display_name ILIKE ${pattern}
        OR c.email ILIKE ${pattern}
        OR c.constituents_id ILIKE ${pattern}
        ${searchDigits.length >= 4
          ? sql`OR REGEXP_REPLACE(COALESCE(c.phone, ''), '[^0-9]', '', 'g') LIKE ${"%" + searchDigits + "%"}`
          : sql``}
      )`
    : sql``;

  const unionSql = sql`
    SELECT * FROM (
      (
        SELECT
          'manual_donation' AS source,
          md.id AS donation_id,
          c.id AS contact_id,
          TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS donor_name,
          c.email, c.phone, c.constituents_id,
          md.amount::text AS amount,
          md.currency::text AS currency,
          md.payment_date::text AS payment_date,
          md.payment_method,
          md.payment_status::text AS payment_status,
          camp.name AS campaign_name,
          md.reference_number,
          md.notes
        FROM manual_donation md
        JOIN contact c ON c.id = md.contact_id
        LEFT JOIN campaign camp ON camp.id = md.campaign_id
        WHERE c.location_id = ${locationId}
        ${contactSearch}
      )
      UNION ALL
      (
        SELECT
          'payment' AS source,
          p.id AS donation_id,
          c.id AS contact_id,
          TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS donor_name,
          c.email, c.phone, c.constituents_id,
          p.amount::text AS amount,
          p.currency::text AS currency,
          p.payment_date::text AS payment_date,
          p.payment_method,
          p.payment_status::text AS payment_status,
          NULL AS campaign_name,
          p.reference_number,
          p.notes
        FROM payment p
        JOIN contact c ON c.id = p.payer_contact_id
        WHERE c.location_id = ${locationId}
        ${contactSearch}
      )
    ) ledger
    ORDER BY payment_date DESC, donation_id DESC
  `;

  if (wantCsv) {
    const all = rowsOf<LedgerRow>(await db.execute(unionSql));
    const q = (v: unknown) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const header = ["Date","Donor Name","Email","Phone","Partner ID","Amount","Currency","Method","Status","Campaign","Reference #","Source","Notes"];
    const lines = [header.map(q).join(",")];
    for (const r of all) {
      lines.push([
        r.payment_date, r.donor_name, r.email, r.phone, r.constituents_id,
        r.amount, r.currency, r.payment_method, r.payment_status,
        r.campaign_name, r.reference_number, r.source, r.notes,
      ].map(q).join(","));
    }
    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="donations-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  // Totals for the current filter (count + sum) in one pass.
  const totalsResult = await db.execute(sql`
    SELECT COUNT(*)::int AS total, COALESCE(SUM(amount::numeric), 0)::text AS total_amount
    FROM (${unionSql}) t
  `);
  const totals = rowsOf<{ total: number; total_amount: string }>(totalsResult)[0] ?? { total: 0, total_amount: "0" };

  const pageResult = await db.execute(sql`${unionSql} LIMIT ${limit} OFFSET ${offset}`);
  const donations = rowsOf<LedgerRow>(pageResult).map((r) => ({
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
    notes: r.notes,
  }));

  return NextResponse.json({
    donations,
    page,
    limit,
    total: totals.total,
    totalAmount: totals.total_amount,
  });
}
