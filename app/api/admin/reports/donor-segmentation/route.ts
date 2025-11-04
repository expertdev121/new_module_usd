import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { contact, payment, pledge, paymentAllocations, manualDonation } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';

interface DonorSegmentationRow {
  donor_id: number | null;
  donor_first_name: string | null;
  donor_last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  total_lifetime_giving: number | null;
  first_year: number | null;
  last_year: number | null;
  largest_gift: number | null;
  years_active: number | null;
  giving_history: string | null;
  campaign_code: string | null;
  total_giving_by_event: number | null;
  largest_gift_by_event: number | null;
  first_year_event: number | null;
  last_year_event: number | null;
  donor_segment: string | null;
  donor_tenure: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { reportType, filters, preview } = await request.json();
    const { locationId, page = 1, pageSize = 10 } = filters;

    // Escape single quotes to prevent SQL injection
    const escapeSql = (value: string) => value.replace(/'/g, "''");
    const safeLocationId = escapeSql(locationId);

    // Base query for direct payments (non-split payments)
    const directPaymentsSQL = `
      SELECT
        c.id as donor_id,
        c.first_name as donor_first_name,
        c.last_name as donor_last_name,
        c.email,
        c.phone,
        c.address,
        COALESCE(p.amount_usd, p.amount) as amount,
        EXTRACT(YEAR FROM p.payment_date)::integer as year,
        p.payment_date,
        pl.campaign_code
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

    // Query for split payments (payment allocations)
    const splitPaymentsSQL = `
      SELECT
        c.id as donor_id,
        c.first_name as donor_first_name,
        c.last_name as donor_last_name,
        c.email,
        c.phone,
        c.address,
        COALESCE(pa.allocated_amount_usd, pa.allocated_amount) as amount,
        EXTRACT(YEAR FROM p.payment_date)::integer as year,
        p.payment_date,
        pl.campaign_code
      FROM payment_allocations pa
      INNER JOIN payment p ON pa.payment_id = p.id
      INNER JOIN pledge pl ON pa.pledge_id = pl.id
      INNER JOIN contact c ON pl.contact_id = c.id
      WHERE p.payment_status = 'completed'
        AND c.location_id = '${safeLocationId}'
        AND p.payment_date IS NOT NULL`;

    // Query for manual donations
    const manualDonationsSQL = `
      SELECT
        c.id as donor_id,
        c.first_name as donor_first_name,
        c.last_name as donor_last_name,
        c.email,
        c.phone,
        c.address,
        COALESCE(md.amount_usd, md.amount) as amount,
        EXTRACT(YEAR FROM md.payment_date)::integer as year,
        md.payment_date,
        NULL as campaign_code
      FROM manual_donation md
      INNER JOIN contact c ON md.contact_id = c.id
      WHERE c.location_id = '${safeLocationId}'
        AND md.payment_status = 'completed'
        AND md.payment_date IS NOT NULL`;

    // Combine all three queries
    const unionSQL = `(${directPaymentsSQL}) UNION ALL (${splitPaymentsSQL}) UNION ALL (${manualDonationsSQL})`;

    // Main aggregation query with donor segmentation analytics
    const querySQL = `
      WITH payment_data AS (
        ${unionSQL}
      ),
      donor_totals AS (
        SELECT
          donor_id,
          SUM(amount) as total_lifetime_giving,
          MIN(year) as first_year,
          MAX(year) as last_year,
          MAX(amount) as largest_gift,
          COUNT(DISTINCT year) as years_active
        FROM payment_data
        GROUP BY donor_id
      ),
      event_totals AS (
        SELECT
          donor_id,
          campaign_code,
          SUM(amount) as total_giving_by_event,
          MAX(amount) as largest_gift_by_event,
          MIN(year) as first_year_event,
          MAX(year) as last_year_event
        FROM payment_data
        WHERE campaign_code IS NOT NULL
        GROUP BY donor_id, campaign_code
      )
      SELECT
        pd.donor_id,
        pd.donor_first_name,
        pd.donor_last_name,
        pd.email,
        pd.phone,
        pd.address,
        dt.total_lifetime_giving,
        dt.first_year,
        dt.last_year,
        dt.largest_gift,
        dt.years_active,
        STRING_AGG(
          DISTINCT pd.year || ': $' || ROUND(pd.amount::numeric, 2)::text,
          '; ' ORDER BY pd.year || ': $' || ROUND(pd.amount::numeric, 2)::text
        ) as giving_history,
        et.campaign_code,
        COALESCE(et.total_giving_by_event, 0) as total_giving_by_event,
        COALESCE(et.largest_gift_by_event, 0) as largest_gift_by_event,
        et.first_year_event,
        et.last_year_event,
        CASE
          WHEN dt.total_lifetime_giving >= 10000 THEN 'Major Donor'
          WHEN dt.total_lifetime_giving >= 5000 THEN 'Mid-Level Donor'
          WHEN dt.total_lifetime_giving >= 1000 THEN 'Regular Donor'
          ELSE 'Occasional Donor'
        END as donor_segment,
        CASE
          WHEN dt.years_active >= 5 THEN 'Long-term Supporter'
          WHEN dt.years_active >= 3 THEN 'Established Donor'
          WHEN dt.years_active >= 2 THEN 'Repeat Donor'
          ELSE 'New Donor'
        END as donor_tenure
      FROM payment_data pd
      INNER JOIN donor_totals dt ON pd.donor_id = dt.donor_id
      LEFT JOIN event_totals et ON pd.donor_id = et.donor_id
      GROUP BY 
        pd.donor_id,
        pd.donor_first_name,
        pd.donor_last_name,
        pd.email,
        pd.phone,
        pd.address,
        dt.total_lifetime_giving,
        dt.first_year,
        dt.last_year,
        dt.largest_gift,
        dt.years_active,
        et.campaign_code,
        et.total_giving_by_event,
        et.largest_gift_by_event,
        et.first_year_event,
        et.last_year_event
      ORDER BY dt.total_lifetime_giving DESC, pd.donor_last_name, pd.donor_first_name`;

    // Execute query
    const results = await db.execute(sql.raw(querySQL));
    const rows = (results as { rows: unknown[] }).rows || [];

    // For preview, return JSON data with pagination
    if (preview) {
      const pageNum = parseInt(page.toString(), 10) || 1;
      const size = parseInt(pageSize.toString(), 10) || 10;
      const offset = (pageNum - 1) * size;
      const paginatedRows = rows.slice(offset, offset + size);

      const previewData = paginatedRows.map((row: unknown) => {
        const typedRow = row as DonorSegmentationRow;
        return {
          'Donor First Name': typedRow.donor_first_name || '',
          'Donor Last Name': typedRow.donor_last_name || '',
          'Email': typedRow.email || '',
          'Phone': typedRow.phone || '',
          'Address': typedRow.address || '',
          'Donor Segment': typedRow.donor_segment || '',
          'Donor Tenure': typedRow.donor_tenure || '',
          'Total Lifetime Giving': (parseFloat(typedRow.total_lifetime_giving?.toString() || '0')).toFixed(2),
          'Years Active': typedRow.years_active ? typedRow.years_active.toString() : '0',
          'First Year': typedRow.first_year ? typedRow.first_year.toString() : 'N/A',
          'Last Year': typedRow.last_year ? typedRow.last_year.toString() : 'N/A',
          'Largest Gift Ever': (parseFloat(typedRow.largest_gift?.toString() || '0')).toFixed(2),
          'Giving History & Trends': typedRow.giving_history || '',
          'Campaign Code': typedRow.campaign_code || 'All Campaigns',
          'Total Given to Event': (parseFloat(typedRow.total_giving_by_event?.toString() || '0')).toFixed(2),
          'Largest Gift to Event': (parseFloat(typedRow.largest_gift_by_event?.toString() || '0')).toFixed(2),
          'First Year at Event': typedRow.first_year_event ? typedRow.first_year_event.toString() : 'N/A',
          'Last Year at Event': typedRow.last_year_event ? typedRow.last_year_event.toString() : 'N/A',
        };
      });
      return NextResponse.json({
        data: previewData,
        total: rows.length,
        page: pageNum,
        pageSize: size,
        totalPages: Math.ceil(rows.length / size)
      });
    }

    // Generate CSV
    const csvData = rows.map((row: unknown) => {
      const typedRow = row as DonorSegmentationRow;
      return {
        'Donor First Name': typedRow.donor_first_name || '',
        'Donor Last Name': typedRow.donor_last_name || '',
        'Email': typedRow.email || '',
        'Phone': typedRow.phone || '',
        'Address': typedRow.address || '',
        'Donor Segment': typedRow.donor_segment || '',
        'Donor Tenure': typedRow.donor_tenure || '',
        'Total Lifetime Giving': (parseFloat(typedRow.total_lifetime_giving?.toString() || '0')).toFixed(2),
        'Years Active': typedRow.years_active ? typedRow.years_active.toString() : '0',
        'First Year': typedRow.first_year ? typedRow.first_year.toString() : 'N/A',
        'Last Year': typedRow.last_year ? typedRow.last_year.toString() : 'N/A',
        'Largest Gift Ever': (parseFloat(typedRow.largest_gift?.toString() || '0')).toFixed(2),
        'Giving History & Trends': typedRow.giving_history || '',
        'Campaign Code': typedRow.campaign_code || 'All Campaigns',
        'Total Given to Event': (parseFloat(typedRow.total_giving_by_event?.toString() || '0')).toFixed(2),
        'Largest Gift to Event': (parseFloat(typedRow.largest_gift_by_event?.toString() || '0')).toFixed(2),
        'First Year at Event': typedRow.first_year_event ? typedRow.first_year_event.toString() : 'N/A',
        'Last Year at Event': typedRow.last_year_event ? typedRow.last_year_event.toString() : 'N/A',
      };
    });

    const csv = stringify(csvData, { header: true });

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="donor-segmentation-${reportType}-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });

  } catch (error) {
    console.error('Error generating donor segmentation report:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}