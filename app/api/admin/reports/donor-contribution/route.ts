import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { contact, payment, pledge, paymentAllocations, manualDonation } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';
import { getReportContext, safeDate, badFilter } from '@/lib/reports/guard';


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
    const rawBody = await request.json();
    const { reportType, filters, preview, page = 1, pageSize = 10 } = rawBody;

    const {
      eventCode,
      year,
      minAmount,
      maxAmount,
      giftType,
      startDate,
      endDate
    } = filters ?? {};

    // Phase-0 security hotfix: tenant scope comes from the SESSION, never
    // from the request body (super_admin may override). All values that
    // reach raw SQL are whitelist-validated first.
    const guard = await getReportContext(filters?.locationId);
    if (guard.error) return guard.error;
    const safeLocationId = guard.ctx.locationId;

    const escapeSql = (value: string) => value.replace(/'/g, "''");
    const safeEventCode = eventCode ? escapeSql(String(eventCode)) : null;
    const safeStartDate = startDate ? safeDate(startDate) : null;
    if (startDate && !safeStartDate) return badFilter('startDate');
    const safeEndDate = endDate ? safeDate(endDate) : null;
    if (endDate && !safeEndDate) return badFilter('endDate');

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
        COALESCE(p.received_date, p.payment_date) as payment_date,
        pl.campaign_code,
        EXTRACT(YEAR FROM COALESCE(p.received_date, p.payment_date))::integer as year,
        c.id as "recordNumber",
        pl.id as "pledgeId"
      FROM payment p
      INNER JOIN pledge pl ON p.pledge_id = pl.id
      INNER JOIN contact c ON pl.contact_id = c.id
      WHERE c.location_id = '${safeLocationId}'
        AND p.payment_status = 'completed'
        AND COALESCE(p.received_date, p.payment_date) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM payment_allocations pa
          WHERE pa.payment_id = p.id
        )`;

    if (safeEventCode) {
      directPaymentsSQL += ` AND pl.campaign_code = '${safeEventCode}'`;
    }

    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      directPaymentsSQL += ` AND EXTRACT(YEAR FROM COALESCE(p.received_date, p.payment_date)) = ${safeYear}`;
    }

    if (giftType === 'one-time') {
      directPaymentsSQL += ` AND pl.payment_plan_id IS NULL`;
    } else if (giftType === 'recurring') {
      directPaymentsSQL += ` AND pl.payment_plan_id IS NOT NULL`;
    }

    if (startDate) {
      directPaymentsSQL += ` AND COALESCE(p.received_date, p.payment_date) >= '${safeStartDate}'`;
    }

    if (endDate) {
      directPaymentsSQL += ` AND COALESCE(p.received_date, p.payment_date) <= '${safeEndDate}'`;
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
        COALESCE(p.received_date, p.payment_date) as payment_date,
        pl.campaign_code,
        EXTRACT(YEAR FROM COALESCE(p.received_date, p.payment_date))::integer as year,
        c.id as "recordNumber",
        pl.id as "pledgeId"
      FROM payment_allocations pa
      INNER JOIN payment p ON pa.payment_id = p.id
      INNER JOIN pledge pl ON pa.pledge_id = pl.id
      INNER JOIN contact c ON pl.contact_id = c.id
      WHERE p.payment_status = 'completed'
        AND c.location_id = '${safeLocationId}'
        AND COALESCE(p.received_date, p.payment_date) IS NOT NULL`;
    
    if (safeEventCode) {
      splitPaymentsSQL += ` AND pl.campaign_code = '${safeEventCode}'`;
    }

    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      splitPaymentsSQL += ` AND EXTRACT(YEAR FROM COALESCE(p.received_date, p.payment_date)) = ${safeYear}`;
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
      manualDonationsSQL += ` AND md.payment_date >= '${safeStartDate}'`;
    }

    if (endDate) {
      manualDonationsSQL += ` AND md.payment_date <= '${safeEndDate}'`;
    }

    // Combine all three queries with UNION ALL
    const unionSQL = `(${directPaymentsSQL}) UNION ALL (${splitPaymentsSQL}) UNION ALL (${manualDonationsSQL})`;

    // First, get total count without pagination
    const countSQL = `
      SELECT COUNT(*) as count
      FROM (
        SELECT
          "donorId",
          "donorFirstName",
          "donorLastName",
          email,
          phone,
          address,
          SUM(amount) as "totalGiving",
          MAX(payment_date) as "lastGiftDate",
          campaign_code,
          year,
          SUM(amount) as "totalGivingByEvent",
          "recordNumber"
        FROM (${unionSQL}) as combined
        GROUP BY "donorId", "donorFirstName", "donorLastName", email, phone, address, campaign_code, year, "recordNumber"`;

    let countQuerySQL = countSQL;
    
    if (minAmount || maxAmount) {
      countQuerySQL += ' HAVING TRUE';
      if (minAmount) {
        countQuerySQL += ` AND SUM(amount) >= ${parseFloat(minAmount)}`;
      }
      if (maxAmount) {
        countQuerySQL += ` AND SUM(amount) <= ${parseFloat(maxAmount)}`;
      }
    }
    
    countQuerySQL += ') as filtered_results';

    const countResult = await db.execute(sql.raw(countQuerySQL));
    const countRows = (countResult as { rows: unknown[] }).rows || [];
    const totalRecords = countRows.length > 0 ? (countRows[0] as { count: number }).count : 0;

    // Parse pagination parameters
    const pageNum = parseInt(page.toString(), 10) || 1;
    const size = parseInt(pageSize.toString(), 10) || 10;
    const offset = (pageNum - 1) * size;
    const totalPages = Math.ceil(totalRecords / size);


    // Now get paginated results WITH LIMIT and OFFSET in SQL
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
        SUM(amount) as "totalGivingByEvent",
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
    
    // Apply LIMIT and OFFSET in the SQL query for proper pagination
    querySQL += ` LIMIT ${size} OFFSET ${offset}`;

    
    const results = await db.execute(sql.raw(querySQL));
    const rows = (results as { rows: unknown[] }).rows || [];


    // For preview, return JSON data
    if (preview) {
      const previewData = (rows as DonorContributionRow[]).map((row) => {
        return {
          'Donor First Name': row.donorFirstName || '',
          'Donor Last Name': row.donorLastName || '',
          'Email': row.email || '',
          'Phone': row.phone || '',
          'Address': row.address || '',
          'Total Giving to Date': (parseFloat(row.totalGiving?.toString() || '0')).toFixed(2),
          'Date of Last Gift': row.lastGiftDate ? new Date(row.lastGiftDate).toLocaleDateString('en-US') : '',
          'Last Gift Amount': (parseFloat(row.lastGiftAmount?.toString() || '0')).toFixed(2),
          'Event Code': row.campaign_code || '',
          'Year(s) of Donation': row.year ? row.year.toString() : '',
          'Record Number': row.recordNumber?.toString() || '',
        };
      });

      const responseData = {
        data: previewData,
        total: totalRecords,
        page: pageNum,
        pageSize: size,
        totalPages: totalPages
      };

      
      return NextResponse.json(responseData);
    }

    // Generate CSV (return all data, not paginated)
    const csvQuerySQL = querySQL.replace(` LIMIT ${size} OFFSET ${offset}`, '');
    const csvResults = await db.execute(sql.raw(csvQuerySQL));
    const csvRows = (csvResults as { rows: unknown[] }).rows || [];


    const csvData = (csvRows as DonorContributionRow[]).map((row) => {
      return {
        'Donor First Name': row.donorFirstName || '',
        'Donor Last Name': row.donorLastName || '',
        'Email': row.email || '',
        'Phone': row.phone || '',
        'Address': row.address || '',
        'Total Giving to Date': (parseFloat(row.totalGiving?.toString() || '0')).toFixed(2),
        'Date of Last Gift': row.lastGiftDate ? new Date(row.lastGiftDate).toLocaleDateString('en-US') : '',
        'Last Gift Amount': (parseFloat(row.lastGiftAmount?.toString() || '0')).toFixed(2),
        'Event Code': row.campaign_code || '',
        'Year(s) of Donation': row.year ? row.year.toString() : '',
        'Total Amount Given Per Event': (parseFloat(row.totalGivingByEvent?.toString() || '0')).toFixed(2),
        'Record Number': row.recordNumber?.toString() || '',
      };
    });

    const csv = stringify(csvData, { header: true });


    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="donor-contribution-${reportType}-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });

  } catch (error) {
    console.error('\n========== API ERROR ==========');
    console.error('[ERROR] Full error:', error);
    console.error('[ERROR] Stack:', error instanceof Error ? error.stack : 'No stack');
    console.error('========== API ERROR END ==========\n');
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
