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
  console.log('=== PDF Receipt Request Started ===');
  
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

    // Parse filename to extract payment info
    // Format: receipt-{type}-{paymentId}-{timestamp}.pdf
    const match = filename.match(/^receipt-(payment|manual)-(\d+)-\d+\.pdf$/);
    if (!match) {
      console.error('Filename does not match expected pattern:', filename);
      return NextResponse.json(
        { error: 'Invalid receipt filename format' },
        { status: 400 }
      );
    }

    const [, type, paymentIdStr] = match;
    const paymentId = parseInt(paymentIdStr, 10);
    
    console.log('Parsed type:', type, 'paymentId:', paymentId);

    if (isNaN(paymentId)) {
      console.error('Invalid payment ID:', paymentIdStr);
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
      console.log('Fetching payment data for ID:', paymentId);
      // Fetch payment details
      const paymentResult = await db
        .select()
        .from(payment)
        .where(eq(payment.id, paymentId))
        .limit(1);

      if (!paymentResult.length) {
        console.error('Payment not found for ID:', paymentId);
        return NextResponse.json({
          error: 'Payment not found',
        }, { status: 404 });
      }

      paymentData = paymentResult[0];
      console.log('Payment data fetched:', paymentData.id);

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
      console.log('Fetching manual donation data for ID:', paymentId);
      // Fetch manual donation details
      const donationResult = await db
        .select()
        .from(manualDonation)
        .where(eq(manualDonation.id, paymentId))
        .limit(1);

      if (!donationResult.length) {
        console.error('Manual donation not found for ID:', paymentId);
        return NextResponse.json({
          error: 'Manual donation not found',
        }, { status: 404 });
      }

      paymentData = donationResult[0];
      console.log('Manual donation data fetched:', paymentData.id);

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
      console.error('Missing data - paymentData:', !!paymentData, 'contactData:', !!contactData);
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

    console.log('Receipt data prepared:', {
      paymentId: receiptData.paymentId,
      amount: receiptData.amount,
      contactName: receiptData.contactName
    });

    // Generate PDF
    console.log('Starting PDF generation...');
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = generatePDFReceipt(receiptData);
      console.log('PDF generation completed successfully');
    } catch (pdfError) {
      console.error('PDF generation error:', pdfError);
      return NextResponse.json({
        error: 'Failed to generate PDF',
        details: pdfError instanceof Error ? pdfError.message : 'Unknown PDF generation error'
      }, { status: 500 });
    }

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
    console.error('=== ERROR in PDF receipt route ===');
    console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    return NextResponse.json(
      { 
        error: 'Failed to serve receipt',
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