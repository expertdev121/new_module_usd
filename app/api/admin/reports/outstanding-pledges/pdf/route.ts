import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pledge, contact, category } from '@/lib/db/schema';
import { sql, eq, and } from 'drizzle-orm';
import { generateReportPDF, generateReportFilename } from '@/lib/pdf-report-generator';
import { getReportContext } from '@/lib/reports/guard';

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
    const { filters } = await request.json();

    // Phase-0 security hotfix: tenant scope comes from the SESSION, never
    // from the request body (super_admin may override).
    const guard = await getReportContext(filters?.locationId);
    if (guard.error) return guard.error;
    const locationId = guard.ctx.locationId;

    // Get all outstanding pledges data (not paginated)
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
        sql`${pledge.balance}::numeric > 0`
      ))
      .orderBy(sql`${pledge.pledgeDate} DESC`, sql`${contact.lastName} ASC`, sql`${contact.firstName} ASC`);

    const results = await query.execute();

    // Prepare PDF data
    const pdfData = results.map((row: OutstandingPledgeRow) => {
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

    // Generate PDF
    const pdfBuffer = generateReportPDF({
      title: "Outstanding Pledges Report",
      subtitle: "Outstanding Pledges Report",
      data: pdfData,
      filename: generateReportFilename("outstanding-pledges"),
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${generateReportFilename("outstanding-pledges")}"`,
      },
    });

  } catch (error) {
    console.error('Error generating outstanding pledges PDF:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
