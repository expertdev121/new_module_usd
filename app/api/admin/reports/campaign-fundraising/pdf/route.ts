import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contact, payment, pledge, campaign, paymentAllocations, manualDonation } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { generateReportPDF, generateReportFilename } from '@/lib/pdf-report-generator';
import { getReportContext } from '@/lib/reports/guard';

interface CampaignFundraisingRow {
  campaign_code: string | null;
  campaign_name: string | null;
  donor_id: number | null;
  donor_first_name: string | null;
  donor_last_name: string | null;
  donor_email: string | null;
  donor_phone: string | null;
  donor_address: string | null;
  donor_contribution: number | null;
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
        c.id as donor_id,
        c.first_name as donor_first_name,
        c.last_name as donor_last_name,
        c.email as donor_email,
        c.phone as donor_phone,
        c.address as donor_address,
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
        c.id as donor_id,
        c.first_name as donor_first_name,
        c.last_name as donor_last_name,
        c.email as donor_email,
        c.phone as donor_phone,
        c.address as donor_address,
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
        c.id as donor_id,
        c.first_name as donor_first_name,
        c.last_name as donor_last_name,
        c.email as donor_email,
        c.phone as donor_phone,
        c.address as donor_address,
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

    // Get donor details
    const querySQL = `
      WITH payment_data AS (
        ${unionSQL}
      )
      SELECT
        pd.campaign_code,
        COALESCE(camp.name, pd.campaign_code) as campaign_name,
        pd.donor_id,
        pd.donor_first_name,
        pd.donor_last_name,
        pd.donor_email,
        pd.donor_phone,
        pd.donor_address,
        SUM(pd.amount) as donor_contribution
      FROM payment_data pd
      LEFT JOIN campaign camp ON pd.campaign_code = camp.name
      GROUP BY
        pd.campaign_code,
        camp.name,
        pd.donor_id,
        pd.donor_first_name,
        pd.donor_last_name,
        pd.donor_email,
        pd.donor_phone,
        pd.donor_address
      ORDER BY pd.campaign_code, pd.donor_last_name, pd.donor_first_name`;

    // Execute query
    const results = await db.execute(sql.raw(querySQL));
    const rows = (results as { rows: unknown[] }).rows || [];

    // Prepare PDF data
    const pdfData = rows.map((row: unknown) => {
      const typedRow = row as CampaignFundraisingRow;
      return {
        'Campaign Name': typedRow.campaign_name || typedRow.campaign_code || 'NA',
        'Donor First Name': typedRow.donor_first_name || '',
        'Donor Last Name': typedRow.donor_last_name || '',
        'Donor Email': typedRow.donor_email || '',
        'Donor Phone': typedRow.donor_phone || '',
        'Donor Address': typedRow.donor_address || '',
        'Donor Total Contribution': (parseFloat(typedRow.donor_contribution?.toString() || '0')).toFixed(2),
      };
    });

    // Generate PDF
    const pdfBuffer = generateReportPDF({
      title: "Campaign & Fundraising Report",
      subtitle: `Event-Specific Fundraising Report${year ? ` - ${year}` : ''}`,
      data: pdfData,
      filename: generateReportFilename("campaign-fundraising-event-specific"),
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${generateReportFilename("campaign-fundraising-event-specific")}"`,
      },
    });

  } catch (error) {
    console.error('Error generating campaign fundraising PDF:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
