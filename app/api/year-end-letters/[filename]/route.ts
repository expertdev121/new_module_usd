import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, or, and, gte, lte, sql } from "drizzle-orm";
import { payment, manualDonation, pledge, contact, campaign } from "@/lib/db/schema";
import jsPDF from "jspdf";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  console.log('=== Year End Letter PDF Request Started ===');

  try {
    const { filename } = await context.params;
    console.log('Requested filename:', filename);

    // Security: Validate filename to prevent directory traversal
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      console.error('Invalid filename format:', filename);
      return NextResponse.json(
        { error: 'Invalid filename' },
        { status: 400 }
      );
    }

    // Only allow PDF files
    if (!filename.endsWith('.pdf')) {
      return NextResponse.json(
        { error: 'Only PDF files are allowed' },
        { status: 400 }
      );
    }

    // Parse filename to extract contact and year info
    // Format: year-end-letter-{contactId}-{year}-{timestamp}.pdf
    const match = filename.match(/^year-end-letter-(\d+)-(\d{4})-\d+\.pdf$/);
    if (!match) {
      console.error('Filename does not match expected pattern:', filename);
      return NextResponse.json(
        { error: 'Invalid year-end letter filename format' },
        { status: 400 }
      );
    }

    const [, contactIdStr, yearStr] = match;
    const contactId = parseInt(contactIdStr, 10);
    const yearNum = parseInt(yearStr, 10);

    console.log('Parsed contactId:', contactId, 'year:', yearNum);

    if (isNaN(contactId) || isNaN(yearNum)) {
      console.error('Invalid contact ID or year:', contactIdStr, yearStr);
      return NextResponse.json(
        { error: 'Invalid contact ID or year' },
        { status: 400 }
      );
    }

    // Get contact details
    const contactData = await db
      .select({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.displayName,
        email: contact.email,
        address: contact.address,
      })
      .from(contact)
      .where(eq(contact.id, contactId))
      .limit(1);

    if (contactData.length === 0) {
      console.error('Contact not found for ID:', contactId);
      return NextResponse.json({
        error: 'Contact not found',
      }, { status: 404 });
    }

    const contactInfo = contactData[0];
    const contactName = contactInfo.displayName || `${contactInfo.firstName} ${contactInfo.lastName}`;
    const firstName = contactInfo.firstName || 'Donor';

    const startDateStr = `${yearNum}-01-01`;
    const endDateStr = `${yearNum}-12-31`;

    // Fetch payments for the year
    const paymentsData = await db
      .select({
        id: payment.id,
        date: payment.receivedDate,
        amount: payment.amountUsd,
        description: sql<string>`COALESCE(${pledge.campaignCode}, 'donation')`,
      })
      .from(payment)
      .leftJoin(pledge, eq(payment.pledgeId, pledge.id))
      .where(
        and(
          or(
            eq(pledge.contactId, contactId),
            eq(payment.payerContactId, contactId)
          ),
          gte(payment.receivedDate, startDateStr),
          lte(payment.receivedDate, endDateStr)
        )
      )
      .orderBy(payment.receivedDate);

    // Fetch manual donations for the year
    const donationsData = await db
      .select({
        id: manualDonation.id,
        date: manualDonation.receivedDate,
        amount: manualDonation.amountUsd,
        description: sql<string>`COALESCE(${campaign.name}, 'donation')`,
      })
      .from(manualDonation)
      .leftJoin(campaign, eq(manualDonation.campaignId, campaign.id))
      .where(
        and(
          eq(manualDonation.contactId, contactId),
          gte(manualDonation.receivedDate, startDateStr),
          lte(manualDonation.receivedDate, endDateStr)
        )
      )
      .orderBy(manualDonation.receivedDate);

    // Combine and sort all transactions
    const allTransactions = [...paymentsData, ...donationsData]
      .sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateA - dateB;
      });

    // Calculate total amount
    const totalAmount = allTransactions.reduce((sum, transaction) => {
      return sum + parseFloat(transaction.amount?.toString() || "0");
    }, 0);

    // Generate PDF with default customization (can be enhanced later)
    const doc = new jsPDF();
    let yPosition = 20;

    // Organization header (centered)
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text("ABC Charity", doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
    yPosition += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text("1234 Main Street, Anytown, USA", doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
    yPosition += 5;
    doc.text(`Federal Tax ID: 12-3456789`, doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
    yPosition += 15;

    // Date
    const today = new Date();
    doc.text(today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), 20, yPosition);
    yPosition += 15;

    // Donor address
    doc.text(contactName, 20, yPosition);
    yPosition += 5;
    if (contactInfo.address) {
      doc.text(contactInfo.address, 20, yPosition);
      yPosition += 5;
    }
    yPosition += 10;

    // Salutation
    doc.text(`Dear ${firstName},`, 20, yPosition);
    yPosition += 15;

    // Body text
    const bodyText = `Thank you for your support of ABC Charity this past year. We are pleased to provide you with a summary of your ${yearNum} contributions:`;
    const splitBody = doc.splitTextToSize(bodyText, 170);
    doc.text(splitBody, 20, yPosition);
    yPosition += splitBody.length * 5 + 10;

    // Table headers
    doc.setFont('helvetica', 'bold');
    doc.text('Date', 20, yPosition);
    doc.text('Amount', 80, yPosition);
    doc.text('Description', 120, yPosition);
    yPosition += 10;

    // Table data
    doc.setFont('helvetica', 'normal');
    allTransactions.forEach((transaction) => {
      const dateStr = transaction.date
        ? new Date(transaction.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
        : 'N/A';
      const amountStr = `$${parseFloat(transaction.amount?.toString() || "0").toFixed(0)}`;
      const descStr = transaction.description || 'donation';

      doc.text(dateStr, 20, yPosition);
      doc.text(amountStr, 80, yPosition);
      const splitDesc = doc.splitTextToSize(descStr, 70);
      doc.text(splitDesc, 120, yPosition);
      yPosition += Math.max(splitDesc.length * 5, 7);
    });

    yPosition += 5;

    // Total
    doc.setFont('helvetica', 'bold');
    doc.text('Total', 20, yPosition);
    doc.text(`$${totalAmount.toFixed(0)}`, 80, yPosition);
    yPosition += 15;

    // Note
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    const noteText = 'Note: for donations of goods and services, the fair market value should be determined by you.';
    const splitNote = doc.splitTextToSize(noteText, 170);
    doc.text(splitNote, 20, yPosition);
    yPosition += splitNote.length * 4 + 10;

    // Impact statement
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const impactNote = "Your generosity throughout the year helped over 100 children in need. Thank you for making a difference in our community!";
    const splitImpact = doc.splitTextToSize(impactNote, 170);
    doc.text(splitImpact, 20, yPosition);
    yPosition += splitImpact.length * 5 + 10;

    // Closing
    doc.text('Sincerely,', 20, yPosition);
    yPosition += 15;

    // Signature
    doc.setFont('helvetica', 'italic');
    doc.text('Signature', 20, yPosition);
    yPosition += 5;
    doc.setFont('helvetica', 'normal');
    doc.text("Executive Director", 20, yPosition);

    // Generate PDF buffer
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    if (!pdfBuffer || pdfBuffer.length === 0) {
      console.error('PDF generation failed - empty buffer');
      return NextResponse.json({
        error: 'Failed to generate PDF - empty result',
      }, { status: 500 });
    }

    console.log('PDF buffer created, size:', pdfBuffer.length, 'bytes');

    // Convert Buffer to ArrayBuffer for NextResponse compatibility
    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength
    ) as ArrayBuffer;

    console.log('ArrayBuffer created, size:', arrayBuffer.byteLength, 'bytes');
    console.log('Returning PDF response with headers');

    // Return PDF with proper headers
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': pdfBuffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('=== ERROR in year-end letter PDF route ===');
    console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');

    return NextResponse.json(
      {
        error: 'Failed to serve year-end letter',
        details: error instanceof Error ? error.message : 'Unknown error',
        type: error instanceof Error ? error.constructor.name : typeof error
      },
      { status: 500 }
    );
  }
}

// Add runtime config for Node.js runtime (not Edge)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
