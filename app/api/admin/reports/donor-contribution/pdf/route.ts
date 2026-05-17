import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { contact, payment, pledge, paymentAllocations, manualDonation } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { generateReportPDF, generateReportFilename } from '@/lib/pdf-report-generator';

interface DonorContributionRow {
  donorId: number | null;
  donorFirstName: string | null;
  donorLastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  totalGiving: number | null;
  lastGiftDate: Date | null;
  lastGiftAmount: number | null;
  campaign_code: string | null;
  year: number | null;
  totalGivingByEvent: number | null;
  recordNumber: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin' && session.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { reportType, filters } = await request.json();
    const {
      eventCode,
      year,
      minAmount,
      maxAmount,
      giftType,
      locationId,
      startDate,
      endDate
    } = filters;

    // Escape single quotes to prevent SQL injection
    const escapeSql = (value: string) => value.replace(/'/g, "''");
    const safeLocationId = escapeSql(locationId);
    const safeEventCode = eventCode ? escapeSql(eventCode) : null;

    // Base query for direct payments (non-split payments)
    let directPaymentsSQL = `
      SELECT
        c.id as "donorId",
        c.first_name as "donorFirstName",
        c.last_name as "donorLastName",
        c.email,
        c.phone,
        c.address,
        COALESCE(p.amount_usd, p.amount) as amount,
        p.payment_date,
        pl.campaign_code,
        EXTRACT(YEAR FROM p.payment_date)::integer as year,
        c.id as "recordNumber",
        pl.id as "pledgeId"
      FROM payment p
      INNER JOIN pledge pl ON p.pledge_id = pl.id
      INNER JOIN contact c ON pl.contact_id = c.id
      WHERE c.location_id = '${safeLocationId}'
        AND p.payment_status = 'completed'
        AND p.payment_date IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM payment_allocations pa
          WHERE pa.payment_id = p.id
        )`;

    if (safeEventCode) {
      directPaymentsSQL += ` AND pl.campaign_code = '${safeEventCode}'`;
    }

    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      directPaymentsSQL += ` AND EXTRACT(YEAR FROM p.payment_date) = ${safeYear}`;
    }

    if (giftType === 'one-time') {
      directPaymentsSQL += ` AND pl.payment_plan_id IS NULL`;
    } else if (giftType === 'recurring') {
      directPaymentsSQL += ` AND pl.payment_plan_id IS NOT NULL`;
    }

    if (startDate) {
      directPaymentsSQL += ` AND p.payment_date >= '${startDate}'`;
    }

    if (endDate) {
      directPaymentsSQL += ` AND p.payment_date <= '${endDate}'`;
    }

    // Query for split payments (payment allocations)
    let splitPaymentsSQL = `
      SELECT
        c.id as "donorId",
        c.first_name as "donorFirstName",
        c.last_name as "donorLastName",
        c.email,
        c.phone,
        c.address,
        COALESCE(pa.allocated_amount_usd, pa.allocated_amount) as amount,
        p.payment_date,
        pl.campaign_code,
        EXTRACT(YEAR FROM p.payment_date)::integer as year,
        c.id as "recordNumber",
        pl.id as "pledgeId"
      FROM payment_allocations pa
      INNER JOIN payment p ON pa.payment_id = p.id
      INNER JOIN pledge pl ON pa.pledge_id = pl.id
      INNER JOIN contact c ON pl.contact_id = c.id
      WHERE p.payment_status = 'completed'
        AND c.location_id = '${safeLocationId}'
        AND p.payment_date IS NOT NULL`;

    if (safeEventCode) {
      splitPaymentsSQL += ` AND pl.campaign_code = '${safeEventCode}'`;
    }

    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      splitPaymentsSQL += ` AND EXTRACT(YEAR FROM p.payment_date) = ${safeYear}`;
    }

    if (giftType === 'one-time') {
      splitPaymentsSQL += ` AND pl.payment_plan_id IS NULL`;
    } else if (giftType === 'recurring') {
      splitPaymentsSQL += ` AND pl.payment_plan_id IS NOT NULL`;
    }

    // Query for manual donations
    let manualDonationsSQL = `
      SELECT
        c.id as "donorId",
        c.first_name as "donorFirstName",
        c.last_name as "donorLastName",
        c.email,
        c.phone,
        c.address,
        COALESCE(md.amount_usd, md.amount) as amount,
        md.payment_date,
        COALESCE(camp.name, '') as campaign_code,
        EXTRACT(YEAR FROM md.payment_date)::integer as year,
        c.id as "recordNumber",
        NULL as "pledgeId"
      FROM manual_donation md
      INNER JOIN contact c ON md.contact_id = c.id
      LEFT JOIN campaign camp ON md.campaign_id = camp.id
      WHERE c.location_id = '${safeLocationId}'
        AND md.payment_status = 'completed'
        AND md.payment_date IS NOT NULL`;

    if (safeEventCode) {
      manualDonationsSQL += ` AND camp.name = '${safeEventCode}'`;
    }

    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      manualDonationsSQL += ` AND EXTRACT(YEAR FROM md.payment_date) = ${safeYear}`;
    }

    if (startDate) {
      manualDonationsSQL += ` AND md.payment_date >= '${startDate}'`;
    }

    if (endDate) {
      manualDonationsSQL += ` AND md.payment_date <= '${endDate}'`;
    }

    // Combine all three queries with UNION ALL
    const unionSQL = `(${directPaymentsSQL}) UNION ALL (${splitPaymentsSQL}) UNION ALL (${manualDonationsSQL})`;

    // Get donor details
    let querySQL = `
      SELECT
        "donorId",
        "donorFirstName",
        "donorLastName",
        email,
        phone,
        address,
        SUM(amount) as "totalGiving",
        MAX(payment_date) as "lastGiftDate",
        (
          SELECT amount
          FROM (${unionSQL}) sub
          WHERE sub."donorId" = combined."donorId"
          ORDER BY sub.payment_date DESC
          LIMIT 1
        ) as "lastGiftAmount",
        campaign_code,
        year,
        "recordNumber"
      FROM (${unionSQL}) as combined
      GROUP BY "donorId", "donorFirstName", "donorLastName", email, phone, address, campaign_code, year, "recordNumber"`;

    if (minAmount || maxAmount) {
      querySQL += ' HAVING TRUE';
      if (minAmount) {
        querySQL += ` AND SUM(amount) >= ${parseFloat(minAmount)}`;
      }
      if (maxAmount) {
        querySQL += ` AND SUM(amount) <= ${parseFloat(maxAmount)}`;
      }
    }

    querySQL += ' ORDER BY "donorLastName", "donorFirstName"';

    // Execute query
    const results = await db.execute(sql.raw(querySQL));
    const rows = (results as { rows: unknown[] }).rows || [];

    // Prepare PDF data
    const pdfData = rows.map((row: unknown) => {
      const typedRow = row as DonorContributionRow;
      return {
        'Donor First Name': typedRow.donorFirstName || '',
        'Donor Last Name': typedRow.donorLastName || '',
        'Email': typedRow.email || '',
        'Phone': typedRow.phone || '',
        'Address': typedRow.address || '',
        'Total Giving to Date': (parseFloat(typedRow.totalGiving?.toString() || '0')).toFixed(2),
        'Date of Last Gift': typedRow.lastGiftDate ? new Date(typedRow.lastGiftDate).toLocaleDateString('en-US') : '',
        'Last Gift Amount': (parseFloat(typedRow.lastGiftAmount?.toString() || '0')).toFixed(2),
        'Event Code': typedRow.campaign_code || '',
        'Year(s) of Donation': typedRow.year ? typedRow.year.toString() : '',
        'Record Number': typedRow.recordNumber?.toString() || '',
      };
    });

    // Generate PDF
    const pdfBuffer = generateReportPDF({
      title: "Donor Contribution Report",
      subtitle: `Donor Contribution Report${year ? ` - ${year}` : ''}`,
      data: pdfData,
      filename: generateReportFilename("donor-contribution"),
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${generateReportFilename("donor-contribution")}"`,
      },
    });

  } catch (error) {
    console.error('Error generating donor contribution PDF:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
