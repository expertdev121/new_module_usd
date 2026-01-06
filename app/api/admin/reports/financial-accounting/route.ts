import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { contact, payment, pledge, paymentAllocations, manualDonation } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';

interface FinancialAccountingRow {
  campaign_code: string | null;
  year: number | null;
  year_end_total: number | null;
  previous_year_total: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { reportType, filters, preview } = await request.json();
    const { campaignIds, year, locationId, page = 1, pageSize = 10 } = filters;

    // Parse pagination parameters
    const pageNum = parseInt(page.toString(), 10) || 1;
    const size = parseInt(pageSize.toString(), 10) || 10;
    const offset = (pageNum - 1) * size;

    // Escape single quotes to prevent SQL injection
    const escapeSql = (value: string) => value.replace(/'/g, "''");
    const safeLocationId = escapeSql(locationId);
    const safeCampaignIds = campaignIds && Array.isArray(campaignIds) && campaignIds.length > 0
      ? campaignIds.map(id => parseInt(id.toString())).filter(id => !isNaN(id))
      : null;

    // Base query for direct payments (non-split payments)
    let directPaymentsSQL = `
      SELECT
        COALESCE(p.amount_usd, p.amount) as amount,
        p.payment_method as donation_source,
        CASE WHEN pl.notes ILIKE '%restricted%' THEN true ELSE false END as is_restricted,
        COALESCE(camp.name, '') as campaign_code,
        EXTRACT(YEAR FROM COALESCE(p.received_date, p.payment_date))::integer as year,
        COALESCE(p.received_date, p.payment_date) as payment_date
      FROM payment p
      INNER JOIN pledge pl ON p.pledge_id = pl.id
      INNER JOIN contact c ON pl.contact_id = c.id
      LEFT JOIN campaign camp ON pl.campaign_code = camp.name
      WHERE c.location_id = '${safeLocationId}'
        AND p.payment_status = 'completed'
        AND COALESCE(p.received_date, p.payment_date) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM payment_allocations pa
          WHERE pa.payment_id = p.id
        )`;

    // Apply campaign filter
    if (safeCampaignIds) {
      const campaignNames = safeCampaignIds.map(id => `camp_${id}`).join("','");
      directPaymentsSQL += ` AND camp.id IN (${safeCampaignIds.join(',')})`;
    }

    // Apply year filter
    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      directPaymentsSQL += ` AND EXTRACT(YEAR FROM COALESCE(p.received_date, p.payment_date)) = ${safeYear}`;
    }

    // Query for split payments (payment allocations)
    let splitPaymentsSQL = `
      SELECT
        COALESCE(pa.allocated_amount_usd, pa.allocated_amount) as amount,
        p.payment_method as donation_source,
        CASE WHEN pl.notes ILIKE '%restricted%' THEN true ELSE false END as is_restricted,
        COALESCE(camp.name, '') as campaign_code,
        EXTRACT(YEAR FROM p.payment_date)::integer as year,
        p.payment_date
      FROM payment_allocations pa
      INNER JOIN payment p ON pa.payment_id = p.id
      INNER JOIN pledge pl ON pa.pledge_id = pl.id
      INNER JOIN contact c ON pl.contact_id = c.id
      LEFT JOIN campaign camp ON pl.campaign_code = camp.name
      WHERE p.payment_status = 'completed'
        AND c.location_id = '${safeLocationId}'
        AND p.payment_date IS NOT NULL`;

    // Apply campaign filter
    if (safeCampaignIds) {
      splitPaymentsSQL += ` AND camp.id IN (${safeCampaignIds.join(',')})`;
    }

    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      splitPaymentsSQL += ` AND EXTRACT(YEAR FROM COALESCE(p.received_date, p.payment_date)) = ${safeYear}`;
    }

    // Query for manual donations
    let manualDonationsSQL = `
      SELECT
        COALESCE(md.amount_usd, md.amount) as amount,
        md.payment_method as donation_source,
        CASE WHEN md.notes ILIKE '%restricted%' THEN true ELSE false END as is_restricted,
        COALESCE(camp.name, '') as campaign_code,
        EXTRACT(YEAR FROM md.payment_date)::integer as year,
        md.payment_date
      FROM manual_donation md
      INNER JOIN contact c ON md.contact_id = c.id
      LEFT JOIN campaign camp ON md.campaign_id = camp.id
      WHERE c.location_id = '${safeLocationId}'
        AND md.payment_status = 'completed'
        AND md.payment_date IS NOT NULL`;

    // Apply campaign filter
    if (safeCampaignIds) {
      manualDonationsSQL += ` AND md.campaign_id IN (${safeCampaignIds.join(',')})`;
    }

    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      manualDonationsSQL += ` AND EXTRACT(YEAR FROM md.payment_date) = ${safeYear}`;
    }

    // Combine all three queries
    const unionSQL = `(${directPaymentsSQL}) UNION ALL (${splitPaymentsSQL}) UNION ALL (${manualDonationsSQL})`;

    // First, get total count without pagination
    const countSQL = `
      WITH payment_data AS (
        ` + unionSQL + `
      ),
      yearly_totals AS (
        SELECT
          COALESCE(campaign_code, '') as campaign_code,
          year,
          SUM(amount) as year_total
        FROM payment_data
        GROUP BY COALESCE(campaign_code, ''), year
      )
      SELECT COUNT(*) as count
      FROM yearly_totals`;

    // Execute count query
    const countResult = await db.execute(sql.raw(countSQL));
    const countRows = (countResult as { rows: unknown[] }).rows || [];
    const totalRecords = countRows.length > 0 ? (countRows[0] as { count: number }).count : 0;
    const totalPages = Math.ceil(totalRecords / size);

    // Main aggregation query with year-over-year comparison and pagination
    const querySQL = `
      WITH payment_data AS (
        ` + unionSQL + `
      ),
      yearly_totals AS (
        SELECT
          COALESCE(campaign_code, '') as campaign_code,
          year,
          SUM(amount) as year_total
        FROM payment_data
        GROUP BY COALESCE(campaign_code, ''), year
      )
      SELECT
        yt.campaign_code,
        yt.year,
        yt.year_total as year_end_total,
        COALESCE(
          (SELECT yt_prev.year_total
           FROM yearly_totals yt_prev
           WHERE yt_prev.campaign_code = yt.campaign_code
           AND yt_prev.year = yt.year - 1),
          0
        ) as previous_year_total
      FROM yearly_totals yt
      ORDER BY yt.year DESC, yt.campaign_code
      LIMIT ` + size + ` OFFSET ` + offset;

    // Execute query
    const results = await db.execute(sql.raw(querySQL));
    const rows = (results as { rows: unknown[] }).rows || [];

    // For preview, return JSON data with pagination
    if (preview) {
      const previewData = rows.map((row) => {
        const typedRow = row as FinancialAccountingRow;
        return {
          'Year': typedRow.year ? typedRow.year.toString() : '',
          'Event Code': typedRow.campaign_code || '',
          'Donation Source': 'Various',
          'Previous Year Total': (parseFloat(typedRow.previous_year_total?.toString() || '0')).toFixed(2),
          'Restricted vs. Unrestricted Funds': 'Mixed',
          'Total Donations Received': (parseFloat(typedRow.year_end_total?.toString() || '0')).toFixed(2),
          'Year-End Total for Event': (parseFloat(typedRow.year_end_total?.toString() || '0')).toFixed(2),
          'Year-over-Year Change': typedRow.previous_year_total && typedRow.previous_year_total > 0
            ? (((parseFloat(typedRow.year_end_total?.toString() || '0') - parseFloat(typedRow.previous_year_total.toString())) / parseFloat(typedRow.previous_year_total.toString())) * 100).toFixed(2) + '%'
            : 'N/A',
        };
      });
      return NextResponse.json({
        data: previewData,
        total: totalRecords,
        page: pageNum,
        pageSize: size,
        totalPages: totalPages
      });
    }

    // Generate CSV
    const csvData = rows.map((row) => {
      const typedRow = row as FinancialAccountingRow;
      return {
        'Year': typedRow.year ? typedRow.year.toString() : '',
        'Event Code': typedRow.campaign_code || '',
        'Year-End Total for Event': (parseFloat(typedRow.year_end_total?.toString() || '0')).toFixed(2),
        'Previous Year Total': (parseFloat(typedRow.previous_year_total?.toString() || '0')).toFixed(2),
        'Year-over-Year Change': typedRow.previous_year_total && typedRow.previous_year_total > 0
          ? (((parseFloat(typedRow.year_end_total?.toString() || '0') - parseFloat(typedRow.previous_year_total.toString())) / parseFloat(typedRow.previous_year_total.toString())) * 100).toFixed(2) + '%'
          : 'N/A',
      };
    });

    const csv = stringify(csvData, { header: true });

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="financial-accounting-' + reportType + '-' + new Date().toISOString().split('T')[0] + '.csv"',
      },
    });

  } catch (error) {
    console.error('Error generating financial accounting report:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}