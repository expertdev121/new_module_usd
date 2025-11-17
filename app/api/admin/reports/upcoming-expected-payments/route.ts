import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { pledge, contact, category, payment } from '@/lib/db/schema';
import { sql, eq, and, gt, exists, or } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';

interface UpcomingExpectedPaymentRow {
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
    console.log('\n\n========== UPCOMING EXPECTED PAYMENTS API START ==========');

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

    // DEBUG: Check what data exists
    console.log('[DEBUG] Checking pledges with balance > 0...');
    const debugPledges = await db
      .select({
        id: pledge.id,
        balance: pledge.balance,
        contactId: pledge.contactId,
      })
      .from(pledge)
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(
        eq(contact.locationId, locationId),
        eq(pledge.isActive, true),
        sql`${pledge.balance}::numeric > 0`
      ))
      .limit(5);
    console.log('[DEBUG] Pledges with balance > 0:', debugPledges.length, debugPledges);

    console.log('[DEBUG] Checking payments with method = Credit Card...');
    const debugPayments = await db
      .select({
        id: payment.id,
        pledgeId: payment.pledgeId,
        paymentMethod: payment.paymentMethod,
        paymentStatus: payment.paymentStatus,
      })
      .from(payment)
      .where(and(
        eq(payment.paymentMethod, 'Credit Card'),
        eq(payment.paymentStatus, 'completed')
      ))
      .limit(5);
    console.log('[DEBUG] Payments with Credit Card method:', debugPayments.length, debugPayments);

    console.log('[DEBUG] Checking all payment methods...');
    const allPaymentMethods = await db
      .select({
        paymentMethod: payment.paymentMethod,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(payment)
      .groupBy(payment.paymentMethod);
    console.log('[DEBUG] All payment methods:', allPaymentMethods);

    // Build the main query for upcoming expected payments:
    // - Pledges with balance > 0
    // - Where at least one payment was made by Credit Card
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
        sql`${pledge.balance}::numeric > 0`,
        // Filter: pledges that have at least one Credit Card payment
        exists(
          db
            .select()
            .from(payment)
            .where(and(
              eq(payment.pledgeId, pledge.id),
              eq(payment.paymentMethod, 'Credit Card'),
              eq(payment.paymentStatus, 'completed')
            ))
        )
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
        sql`${pledge.balance}::numeric > 0`,
        // Filter: pledges that have at least one Credit Card payment
        exists(
          db
            .select()
            .from(payment)
            .where(and(
              eq(payment.pledgeId, pledge.id),
              eq(payment.paymentMethod, 'Credit Card'),
              eq(payment.paymentStatus, 'completed')
            ))
        )
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
      const previewData = results.map((row: UpcomingExpectedPaymentRow) => {
        return {
          'Contact Display Name': `${row.contactFirstName || ''} ${row.contactLastName || ''}`.trim() || 'Unknown',
          'Email': row.email || '',
          'Phone': row.phone || '',
          'Pledge Date': row.pledgeDate ? new Date(row.pledgeDate).toLocaleDateString('en-US') : '',
          'Description': row.description || '',
          'Amount Pledged': `$${parseFloat(row.originalAmount || '0').toFixed(2)} ${row.currency}`,
          'Amount Paid': `$${parseFloat(row.totalPaid || '0').toFixed(2)} ${row.currency}`,
          'Expected Payment Amount': `$${parseFloat(row.balance || '0').toFixed(2)} ${row.currency}`,
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
      console.log('========== UPCOMING EXPECTED PAYMENTS API END ==========\n');

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
        sql`${pledge.balance}::numeric > 0`,
        // Filter: pledges that have at least one Credit Card payment
        exists(
          db
            .select()
            .from(payment)
            .where(and(
              eq(payment.pledgeId, pledge.id),
              eq(payment.paymentMethod, 'Credit Card'),
              eq(payment.paymentStatus, 'completed')
            ))
        )
      ))
      .orderBy(sql`${pledge.pledgeDate} DESC`, sql`${contact.lastName} ASC`, sql`${contact.firstName} ASC`);

    const csvResults = await csvQuery.execute();

    console.log('[8-CSV] Total rows for CSV:', csvResults.length);

    const csvData = csvResults.map((row: UpcomingExpectedPaymentRow) => {
      return {
        'Contact Display Name': `${row.contactFirstName || ''} ${row.contactLastName || ''}`.trim() || 'Unknown',
        'Email': row.email || '',
        'Phone': row.phone || '',
        'Pledge Date': row.pledgeDate ? new Date(row.pledgeDate).toLocaleDateString('en-US') : '',
        'Description': row.description || '',
        'Amount Pledged': `$${parseFloat(row.originalAmount || '0').toFixed(2)} ${row.currency}`,
        'Amount Paid': `$${parseFloat(row.totalPaid || '0').toFixed(2)} ${row.currency}`,
        'Expected Payment Amount': `$${parseFloat(row.balance || '0').toFixed(2)} ${row.currency}`,
        'Category': row.categoryName || '',
        'Campaign Code': row.campaignCode || '',
        'Pledge ID': row.pledgeId.toString(),
      };
    });

    const csv = stringify(csvData, { header: true });

    console.log('[8-CSV] CSV generated successfully');
    console.log('========== UPCOMING EXPECTED PAYMENTS API END ==========\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="upcoming-expected-payments-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });

  } catch (error) {
    console.error('\n========== UPCOMING EXPECTED PAYMENTS API ERROR ==========');
    console.error('[ERROR] Full error:', error);
    console.error('[ERROR] Stack:', error instanceof Error ? error.stack : 'No stack');
    console.error('========== UPCOMING EXPECTED PAYMENTS API ERROR END ==========\n');
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
