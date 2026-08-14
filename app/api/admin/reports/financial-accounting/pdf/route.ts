import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contact, payment, pledge, campaign, paymentAllocations, manualDonation } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { generateReportPDF, generateReportFilename } from '@/lib/pdf-report-generator';
import { getReportContext } from '@/lib/reports/guard';

interface FinancialAccountingRow {
  campaign_name: string | null;
  total_raised: number | null;
  donor_count: number | null;
  avg_gift: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_contribution: number | null;
  payment_date: Date | null;
}

export async function POST(request: NextRequest) {
  try {
    const { reportType, filters } = await request.json();
    const { campaignIds, year } = filters;

    // Phase-0 security hotfix: tenant scope comes from the SESSION, never
    // from the request body (super_admin may override).
    const guard = await getReportContext(filters?.locationId);
    if (guard.error) return guard.error;
    const safeLocationId = guard.ctx.locationId;

    // Escape single quotes to prevent SQL injection
    const escapeSql = (value: string) => value.replace(/'/g, "''");
    let campaignFilterSQL = '';

    // Handle multiple campaign IDs
    if (campaignIds && Array.isArray(campaignIds) && campaignIds.length > 0) {
      const safeCampaignIds = campaignIds.map(id => parseInt(id.toString(), 10)).filter(id => !isNaN(id));
      if (safeCampaignIds.length > 0) {
        // Get campaign names from IDs
        const campaignRecords = await db
          .select({ name: campaign.name })
          .from(campaign)
          .where(sql`${campaign.id} IN (${sql.join(safeCampaignIds, sql`, `)})`);

        const campaignNames = campaignRecords.map(c => `'${escapeSql(c.name)}'`);
        if (campaignNames.length > 0) {
          campaignFilterSQL = ` AND pl.campaign_code IN (${campaignNames.join(', ')})`;
        }
      }
    }

    // Base query for direct payments (non-split payments)
    let directPaymentsSQL = `
      SELECT
        pl.campaign_code,
        c.display_name as contact_name,
        c.email as contact_email,
        COALESCE(p.amount_usd, p.amount) as amount,
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

    // Apply campaign filter
    directPaymentsSQL += campaignFilterSQL;

    // Apply year filter
    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      directPaymentsSQL += ` AND EXTRACT(YEAR FROM p.payment_date) = ${safeYear}`;
    }

    // Query for split payments (payment allocations)
    let splitPaymentsSQL = `
      SELECT
        pl.campaign_code,
        c.display_name as contact_name,
        c.email as contact_email,
        COALESCE(pa.allocated_amount_usd, pa.allocated_amount) as amount,
        p.payment_date
      FROM payment_allocations pa
      INNER JOIN payment p ON pa.payment_id = p.id
      INNER JOIN pledge pl ON pa.pledge_id = pl.id
      INNER JOIN contact c ON pl.contact_id = c.id
      WHERE p.payment_status = 'completed'
        AND c.location_id = '${safeLocationId}'
        AND p.payment_date IS NOT NULL`;

    splitPaymentsSQL += campaignFilterSQL;

    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      splitPaymentsSQL += ` AND EXTRACT(YEAR FROM p.payment_date) = ${safeYear}`;
    }

    // Query for manual donations
    let manualDonationsSQL = `
      SELECT
        COALESCE(camp.name, md.campaign_id::text) as campaign_code,
        c.display_name as contact_name,
        c.email as contact_email,
        COALESCE(md.amount_usd, md.amount) as amount,
        md.payment_date
      FROM manual_donation md
      INNER JOIN contact c ON md.contact_id = c.id
      LEFT JOIN campaign camp ON md.campaign_id = camp.id
      WHERE c.location_id = '${safeLocationId}'
        AND md.payment_status = 'completed'
        AND md.payment_date IS NOT NULL`;

    // Apply campaign filter for manual donations
    if (campaignIds && Array.isArray(campaignIds) && campaignIds.length > 0) {
      const safeCampaignIds = campaignIds.map(id => parseInt(id.toString(), 10)).filter(id => !isNaN(id));
      if (safeCampaignIds.length > 0) {
        manualDonationsSQL += ` AND md.campaign_id IN (${safeCampaignIds.join(', ')})`;
      }
    }

    if (year) {
      const safeYear = parseInt(year.toString(), 10);
      manualDonationsSQL += ` AND EXTRACT(YEAR FROM md.payment_date) = ${safeYear}`;
    }

    // Combine all three queries
    const unionSQL = `(${directPaymentsSQL}) UNION ALL (${splitPaymentsSQL}) UNION ALL (${manualDonationsSQL})`;

    // Get campaign-level aggregates and donor details
    const querySQL = `
      WITH payment_data AS (
        ${unionSQL}
      ),
      campaign_totals AS (
        SELECT
          campaign_code,
          SUM(amount) as total_raised,
          COUNT(DISTINCT contact_name) as donor_count,
          AVG(amount) as avg_gift
        FROM payment_data
        GROUP BY campaign_code
      )
      SELECT
        pd.campaign_code,
        COALESCE(camp.name, pd.campaign_code) as campaign_name,
        ct.total_raised,
        ct.donor_count,
        ct.avg_gift,
        pd.contact_name,
        pd.contact_email,
        SUM(pd.amount) as contact_contribution,
        MAX(pd.payment_date) as payment_date
      FROM payment_data pd
      INNER JOIN campaign_totals ct ON pd.campaign_code = ct.campaign_code
      LEFT JOIN campaign camp ON pd.campaign_code = camp.name
      GROUP BY
        pd.campaign_code,
        camp.name,
        ct.total_raised,
        ct.donor_count,
        ct.avg_gift,
        pd.contact_name,
        pd.contact_email
      ORDER BY pd.campaign_code, pd.contact_name`;

    // Execute query
    const results = await db.execute(sql.raw(querySQL));
    const rows = (results as { rows: unknown[] }).rows || [];

    // Prepare PDF data
    const pdfData = rows.map((row: unknown) => {
      const typedRow = row as FinancialAccountingRow;
      return {
        'Campaign Name': typedRow.campaign_name || 'NA',
        'Total Raised': `$${parseFloat(typedRow.total_raised?.toString() || '0').toFixed(2)}`,
        'Donor Count': typedRow.donor_count?.toString() || '0',
        'Average Gift': `$${parseFloat(typedRow.avg_gift?.toString() || '0').toFixed(2)}`,
        'Contact Name': typedRow.contact_name || '',
        'Contact Email': typedRow.contact_email || '',
        'Contact Contribution': `$${parseFloat(typedRow.contact_contribution?.toString() || '0').toFixed(2)}`,
        'Last Payment Date': typedRow.payment_date
          ? new Date(typedRow.payment_date).toLocaleDateString()
          : '',
      };
    });

    // Generate PDF
    const subtitle = `Event-Based Year-End Giving Report${year ? ` - ${year}` : ''}`;
    const pdfBuffer = generateReportPDF({
      title: "Financial & Accounting Report",
      subtitle: subtitle,
      data: pdfData,
      filename: generateReportFilename("financial-accounting-event-based-year-end"),
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${generateReportFilename("financial-accounting-event-based-year-end")}"`,
      },
    });

  } catch (error) {
    console.error('Error generating financial accounting PDF:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
