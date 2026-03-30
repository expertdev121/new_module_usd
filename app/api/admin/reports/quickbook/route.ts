  import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { payment, manualDonation, pledge, contact, category, campaign } from '@/lib/db/schema';
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
    const { locationId, startDate, endDate } = filters || {};
    const size = parseInt(pageSize, 10) || 10;
    const pageNum = parseInt(page, 10) || 1;
    const offset = (pageNum - 1) * size;

    // Date defaults
    const minDate = '1900-01-01';
    const maxDate = '2100-01-01';
    const startDateStr = startDate ?? minDate;
    const endDateStr = endDate ?? maxDate;
    // Separate date conditions for main queries and COUNT (avoids SQL<unknown>.replace TypeScript error)
    const mainDateCond = startDate || endDate
      ? sql`AND date_trunc('day', COALESCE(r.received_date)) BETWEEN ${startDateStr}::date AND ${endDateStr}::date`
      : sql``;

    const paymentDateCond = startDate || endDate
      ? sql`AND date_trunc('day', p.received_date) BETWEEN ${startDateStr}::date AND ${endDateStr}::date`
      : sql``;

    const manualDateCond = startDate || endDate
      ? sql`AND date_trunc('day', md.received_date) BETWEEN ${startDateStr}::date AND ${endDateStr}::date`
      : sql``;

    // COUNT query - match main query structure
    const countQuery = sql`
      SELECT count(*)
      FROM (
        -- Payments
        SELECT 1
        FROM payment p 
        LEFT JOIN pledge pl ON p.pledge_id = pl.id
        INNER JOIN contact c ON c.id = COALESCE(p.payer_contact_id, pl.contact_id, 0) AND c.location_id = ${locationId}
        WHERE p.payment_status = 'completed' ${paymentDateCond}
        
        UNION ALL
        
        -- Manual donations
        SELECT 1
        FROM manual_donation md
        INNER JOIN contact c ON c.id = md.contact_id AND c.location_id = ${locationId}
        WHERE md.payment_status = 'completed' ${manualDateCond}
      ) t
    `;
    const countResult = await db.execute(countQuery);
    const countRow = countResult.rows[0];
    const totalRecords = Number(countRow?.count || 0);
    const totalPages = Math.ceil(totalRecords / size);

    if (preview) {
      // Preview - paginated using raw SQL UNION (fixed joins inside subquery)
      // FIXED Preview query - unified structure
      const query = sql`
        SELECT 
          r.id as payment_id,
          c.ghl_contact_id,
          c.display_name,
          c.first_name,
          c.last_name,
          COALESCE(cam.name, '') as campaign,
          COALESCE(r.received_date) as received_date,
          r.amount,
          r.currency,
          r.payment_method,
          COALESCE(cat.name, '') as category
        FROM (
          -- Payments: select exact matching columns
          SELECT 
            p.id,
            COALESCE(p.payer_contact_id, pl.contact_id, 0) as contact_id,
            p.received_date,
            p.amount,
            p.currency,
            p.payment_method,
            pl.category_id,
            pl.campaign_code
          FROM payment p 
          LEFT JOIN pledge pl ON p.pledge_id = pl.id
          WHERE p.payment_status = 'completed' ${paymentDateCond}
          
          UNION ALL
          
          -- Manual donations: matching columns
          SELECT 
            md.id,
            md.contact_id as contact_id,
            md.received_date,
            md.amount,
            md.currency,
            md.payment_method,
            md.category_id,
            NULL::text as campaign_code
          FROM manual_donation md
          WHERE md.payment_status = 'completed' ${manualDateCond}
        ) r 
        INNER JOIN contact c ON c.id = r.contact_id AND c.location_id = ${locationId}
        LEFT JOIN category cat ON cat.id = r.category_id
        LEFT JOIN campaign cam ON cam.name ILIKE '%' || COALESCE(r.campaign_code, '')
        ORDER BY COALESCE(r.received_date) DESC NULLS LAST, 
                 c.last_name NULLS LAST, c.first_name NULLS LAST, r.id DESC
        LIMIT ${size} OFFSET ${offset}
      `;
      const results = await db.execute(query);

      const resultRows = results.rows || results || [];
      const previewData = resultRows.map(row => ({
        'GHL Contact ID': row.ghl_contact_id || '',
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
    const csvQuery = sql`
        SELECT 
          r.id as payment_id,
          c.ghl_contact_id,
          c.display_name,
          c.first_name,
          c.last_name,
          COALESCE(cam.name, '') as campaign,
          COALESCE(r.received_date) as received_date,
          r.amount,
          r.currency,
          r.payment_method,
          COALESCE(cat.name, '') as category
        FROM (
          -- Payments: select exact matching columns
          SELECT 
            p.id,
            COALESCE(p.payer_contact_id, pl.contact_id, 0) as contact_id,
            p.received_date,
            p.amount,
            p.currency,
            p.payment_method,
            pl.category_id,
            pl.campaign_code
          FROM payment p 
          LEFT JOIN pledge pl ON p.pledge_id = pl.id
          WHERE p.payment_status = 'completed' ${mainDateCond}
          
          UNION ALL
          
          -- Manual donations: matching columns
          SELECT 
            md.id,
            md.contact_id as contact_id,
            md.received_date,
            md.amount,
            md.currency,
            md.payment_method,
            md.category_id,
            NULL::text as campaign_code
          FROM manual_donation md
          WHERE md.payment_status = 'completed' ${mainDateCond}
        ) r 
        INNER JOIN contact c ON c.id = r.contact_id AND c.location_id = ${locationId}
        LEFT JOIN category cat ON cat.id = r.category_id
        LEFT JOIN campaign cam ON cam.name ILIKE '%' || COALESCE(r.campaign_code, '')
        ORDER BY COALESCE(r.received_date) DESC NULLS LAST, 
                 c.last_name NULLS LAST, c.first_name NULLS LAST, r.id DESC
      `;
    const csvResults = await db.execute(csvQuery);

    const csvResultRows = csvResults.rows || csvResults || [];
    const csvData = csvResultRows.map(row => ({
      'GHL Contact ID': row.ghl_contact_id || '',
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

