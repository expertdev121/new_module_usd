import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { contact, payment, pledge, paymentAllocations, manualDonation } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';

interface GivingTrendsRow {
  year: number | null;
  total_donations: number | null;
  total_donors: number | null;
  avg_donation: number | null;
  total_raised: number | null;
  growth_rate: number | null;
  donor_retention_rate: number | null;
  new_donors: number | null;
  returning_donors: number | null;
  lapsed_donors: number | null;
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
        COALESCE(p.amount_usd, p.amount) as amount,
        EXTRACT(YEAR FROM p.payment_date)::integer as year,
        p.payment_date
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
        COALESCE(pa.allocated_amount_usd, pa.allocated_amount) as amount,
        EXTRACT(YEAR FROM p.payment_date)::integer as year,
        p.payment_date
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
        COALESCE(md.amount_usd, md.amount) as amount,
        EXTRACT(YEAR FROM md.payment_date)::integer as year,
        md.payment_date
      FROM manual_donation md
      INNER JOIN contact c ON md.contact_id = c.id
      WHERE c.location_id = '${safeLocationId}'
        AND md.payment_status = 'completed'
        AND md.payment_date IS NOT NULL`;

    // Combine all three queries
    const unionSQL = `(${directPaymentsSQL}) UNION ALL (${splitPaymentsSQL}) UNION ALL (${manualDonationsSQL})`;

    // Main aggregation query with year-over-year trends
    const querySQL = `
      WITH payment_data AS (
        ${unionSQL}
      ),
      yearly_stats AS (
        SELECT
          year,
          COUNT(DISTINCT donor_id) as total_donors,
          COUNT(*) as total_donations,
          SUM(amount) as total_raised,
          AVG(amount) as avg_donation
        FROM payment_data
        GROUP BY year
      ),
      donor_years AS (
        SELECT
          donor_id,
          ARRAY_AGG(DISTINCT year ORDER BY year) as donation_years
        FROM payment_data
        GROUP BY donor_id
      ),
      retention_stats AS (
        SELECT
          ys.year,
          COUNT(dy.donor_id) as returning_donors,
          (
            SELECT COUNT(*)
            FROM donor_years dy2
            WHERE ys.year = ANY(dy2.donation_years)
              AND NOT (ys.year - 1 = ANY(dy2.donation_years))
          ) as new_donors,
          (
            SELECT COUNT(*)
            FROM donor_years dy3
            WHERE (ys.year - 1) = ANY(dy3.donation_years)
              AND NOT ys.year = ANY(dy3.donation_years)
          ) as lapsed_donors
        FROM yearly_stats ys
        LEFT JOIN donor_years dy ON ys.year = ANY(dy.donation_years)
        GROUP BY ys.year
      )
      SELECT
        ys.year,
        ys.total_donations,
        ys.total_donors,
        ys.avg_donation,
        ys.total_raised,
        CASE
          WHEN LAG(ys.total_raised) OVER (ORDER BY ys.year) IS NOT NULL
          THEN ((ys.total_raised - LAG(ys.total_raised) OVER (ORDER BY ys.year)) / LAG(ys.total_raised) OVER (ORDER BY ys.year)) * 100
          ELSE NULL
        END as growth_rate,
        CASE
          WHEN LAG(ys.total_donors) OVER (ORDER BY ys.year) IS NOT NULL
          THEN (rs.returning_donors::decimal / LAG(ys.total_donors) OVER (ORDER BY ys.year)) * 100
          ELSE NULL
        END as donor_retention_rate,
        rs.new_donors,
        rs.returning_donors,
        rs.lapsed_donors
      FROM yearly_stats ys
      LEFT JOIN retention_stats rs ON ys.year = rs.year
      ORDER BY ys.year DESC`;

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
        const typedRow = row as GivingTrendsRow;
        return {
          'Year': typedRow.year ? typedRow.year.toString() : '',
          'Total Donations': typedRow.total_donations ? typedRow.total_donations.toString() : '0',
          'Total Donors': typedRow.total_donors ? typedRow.total_donors.toString() : '0',
          'Average Donation': (parseFloat(typedRow.avg_donation?.toString() || '0')).toFixed(2),
          'Total Raised': (parseFloat(typedRow.total_raised?.toString() || '0')).toFixed(2),
          'Year-over-Year Growth Rate': typedRow.growth_rate ? typedRow.growth_rate.toFixed(2) + '%' : 'N/A',
          'Donor Retention Rate': typedRow.donor_retention_rate ? typedRow.donor_retention_rate.toFixed(2) + '%' : 'N/A',
          'New Donors': typedRow.new_donors ? typedRow.new_donors.toString() : '0',
          'Returning Donors': typedRow.returning_donors ? typedRow.returning_donors.toString() : '0',
          'Lapsed Donors': typedRow.lapsed_donors ? typedRow.lapsed_donors.toString() : '0',
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
      const typedRow = row as GivingTrendsRow;
      return {
        'Year': typedRow.year ? typedRow.year.toString() : '',
        'Total Donations': typedRow.total_donations ? typedRow.total_donations.toString() : '0',
        'Total Donors': typedRow.total_donors ? typedRow.total_donors.toString() : '0',
        'Average Donation': (parseFloat(typedRow.avg_donation?.toString() || '0')).toFixed(2),
        'Total Raised': (parseFloat(typedRow.total_raised?.toString() || '0')).toFixed(2),
        'Year-over-Year Growth Rate': typedRow.growth_rate ? typedRow.growth_rate.toFixed(2) + '%' : 'N/A',
        'Donor Retention Rate': typedRow.donor_retention_rate ? typedRow.donor_retention_rate.toFixed(2) + '%' : 'N/A',
        'New Donors': typedRow.new_donors ? typedRow.new_donors.toString() : '0',
        'Returning Donors': typedRow.returning_donors ? typedRow.returning_donors.toString() : '0',
        'Lapsed Donors': typedRow.lapsed_donors ? typedRow.lapsed_donors.toString() : '0',
      };
    });

    const csv = stringify(csvData, { header: true });

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="giving-trends-${reportType}-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });

  } catch (error) {
    console.error('Error generating giving trends report:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
