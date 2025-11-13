// app/api/receipts/[filename]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from "@/lib/db";
import { payment, contact, pledge, manualDonation, campaign } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generatePDFReceipt, type ReceiptData } from '@/lib/pdf-receipt-generator';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await context.params;

    // Security: Validate filename to prevent directory traversal
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
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

    // Parse filename to extract payment info
    // Format: receipt-{type}-{paymentId}-{timestamp}.pdf
    const match = filename.match(/^receipt-(payment|manual)-(\d+)-\d+\.pdf$/);
    if (!match) {
      return NextResponse.json(
        { error: 'Invalid receipt filename format' },
        { status: 400 }
      );
    }

    const [, type, paymentIdStr] = match;
    const paymentId = parseInt(paymentIdStr, 10);

    if (isNaN(paymentId)) {
      return NextResponse.json(
        { error: 'Invalid payment ID' },
        { status: 400 }
      );
    }

    // Fetch payment data and generate PDF on-demand
    let paymentData: typeof payment.$inferSelect | typeof manualDonation.$inferSelect | null = null;
    let contactData: Partial<typeof contact.$inferSelect> | null = null;
    let pledgeData: Partial<typeof pledge.$inferSelect> | null = null;
    let campaignName: string | undefined;

    if (type === 'payment') {
      // Fetch payment details
      const paymentResult = await db
        .select()
        .from(payment)
        .where(eq(payment.id, paymentId))
        .limit(1);

      if (!paymentResult.length) {
        return NextResponse.json({
          error: 'Payment not found',
        }, { status: 404 });
      }

      paymentData = paymentResult[0];

      // Determine contact ID
      const contactIdToUse = paymentData.payerContactId || paymentData.relationshipId;

      if (!contactIdToUse) {
        return NextResponse.json({
          error: 'Cannot determine contact for payment',
        }, { status: 400 });
      }

      // Fetch contact details
      const contactResult = await db
        .select({
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
        })
        .from(contact)
        .where(eq(contact.id, contactIdToUse))
        .limit(1);

      if (!contactResult.length) {
        return NextResponse.json({
          error: 'Contact not found',
        }, { status: 404 });
      }

      contactData = contactResult[0];

      // Fetch pledge details if available
      if (paymentData.pledgeId) {
        const pledgeResult = await db
          .select({
            id: pledge.id,
            description: pledge.description,
            originalAmount: pledge.originalAmount,
            currency: pledge.currency,
            campaignCode: pledge.campaignCode,
          })
          .from(pledge)
          .where(eq(pledge.id, paymentData.pledgeId))
          .limit(1);

        if (pledgeResult.length) {
          pledgeData = pledgeResult[0];
        }
      }
    } else if (type === 'manual') {
      // Fetch manual donation details
      const donationResult = await db
        .select()
        .from(manualDonation)
        .where(eq(manualDonation.id, paymentId))
        .limit(1);

      if (!donationResult.length) {
        return NextResponse.json({
          error: 'Manual donation not found',
        }, { status: 404 });
      }

      paymentData = donationResult[0];

      // Fetch contact details
      const contactResult = await db
        .select({
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
        })
        .from(contact)
        .where(eq(contact.id, paymentData.contactId))
        .limit(1);

      if (!contactResult.length) {
        return NextResponse.json({
          error: 'Contact not found',
        }, { status: 404 });
      }

      contactData = contactResult[0];

      // Fetch campaign details if available
      if (paymentData.campaignId) {
        const campaignResult = await db
          .select({ name: campaign.name })
          .from(campaign)
          .where(eq(campaign.id, paymentData.campaignId))
          .limit(1);

        if (campaignResult.length) {
          campaignName = campaignResult[0].name;
        }
      }
    }

    if (!paymentData || !contactData) {
      return NextResponse.json({
        error: 'Failed to fetch payment or contact data',
      }, { status: 500 });
    }

    // Generate receipt data with safe defaults
    const contactName = `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim() || 'Donor';
    const contactEmail = contactData.email || 'donor@example.com';

    const receiptData: ReceiptData = {
      paymentId: paymentData.id,
      amount: paymentData.amount || '0',
      currency: paymentData.currency || 'USD',
      paymentDate: paymentData.paymentDate || new Date().toISOString(),
      paymentMethod: paymentData.paymentMethod || undefined,
      referenceNumber: paymentData.referenceNumber || undefined,
      receiptNumber: paymentData.receiptNumber || undefined,
      notes: paymentData.notes || undefined,
      contactName,
      contactEmail,
      contactPhone: contactData.phone || undefined,
      campaign: campaignName,
      pledgeDescription: pledgeData?.description || undefined,
    };

    console.log('Generating PDF with data:', receiptData);

    // Generate PDF
    const pdfBuffer = generatePDFReceipt(receiptData);

    if (!pdfBuffer || pdfBuffer.length === 0) {
      console.error('PDF generation failed - empty buffer');
      return NextResponse.json({
        error: 'Failed to generate PDF',
      }, { status: 500 });
    }

    console.log('PDF generated successfully, size:', pdfBuffer.length);

    // Convert Buffer to ArrayBuffer for NextResponse compatibility
    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength
    ) as ArrayBuffer;

    // Return PDF with proper headers
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': pdfBuffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving PDF receipt:', error);
    return NextResponse.json(
      { 
        error: 'Failed to serve receipt',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Add runtime config for Node.js runtime (not Edge)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';