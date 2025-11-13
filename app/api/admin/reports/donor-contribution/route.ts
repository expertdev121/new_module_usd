import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { contact, payment, pledge, paymentAllocations, manualDonation } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';


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
    console.log('\n\n========== API START ==========');
    
    const session = await getServerSession(authOptions);
    console.log('[1-SESSION] User role:', session?.user?.role);
    
    if (!session || session.user.role !== 'admin') {
      console.log('[1-AUTH] UNAUTHORIZED - redirecting');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request and log
    const rawBody = await request.json();
    console.log('[2-REQUEST] Full body:', JSON.stringify(rawBody, null, 2));
    
    const { reportType, filters, preview, page = 1, pageSize = 10 } = rawBody;
    console.log('[2-REPORT_TYPE]', reportType);
    console.log('[2-FILTERS] Filters object:', JSON.stringify(filters, null, 2));
    
    const { 
      eventCode, 
      year, 
      minAmount, 
      maxAmount, 
      giftType, 
      locationId
    } = filters;

    console.log('[3-PAGINATION-RAW] page:', page, 'pageSize:', pageSize);
    console.log('[3-PAGINATION-TYPES] page type:', typeof page, 'pageSize type:', typeof pageSize);

    // Escape single quotes to prevent SQL injection
    const escapeSql = (value: string) => value.replace(/'/g, "''");
    const safeLocationId = escapeSql(locationId);
    const safeEventCode = eventCode ? escapeSql(eventCode) : null;

    console.log('[4-SAFE_VALUES] locationId:', safeLocationId);

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
        NULL as campaign_code,
        EXTRACT(YEAR FROM md.payment_date)::integer as year,
        c.id as "recordNumber",
        NULL as "pledgeId"
      FROM manual_donation md
      INNER JOIN contact c ON md.contact_id = c.id
      WHERE c.location_id = '${safeLocationId}'
        AND md.payment_status = 'completed'
        AND md.payment_date IS NOT NULL`;

    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      manualDonationsSQL += ` AND EXTRACT(YEAR FROM md.payment_date) = ${safeYear}`;
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

    console.log('[5-COUNT_QUERY] Executing count query...');
    const countResult = await db.execute(sql.raw(countQuerySQL));
    const countRows = (countResult as { rows: unknown[] }).rows || [];
    const totalRecords = countRows.length > 0 ? (countRows[0] as { count: number }).count : 0;

    // Parse pagination parameters
    const pageNum = parseInt(page.toString(), 10) || 1;
    const size = parseInt(pageSize.toString(), 10) || 10;
    const offset = (pageNum - 1) * size;
    const totalPages = Math.ceil(totalRecords / size);

    console.log('[5-COUNT_RESULT] totalRecords:', totalRecords);
    console.log('[6-PAGINATION-PARSED] pageNum:', pageNum, 'size:', size, 'offset:', offset);
    console.log('[6-PAGINATION-CALC] totalPages:', totalPages);

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

    console.log(`[7-DATA_QUERY] LIMIT ${size} OFFSET ${offset}`);
    console.log('[7-DATA_QUERY] Executing paginated query...');
    
    const results = await db.execute(sql.raw(querySQL));
    const rows = (results as { rows: unknown[] }).rows || [];

    console.log('[7-DATA_RESULT] Rows returned from DB:', rows.length);

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
          'Total Amount Given Per Event': (parseFloat(row.totalGivingByEvent?.toString() || '0')).toFixed(2),
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

      console.log('[8-RESPONSE] Sending response with pageNum:', pageNum, 'pageSize:', size, 'rowCount:', previewData.length);
      console.log('========== API END ==========\n');
      
      return NextResponse.json(responseData);
    }

    // Generate CSV (return all data, not paginated, detailed view)
    console.log('[9-CSV] Generating full dataset CSV...');

    let csvQuerySQL = unionSQL;

    if (minAmount || maxAmount) {
      // For detailed view, filter at the payment level
      csvQuerySQL = `SELECT * FROM (${unionSQL}) as combined WHERE TRUE`;
      if (minAmount) {
        // This is approximate since we're filtering per payment, not per donor total
        csvQuerySQL += ` AND amount >= ${parseFloat(minAmount)}`;
      }
      if (maxAmount) {
        csvQuerySQL += ` AND amount <= ${parseFloat(maxAmount)}`;
      }
    }

    csvQuerySQL += ' ORDER BY payment_date DESC';

    const csvResults = await db.execute(sql.raw(csvQuerySQL));
    const csvRows = (csvResults as { rows: unknown[] }).rows || [];

    console.log('[9-CSV] Total rows for CSV:', csvRows.length);

    const csvData = csvRows.map((row: any) => {
      return {
        'Donor First Name': row.donorFirstName || '',
        'Donor Last Name': row.donorLastName || '',
        'Email': row.email || '',
        'Phone': row.phone || '',
        'Address': row.address || '',
        'Amount': (parseFloat(row.amount?.toString() || '0')).toFixed(2),
        'Payment Date': row.payment_date ? new Date(row.payment_date).toLocaleDateString('en-US') : '',
        'Event Code': row.campaign_code || '',
        'Year': row.year ? row.year.toString() : '',
        'Record Number': row.recordNumber?.toString() || '',
      };
    });

    const csv = stringify(csvData, { header: true });

    console.log('[9-CSV] CSV generated successfully');
    console.log('========== API END ==========\n');

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
