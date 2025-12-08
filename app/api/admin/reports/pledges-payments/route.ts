import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { pledge, contact, category, payment } from '@/lib/db/schema';
import { sql, eq, and, or, like } from 'drizzle-orm';
import { stringify } from 'csv-stringify/sync';

interface PledgesPaymentsRow {
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
  paymentId: number | null;
  paymentDate: string | null;
  paymentAmount: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
}

export async function POST(request: NextRequest) {
  try {
    console.log('\n\n========== PLEDGES PAYMENTS API START ==========');

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

    const { locationId, categoryFilter } = filters;

    console.log('[3-LOCATION] locationId:', locationId);
    console.log('[3-FILTERS] categoryFilter:', categoryFilter);

    // Build the main query for pledges with payments
    let whereConditions = [
      eq(contact.locationId, locationId),
      eq(pledge.isActive, true)
    ];

    if (categoryFilter && categoryFilter !== 'all') {
      whereConditions.push(eq(category.name, categoryFilter));
    }

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
        paymentId: payment.id,
        paymentDate: payment.paymentDate,
        paymentAmount: payment.amount,
        paymentMethod: payment.paymentMethod,
        paymentStatus: payment.paymentStatus,
      })
      .from(pledge)
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .leftJoin(category, eq(pledge.categoryId, category.id))
      .leftJoin(payment, eq(pledge.id, payment.pledgeId))
      .where(and(...whereConditions));

    // Get total count (count distinct pledges)
    const countQuery = db
      .select({
        count: sql<number>`count(distinct ${pledge.id})`.as("count"),
      })
      .from(pledge)
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .leftJoin(category, eq(pledge.categoryId, category.id))
      .where(and(...whereConditions));

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

    // Group results by pledge for preview
    const pledgeGroups = new Map<number, {
      pledge: any;
      payments: any[];
    }>();

    results.forEach((row: PledgesPaymentsRow) => {
      if (!pledgeGroups.has(row.pledgeId)) {
        pledgeGroups.set(row.pledgeId, {
          pledge: {
            pledgeId: row.pledgeId,
            contactId: row.contactId,
            contactFirstName: row.contactFirstName,
            contactLastName: row.contactLastName,
            email: row.email,
            phone: row.phone,
            pledgeDate: row.pledgeDate,
            description: row.description,
            originalAmount: row.originalAmount,
            currency: row.currency,
            totalPaid: row.totalPaid,
            balance: row.balance,
            categoryName: row.categoryName,
            campaignCode: row.campaignCode,
          },
          payments: []
        });
      }

      if (row.paymentId) {
        pledgeGroups.get(row.pledgeId)!.payments.push({
          paymentId: row.paymentId,
          paymentDate: row.paymentDate,
          paymentAmount: row.paymentAmount,
          paymentMethod: row.paymentMethod,
          paymentStatus: row.paymentStatus,
        });
      }
    });

    // For preview, return JSON data - one row per pledge
    if (preview) {
      const previewData: any[] = [];

      pledgeGroups.forEach(({ pledge, payments }) => {
        // Calculate total paid amount from all payments
        const totalPaidAmount = payments.reduce((sum, payment) => {
          return sum + parseFloat(payment.paymentAmount || '0');
        }, 0);

        // Add single row per pledge
        previewData.push({
          'Contact First Name': pledge.contactFirstName || '',
          'Contact Last Name': pledge.contactLastName || '',
          'Email': pledge.email || '',
          'Phone': pledge.phone || '',
          'Donation Date': pledge.pledgeDate ? new Date(pledge.pledgeDate).toLocaleDateString('en-US') : '',
          'Description': pledge.description || '',
          'Amount Paid': `$${totalPaidAmount.toFixed(2)}`,
          'Category': pledge.categoryName || '',
          'Campaign Code': pledge.campaignCode || '',
        });
      });

      const responseData = {
        data: previewData,
        total: totalRecords,
        page: pageNum,
        pageSize: size,
        totalPages: totalPages
      };

      console.log('[7-RESPONSE] Sending response with pageNum:', pageNum, 'pageSize:', size, 'rowCount:', previewData.length);
      console.log('========== PLEDGES PAYMENTS API END ==========\n');

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
        paymentId: payment.id,
        paymentDate: payment.paymentDate,
        paymentAmount: payment.amount,
        paymentMethod: payment.paymentMethod,
        paymentStatus: payment.paymentStatus,
      })
      .from(pledge)
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .leftJoin(category, eq(pledge.categoryId, category.id))
      .leftJoin(payment, eq(pledge.id, payment.pledgeId))
      .where(and(...whereConditions))
      .orderBy(sql`${pledge.pledgeDate} DESC`, sql`${contact.lastName} ASC`, sql`${contact.firstName} ASC`);

    const csvResults = await csvQuery.execute();

    console.log('[8-CSV] Total rows for CSV:', csvResults.length);

    // Group CSV results by pledge
    const csvPledgeGroups = new Map<number, {
      pledge: any;
      payments: any[];
    }>();

    csvResults.forEach((row: PledgesPaymentsRow) => {
      if (!csvPledgeGroups.has(row.pledgeId)) {
        csvPledgeGroups.set(row.pledgeId, {
          pledge: {
            pledgeId: row.pledgeId,
            contactId: row.contactId,
            contactFirstName: row.contactFirstName,
            contactLastName: row.contactLastName,
            email: row.email,
            phone: row.phone,
            pledgeDate: row.pledgeDate,
            description: row.description,
            originalAmount: row.originalAmount,
            currency: row.currency,
            totalPaid: row.totalPaid,
            balance: row.balance,
            categoryName: row.categoryName,
            campaignCode: row.campaignCode,
          },
          payments: []
        });
      }

      if (row.paymentId) {
        csvPledgeGroups.get(row.pledgeId)!.payments.push({
          paymentId: row.paymentId,
          paymentDate: row.paymentDate,
          paymentAmount: row.paymentAmount,
          paymentMethod: row.paymentMethod,
          paymentStatus: row.paymentStatus,
        });
      }
    });

    const csvData: any[] = [];

    csvPledgeGroups.forEach(({ pledge, payments }) => {
      // Calculate total paid amount from all payments
      const totalPaidAmount = payments.reduce((sum, payment) => {
        return sum + parseFloat(payment.paymentAmount || '0');
      }, 0);

      // Add single row per pledge
      csvData.push({
        'Contact First Name': pledge.contactFirstName || '',
        'Contact Last Name': pledge.contactLastName || '',
        'Email': pledge.email || '',
        'Phone': pledge.phone || '',
        'Donation Date': pledge.pledgeDate ? new Date(pledge.pledgeDate).toLocaleDateString('en-US') : '',
        'Description': pledge.description || '',
        'Amount Paid': `$${totalPaidAmount.toFixed(2)}`,
        'Category': pledge.categoryName || '',
        'Campaign Code': pledge.campaignCode || '',
      });
    });

    const csv = stringify(csvData, { header: true });

    console.log('[8-CSV] CSV generated successfully');
    console.log('========== PLEDGES PAYMENTS API END ==========\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="pledges-payments-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });

  } catch (error) {
    console.error('\n========== PLEDGES PAYMENTS API ERROR ==========');
    console.error('[ERROR] Full error:', error);
    console.error('[ERROR] Stack:', error instanceof Error ? error.stack : 'No stack');
    console.error('========== PLEDGES PAYMENTS API ERROR END ==========\n');
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
