import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, or, and, gte, lte, sql } from "drizzle-orm";
import { payment, manualDonation, pledge, contact, campaign } from "@/lib/db/schema";
import jsPDF from "jspdf";
import https from "https";
import http from "http";

// Helper function to download image from URL and convert to base64
async function downloadImageAsBase64(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https://') ? https : http;
    const request = protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        resolve(null);
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString('base64');
        const mimeType = response.headers['content-type'] || 'image/jpeg';
        resolve(`data:${mimeType};base64,${base64}`);
      });
    });

    request.on('error', () => resolve(null));
    request.setTimeout(5000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  console.log('=== Year End Letter PDF Request Started ===');

  try {
    const { filename } = await context.params;
    const { searchParams } = new URL(request.url);
    const logoLink = searchParams.get('logoLink');
    const charityName = searchParams.get('charityName') || 'ABC Charity';
    const charityAddress = searchParams.get('charityAddress') || '1234 Main Street, Anytown, USA';
    const taxId = searchParams.get('taxId') || '12-3456789';
    const signatureName = searchParams.get('signatureName') || 'Executive Director';
    const subaccountName = searchParams.get('subaccountName') || charityName;
    const subaccountEmail = searchParams.get('subaccountEmail') || '';
    console.log('Requested filename:', filename, 'logoLink:', logoLink, 'charityName:', charityName);

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

    // Generate PDF with enhanced design
    const doc = new jsPDF();
    
    // Define color palette (professional neutral theme)
    const primaryColor = { r: 51, g: 65, b: 85 }; // Dark slate gray
    const accentColor = { r: 100, g: 116, b: 139 }; // Medium slate gray
    const lightGray = { r: 248, g: 250, b: 252 }; // Very light gray for table
    
    // Page margins
    const leftMargin = 20;
    const rightMargin = 190;
    const pageWidth = 210;
    
    let yPosition = 20;

    // ========== HEADER SECTION ==========
    // Organization header with logo on left and info on right
    let logoHeight = 0;
    if (logoLink) {
      try {
        console.log('Attempting to download logo from:', logoLink);
        const logoDataUri = await downloadImageAsBase64(logoLink);
        if (logoDataUri) {
          console.log('Logo downloaded successfully, adding to PDF');
          doc.addImage(logoDataUri, 'JPEG', leftMargin, yPosition, 40, 25);
          logoHeight = 25;
        } else {
          console.log('Logo download failed or returned null');
        }
      } catch (error) {
        console.error('Error adding logo to PDF:', error);
      }
    }

    // Organization info on the right side
    const rightX = 115;
    const textStartY = logoHeight > 0 ? yPosition + 3 : yPosition;

    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(charityName, rightX, textStartY);
    
    doc.setTextColor(accentColor.r, accentColor.g, accentColor.b);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(charityAddress, rightX, textStartY + 6);
    doc.text(`Federal Tax ID: ${taxId}`, rightX, textStartY + 11);
    doc.text("www.abccharity.org", rightX, textStartY + 16);

    yPosition = Math.max(yPosition + logoHeight + 10, textStartY + 26);

    // Divider line
    doc.setDrawColor(accentColor.r, accentColor.g, accentColor.b);
    doc.setLineWidth(0.5);
    doc.line(leftMargin, yPosition, rightMargin, yPosition);
    yPosition += 12;

    // ========== DATE ==========
    doc.setTextColor(60, 60, 60);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const today = new Date();
    doc.text(today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), leftMargin, yPosition);
    yPosition += 12;

    // ========== DONOR ADDRESS ==========
    doc.setFont('helvetica', 'normal');
    if (contactInfo.address) {
      const addressLines = doc.splitTextToSize(contactInfo.address, 100);
      doc.text(addressLines, leftMargin, yPosition);
      yPosition += addressLines.length * 5;
    }
    yPosition += 10;

    // ========== SALUTATION ==========
    doc.setFontSize(11);
    doc.text(`Dear ${contactName},`, leftMargin, yPosition);
    yPosition += 10;

    // ========== BODY TEXT ==========
    doc.setFontSize(10);
    const bodyText = `Thank you for your generous support of ${charityName} throughout ${yearNum}. Your contributions have made a meaningful difference in the lives of those we serve. Below is a summary of your tax-deductible contributions for the year:`;
    const splitBody = doc.splitTextToSize(bodyText, rightMargin - leftMargin);
    doc.text(splitBody, leftMargin, yPosition);
    yPosition += splitBody.length * 5 + 10;

    // ========== CONTRIBUTION TABLE ==========
    // Table title
    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`${yearNum} Contributions`, leftMargin, yPosition);
    yPosition += 8;

    // Table setup
    const tableStartY = yPosition;
    const colDate = leftMargin;
    const colAmount = 70;
    const colDescription = 110;
    const rowHeight = 7;
    
    // Table header with background
    doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.rect(leftMargin, yPosition - 5, rightMargin - leftMargin, 8, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Date', colDate + 2, yPosition);
    doc.text('Amount', colAmount + 2, yPosition);
    doc.text('Description', colDescription + 2, yPosition);
    yPosition += 10;

    // Table rows with alternating background
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    
    allTransactions.forEach((transaction, index) => {
      // Check if we need a new page
      if (yPosition > 260) {
        doc.addPage();
        yPosition = 25;
      }
      
      // Alternating row background
      if (index % 2 === 0) {
        doc.setFillColor(lightGray.r, lightGray.g, lightGray.b);
        doc.rect(leftMargin, yPosition - 5, rightMargin - leftMargin, rowHeight, 'F');
      }
      
      const dateStr = transaction.date
        ? new Date(transaction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'N/A';
      const amountStr = `$${parseFloat(transaction.amount?.toString() || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const descStr = transaction.description || 'General Donation';

      doc.text(dateStr, colDate + 2, yPosition);
      doc.text(amountStr, colAmount + 2, yPosition);
      
      const splitDesc = doc.splitTextToSize(descStr, 75);
      doc.text(splitDesc, colDescription + 2, yPosition);
      
      yPosition += Math.max(splitDesc.length * 5, rowHeight);
    });

    // Table border
    doc.setDrawColor(accentColor.r, accentColor.g, accentColor.b);
    doc.setLineWidth(0.3);
    const tableHeight = yPosition - tableStartY;
    doc.rect(leftMargin, tableStartY - 5, rightMargin - leftMargin, tableHeight);

    yPosition += 5;

    // ========== TOTAL SECTION ==========
    // Background for total
    doc.setFillColor(lightGray.r, lightGray.g, lightGray.b);
    doc.rect(leftMargin, yPosition - 2, rightMargin - leftMargin, 10, 'F');
    
    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Total Contributions:', colDate + 2, yPosition + 5);
    doc.text(`$${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, colAmount + 2, yPosition + 5);
    
    // Border around total
    doc.setDrawColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.setLineWidth(0.5);
    doc.rect(leftMargin, yPosition - 2, rightMargin - leftMargin, 10);
    
    yPosition += 15;

    // ========== TAX NOTICE ==========
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    const noteText = 'No goods or services were provided in exchange for these contributions. Please retain this letter for your tax records.';
    const splitNote = doc.splitTextToSize(noteText, rightMargin - leftMargin);
    doc.text(splitNote, leftMargin, yPosition);
    yPosition += splitNote.length * 4 + 10;

    // ========== CLOSING ==========
    // Check if we need a new page for closing and signature
    if (yPosition > 240) {
      doc.addPage();
      yPosition = 25;
    }
    
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('With deep gratitude,', leftMargin, yPosition);
    yPosition += 20;

    // Signature area (space for handwritten signature)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(accentColor.r, accentColor.g, accentColor.b);
    doc.text(`${signatureName}, ${subaccountName}`, leftMargin, yPosition);

    // ========== FOOTER ==========
    // Footer text at bottom
    const footerY = 285;
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    const footerText = `${subaccountName} is a 501(c)(3) tax-exempt organization. All contributions are tax-deductible to the extent allowed by law.`;
    const footerWidth = doc.getTextWidth(footerText);
    doc.text(footerText, (pageWidth - footerWidth) / 2, footerY);

    // Generate PDF buffer
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    if (!pdfBuffer || pdfBuffer.length === 0) {
      console.error('PDF generation failed - empty buffer');
      return NextResponse.json({
        error: 'Failed to generate PDF - empty result',
      }, { status: 500 });
    }

    console.log('PDF buffer created, size:', pdfBuffer.length, 'bytes');

    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength
    ) as ArrayBuffer;

    console.log('ArrayBuffer created, size:', arrayBuffer.byteLength, 'bytes');
    console.log('Returning PDF response with headers');

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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';