  import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';

export async function POST(request: NextRequest) {
  try {
    console.log('\n\n========== QUICKBOOK REPORT API START ==========');

    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { filters, preview, page = 1, pageSize = 10 } = await request.json();
    const { locationId, startDate, endDate, contactIds, campaigns } = filters || {};
    const size = parseInt(pageSize, 10) || 10;
    const pageNum = parseInt(page, 10) || 1;
    const offset = (pageNum - 1) * size;

    // Escape single quotes for raw SQL
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

    // Date defaults
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

    const baseSelectSQL = `
      SELECT 
        r.id as payment_id,
        r.ghl_contact_id,
        r.email,
        r.display_name,
        r.first_name,
        r.last_name,
        COALESCE(r.campaign_name, '') as campaign,
        r.received_date as received_date,
        r.amount,
        r.currency,
        r.payment_method,
        COALESCE(cat.name, '') as category
      FROM (${unionSQL}) r 
      LEFT JOIN category cat ON cat.id = r.category_id
      ${filterWhereSQL}
    `;

    // COUNT query - matches main query with name/campaign filters
    const countQuerySQL = `
      SELECT count(*)
      FROM (${baseSelectSQL}) qb
    `;
    const countResult = await db.execute(sql.raw(countQuerySQL));
    const countRow = countResult.rows[0];
    const totalRecords = Number((countRow as any)?.count || 0);
    const totalPages = Math.ceil(totalRecords / size);

    if (preview) {
      const querySQL = `
        ${baseSelectSQL}
        ORDER BY received_date DESC NULLS LAST, 
                 last_name NULLS LAST, first_name NULLS LAST, payment_id DESC
        LIMIT ${size} OFFSET ${offset}
      `;
      const results = await db.execute(sql.raw(querySQL));

      const resultRows = results.rows || results || [];
      const previewData = resultRows.map(row => ({
        'GHL Contact ID': row.ghl_contact_id || '',
        'Email': row.email || '',
        'Display Name': row.display_name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || '',
        'First Name': row.first_name || '',
        'Last Name': row.last_name || '',
        'Campaign': row.campaign || '',
        'Received Date': row.received_date
          ? new Date(row.received_date as string).toLocaleDateString('en-US') : '',
        'Amount': `${row.currency} ${parseFloat(String(row.amount || '0')).toFixed(2)}`,
        'Method': row.payment_method || '',
        'Category': row.category || '',
      }));

      return NextResponse.json({
        data: previewData,
        total: totalRecords,
        page: pageNum,
        pageSize: size,
        totalPages,
      });
    }

    // Full CSV export - REUSE same fixed query (no LIMIT)
    const csvQuerySQL = `
        ${baseSelectSQL}
        ORDER BY received_date DESC NULLS LAST, 
                 last_name NULLS LAST, first_name NULLS LAST, payment_id DESC
      `;
    const csvResults = await db.execute(sql.raw(csvQuerySQL));

    const csvResultRows = csvResults.rows || csvResults || [];
    const csvData = csvResultRows.map(row => ({
      'GHL Contact ID': row.ghl_contact_id || '',
      'Email': row.email || '',
      'Display Name': row.display_name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || '',
      'First Name': row.first_name || '',
      'Last Name': row.last_name || '',
      'Campaign': row.campaign || '',
      'Received Date': row.received_date
        ? new Date(row.received_date as string).toLocaleDateString('en-US') : '',
      'Amount': `${row.currency} ${parseFloat(String(row.amount || '0')).toFixed(2)}`,
      'Method': row.payment_method || '',
      'Category': row.category || '',
    }));

    const csv = stringify(csvData, { header: true });

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="quickbook-transactions-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });

  } catch (error) {
    console.error('QUICKBOOK API ERROR:', error);
    return NextResponse.json({ error: 'Server error', details: (error as Error).message }, { status: 500 });
  }
}

