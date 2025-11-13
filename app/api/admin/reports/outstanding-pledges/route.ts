import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { pledge, contact, category } from '@/lib/db/schema';
import { sql, eq, and, gt } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';

interface OutstandingPledgeRow {
  pledgeId: number;
  contactId: number;
  contactFirstName: string | null;
  contactLastName: string | null;
  email: string | null;
  phone: string | null;
  pledgeDate: string;
  description: string | null;
  originalAmount: string;
  currency: string;
  totalPaid: string;
  balance: string;
  categoryName: string | null;
  campaignCode: string | null;
}

export async function POST(request: NextRequest) {
  try {
    console.log('\n\n========== OUTSTANDING PLEDGES API START ==========');

    const session = await getServerSession(authOptions);
    console.log('[1-SESSION] User role:', session?.user?.role);

    if (!session || session.user.role !== 'admin') {
      console.log('[1-AUTH] UNAUTHORIZED - redirecting');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request and log
    const rawBody = await request.json();
    console.log('[2-REQUEST] Full body:', JSON.stringify(rawBody, null, 2));

    const { filters, preview, page = 1, pageSize = 10 } = rawBody;
    console.log('[2-FILTERS] Filters object:', JSON.stringify(filters, null, 2));

    const { locationId } = filters;

    console.log('[3-LOCATION] locationId:', locationId);

    // Build the main query for outstanding pledges (balance > 0)
    const baseQuery = db
      .select({
        pledgeId: pledge.id,
        contactId: pledge.contactId,
        contactFirstName: contact.firstName,
        contactLastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        pledgeDate: pledge.pledgeDate,
        description: pledge.description,
        originalAmount: pledge.originalAmount,
        currency: pledge.currency,
        totalPaid: pledge.totalPaid,
        balance: pledge.balance,
        categoryName: category.name,
        campaignCode: pledge.campaignCode,
      })
      .from(pledge)
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .leftJoin(category, eq(pledge.categoryId, category.id))
      .where(and(
        eq(contact.locationId, locationId),
        eq(pledge.isActive, true),
        sql`${pledge.balance}::numeric > 0`
      ));

    // Get total count
    const countQuery = db
      .select({
        count: sql<number>`count(*)`.as("count"),
      })
      .from(pledge)
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(
        eq(contact.locationId, locationId),
        eq(pledge.isActive, true),
        sql`${pledge.balance}::numeric > 0`
      ));

    console.log('[4-COUNT_QUERY] Executing count query...');
    const countResult = await countQuery.execute();
    const totalRecords = countResult[0]?.count || 0;

    // Parse pagination parameters
    const pageNum = parseInt(page.toString(), 10) || 1;
    const size = parseInt(pageSize.toString(), 10) || 10;
    const offset = (pageNum - 1) * size;
    const totalPages = Math.ceil(totalRecords / size);

    console.log('[4-COUNT_RESULT] totalRecords:', totalRecords);
    console.log('[5-PAGINATION-PARSED] pageNum:', pageNum, 'size:', size, 'offset:', offset);
    console.log('[5-PAGINATION-CALC] totalPages:', totalPages);

    // Get paginated results
    const paginatedQuery = baseQuery
      .orderBy(sql`${pledge.pledgeDate} DESC`, sql`${contact.lastName} ASC`, sql`${contact.firstName} ASC`)
      .limit(size)
      .offset(offset);

    console.log('[6-DATA_QUERY] Executing paginated query...');
    const results = await paginatedQuery.execute();

    console.log('[6-DATA_RESULT] Rows returned from DB:', results.length);

    // For preview, return JSON data
    if (preview) {
      const previewData = results.map((row: OutstandingPledgeRow) => {
        return {
          'Contact First Name': row.contactFirstName || '',
          'Contact Last Name': row.contactLastName || '',
          'Email': row.email || '',
          'Phone': row.phone || '',
          'Pledge Date': row.pledgeDate ? new Date(row.pledgeDate).toLocaleDateString('en-US') : '',
          'Description': row.description || '',
          'Amount Pledged': `$${parseFloat(row.originalAmount || '0').toFixed(2)} ${row.currency}`,
          'Amount Paid': `$${parseFloat(row.totalPaid || '0').toFixed(2)} ${row.currency}`,
          'Amount Remaining': `$${parseFloat(row.balance || '0').toFixed(2)} ${row.currency}`,
          'Category': row.categoryName || '',
          'Campaign Code': row.campaignCode || '',
          'Pledge ID': row.pledgeId.toString(),
        };
      });

      const responseData = {
        data: previewData,
        total: totalRecords,
        page: pageNum,
        pageSize: size,
        totalPages: totalPages
      };

      console.log('[7-RESPONSE] Sending response with pageNum:', pageNum, 'pageSize:', size, 'rowCount:', previewData.length);
      console.log('========== OUTSTANDING PLEDGES API END ==========\n');

      return NextResponse.json(responseData);
    }

    // Generate CSV (return all data, not paginated)
    console.log('[8-CSV] Generating full dataset CSV...');
    const csvQuery = db
      .select({
        pledgeId: pledge.id,
        contactId: pledge.contactId,
        contactFirstName: contact.firstName,
        contactLastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        pledgeDate: pledge.pledgeDate,
        description: pledge.description,
        originalAmount: pledge.originalAmount,
        currency: pledge.currency,
        totalPaid: pledge.totalPaid,
        balance: pledge.balance,
        categoryName: category.name,
        campaignCode: pledge.campaignCode,
      })
      .from(pledge)
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .leftJoin(category, eq(pledge.categoryId, category.id))
      .where(and(
        eq(contact.locationId, locationId),
        eq(pledge.isActive, true),
        sql`${pledge.balance}::numeric > 0`
      ))
      .orderBy(sql`${pledge.pledgeDate} DESC`, sql`${contact.lastName} ASC`, sql`${contact.firstName} ASC`);

    const csvResults = await csvQuery.execute();

    console.log('[8-CSV] Total rows for CSV:', csvResults.length);

    const csvData = csvResults.map((row: OutstandingPledgeRow) => {
      return {
        'Contact First Name': row.contactFirstName || '',
        'Contact Last Name': row.contactLastName || '',
        'Email': row.email || '',
        'Phone': row.phone || '',
        'Pledge Date': row.pledgeDate ? new Date(row.pledgeDate).toLocaleDateString('en-US') : '',
        'Description': row.description || '',
        'Amount Pledged': `$${parseFloat(row.originalAmount || '0').toFixed(2)} ${row.currency}`,
        'Amount Paid': `$${parseFloat(row.totalPaid || '0').toFixed(2)} ${row.currency}`,
        'Amount Remaining': `$${parseFloat(row.balance || '0').toFixed(2)} ${row.currency}`,
        'Category': row.categoryName || '',
        'Campaign Code': row.campaignCode || '',
        'Pledge ID': row.pledgeId.toString(),
      };
    });

    const csv = stringify(csvData, { header: true });

    console.log('[8-CSV] CSV generated successfully');
    console.log('========== OUTSTANDING PLEDGES API END ==========\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="outstanding-pledges-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });

  } catch (error) {
    console.error('\n========== OUTSTANDING PLEDGES API ERROR ==========');
    console.error('[ERROR] Full error:', error);
    console.error('[ERROR] Stack:', error instanceof Error ? error.stack : 'No stack');
    console.error('========== OUTSTANDING PLEDGES API ERROR END ==========\n');
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
