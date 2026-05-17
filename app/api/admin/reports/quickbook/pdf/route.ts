import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { generateReportPDF, generateReportFilename } from '@/lib/pdf-report-generator';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin' && session.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { filters } = await request.json();
    const { locationId, startDate, endDate, contactIds, campaigns } = filters || {};

    const escapeSql = (value: string) => value.replace(/'/g, "''");
    const safeLocationId = locationId ? escapeSql(locationId) : '';
    const safeContactIds = Array.isArray(contactIds)
      ? contactIds.map((id: unknown) => parseInt(String(id), 10)).filter((id: number) => !Number.isNaN(id))
      : [];
    const safeCampaigns = Array.isArray(campaigns)
      ? campaigns
          .map((value: unknown) => String(value).trim())
          .filter(Boolean)
          .map(escapeSql)
      : [];
    const startDateStr = startDate || '';
    const endDateStr = endDate || '';

    const paymentsSQL = `
      SELECT 
        p.id,
        COALESCE(p.payer_contact_id, pl.contact_id, 0) as contact_id,
        c.ghl_contact_id,
        c.email,
        p.received_date,
        p.amount,
        p.currency,
        p.payment_method,
        pl.category_id,
        COALESCE(camp.name, pl.campaign_code, '') as campaign_name,
        c.first_name,
        c.last_name,
        c.display_name
      FROM payment p 
      LEFT JOIN pledge pl ON p.pledge_id = pl.id
      LEFT JOIN campaign camp ON pl.campaign_code = camp.name
      INNER JOIN contact c ON c.id = COALESCE(p.payer_contact_id, pl.contact_id, 0)
      WHERE p.payment_status = 'completed' 
        AND c.location_id = '${safeLocationId}'
        ${startDateStr ? `AND date_trunc('day', p.received_date) BETWEEN '${startDateStr}'::date AND '${endDateStr}'::date` : ''}
    `;

    const manualSQL = `
      SELECT 
        md.id,
        md.contact_id as contact_id,
        c.ghl_contact_id,
        c.email,
        md.received_date,
        md.amount,
        md.currency,
        md.payment_method,
        md.category_id,
        COALESCE(camp.name, '') as campaign_name,
        c.first_name,
        c.last_name,
        c.display_name
      FROM manual_donation md
      INNER JOIN contact c ON md.contact_id = c.id
      LEFT JOIN campaign camp ON md.campaign_id = camp.id
      WHERE md.payment_status = 'completed' 
        AND c.location_id = '${safeLocationId}'
        ${startDateStr ? `AND date_trunc('day', md.received_date) BETWEEN '${startDateStr}'::date AND '${endDateStr}'::date` : ''}
    `;

    const unionSQL = paymentsSQL + ' UNION ALL ' + manualSQL;

    const whereClauses: string[] = [];
    if (safeContactIds.length > 0) {
      whereClauses.push(`r.contact_id IN (${safeContactIds.join(', ')})`);
    }
    if (safeCampaigns.length > 0) {
      whereClauses.push(`r.campaign_name IN (${safeCampaigns.map((value) => `'${value}'`).join(', ')})`);
    }
    const filterWhereSQL = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const querySQL = `
      SELECT 
        r.ghl_contact_id,
        r.email,
        r.display_name,
        r.first_name,
        r.last_name,
        COALESCE(r.campaign_name, '') as campaign,
        r.received_date,
        r.amount,
        r.currency,
        r.payment_method,
        COALESCE(cat.name, '') as category
      FROM (${unionSQL}) r
      LEFT JOIN category cat ON cat.id = r.category_id
      ${filterWhereSQL}
      ORDER BY r.received_date DESC NULLS LAST,
               r.last_name NULLS LAST, r.first_name NULLS LAST, r.id DESC
    `;

    const results = await db.execute(sql.raw(querySQL));
    const rows = results.rows || results || [];

    const pdfData = rows.map(row => ({
      'GHL Contact ID': String(row.ghl_contact_id || ''),
      'Email': String(row.email || ''),
      'Display Name': String(row.display_name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || ''),
      'First Name': String(row.first_name || ''),
      'Last Name': String(row.last_name || ''),
      'Campaign': String(row.campaign || ''),
      'Received Date': row.received_date
        ? new Date(row.received_date as string).toLocaleDateString('en-US')
        : '',
      'Amount': `${row.currency} ${parseFloat(String(row.amount || '0')).toFixed(2)}`,
      'Method': String(row.payment_method || ''),
      'Category': String(row.category || ''),
    }));

    const pdfBuffer = generateReportPDF({
      title: 'Quickbook Report',
      subtitle: 'Quickbook Transactions Report',
      data: pdfData,
      filename: generateReportFilename('quickbook-report'),
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${generateReportFilename('quickbook-report')}"`,
      },
    });
  } catch (error) {
    console.error('Error generating quickbook PDF:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
