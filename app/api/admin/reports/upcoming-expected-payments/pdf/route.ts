import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { pledge, contact, category, payment } from '@/lib/db/schema';
import { sql, eq, and, exists } from 'drizzle-orm';
import { generateReportPDF, generateReportFilename } from '@/lib/pdf-report-generator';

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
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { filters } = await request.json();
    const { locationId } = filters;

    // Get all upcoming expected payments data (not paginated)
    const query = db
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

    const results = await query.execute();

    // Prepare PDF data
    const pdfData = results.map((row: UpcomingExpectedPaymentRow) => {
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

    // Generate PDF
    const pdfBuffer = generateReportPDF({
      title: "Upcoming Expected Payments Report",
      subtitle: "Upcoming Expected Payments Report",
      data: pdfData,
      filename: generateReportFilename("upcoming-expected-payments"),
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${generateReportFilename("upcoming-expected-payments")}"`,
      },
    });

  } catch (error) {
    console.error('Error generating upcoming expected payments PDF:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
