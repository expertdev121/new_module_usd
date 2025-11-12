import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { payment, contact, pledge, manualDonation } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { generatePDFReceipt, generateReceiptFilename, savePDFToPublic, type ReceiptData } from '@/lib/pdf-receipt-generator';

// Webhook URL for sending receipts
const RECEIPT_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/E7yO96aiKmYvsbU2tRzc/webhook-trigger/5991f595-a206-49bf-b333-08e6b5e6c9b1';

// Schema for send receipt request
const sendReceiptSchema = z.object({
  paymentId: z.number().positive(),
  type: z.enum(['payment', 'manualDonation']),
});

// Helper function to send receipt to webhook
async function sendReceiptToWebhook(receiptData: {
  paymentId: number;
  amount: string;
  currency: string;
  paymentDate: string;
  paymentMethod?: string;
  referenceNumber?: string;
  receiptNumber?: string;
  notes?: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  pledgeDescription?: string;
  pledgeOriginalAmount?: string;
  pledgeCurrency?: string;
  category?: string;
  campaign?: string;
  receiptPdfUrl?: string;
}) {
  try {
    const formData = new FormData();
    formData.append('paymentId', receiptData.paymentId.toString());
    formData.append('amount', receiptData.amount);
    formData.append('currency', receiptData.currency);
    formData.append('paymentDate', receiptData.paymentDate);
    if (receiptData.receiptPdfUrl) formData.append('receiptPdfUrl', receiptData.receiptPdfUrl);
    if (receiptData.paymentMethod) formData.append('paymentMethod', receiptData.paymentMethod);
    if (receiptData.referenceNumber) formData.append('referenceNumber', receiptData.referenceNumber);
    if (receiptData.receiptNumber) formData.append('receiptNumber', receiptData.receiptNumber);
    if (receiptData.notes) formData.append('notes', receiptData.notes);
    formData.append('name', receiptData.contactName);
    formData.append('email', receiptData.contactEmail);
    if (receiptData.contactPhone) formData.append('phone', receiptData.contactPhone);
    if (receiptData.pledgeDescription) formData.append('pledgeDescription', receiptData.pledgeDescription);
    if (receiptData.pledgeOriginalAmount) formData.append('pledgeOriginalAmount', receiptData.pledgeOriginalAmount);
    if (receiptData.pledgeCurrency) formData.append('pledgeCurrency', receiptData.pledgeCurrency);
    if (receiptData.category) formData.append('category', receiptData.category);
    if (receiptData.campaign) formData.append('campaign', receiptData.campaign);

    const response = await fetch(RECEIPT_WEBHOOK_URL, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Webhook request failed with status: ${response.status}`);
    }

    console.log(`Receipt data sent successfully for payment ${receiptData.paymentId} to ${receiptData.contactEmail}`);
    return true;
  } catch (error) {
    console.error(`Failed to send receipt data for payment ${receiptData.paymentId}:`, error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('Send receipt request:', JSON.stringify(body, null, 2));

    // Validate incoming data
    const parsed = sendReceiptSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: 'Data validation failed',
          code: 'VALIDATION_ERROR',
          errors: parsed.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const { paymentId, type } = parsed.data;

    let paymentData: any = null;
    let contactData: any = null;
    let pledgeData: any = null;
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
          success: false,
          message: 'Payment not found',
          code: 'PAYMENT_NOT_FOUND',
        }, { status: 404 });
      }

      paymentData = paymentResult[0];

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
        .where(eq(contact.id, paymentData.contactId || paymentData.pledgeOwnerId))
        .limit(1);

      if (!contactResult.length) {
        return NextResponse.json({
          success: false,
          message: 'Contact not found',
          code: 'CONTACT_NOT_FOUND',
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
    } else if (type === 'manualDonation') {
      // Fetch manual donation details
      const donationResult = await db
        .select()
        .from(manualDonation)
        .where(eq(manualDonation.id, paymentId))
        .limit(1);

      if (!donationResult.length) {
        return NextResponse.json({
          success: false,
          message: 'Manual donation not found',
          code: 'DONATION_NOT_FOUND',
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
          success: false,
          message: 'Contact not found',
          code: 'CONTACT_NOT_FOUND',
        }, { status: 404 });
      }

      contactData = contactResult[0];

      // Fetch campaign details if available
      if (paymentData.campaignId) {
        const campaignResult = await db
          .select({ name: require('@/lib/db/schema').campaign.name })
          .from(require('@/lib/db/schema').campaign)
          .where(eq(require('@/lib/db/schema').campaign.id, paymentData.campaignId))
          .limit(1);

        if (campaignResult.length) {
          campaignName = campaignResult[0].name;
        }
      }
    }

    // Check if contact has email
    if (!contactData.email) {
      return NextResponse.json({
        success: false,
        message: 'Contact has no email address',
        code: 'NO_EMAIL',
      }, { status: 400 });
    }

    // Check if payment is completed
    if (paymentData.paymentStatus !== 'completed') {
      return NextResponse.json({
        success: false,
        message: 'Receipt can only be sent for completed payments',
        code: 'PAYMENT_NOT_COMPLETED',
      }, { status: 400 });
    }

    // Generate PDF Receipt
    const receiptData: ReceiptData = {
      paymentId: paymentData.id,
      amount: paymentData.amount,
      currency: paymentData.currency,
      paymentDate: paymentData.paymentDate,
      paymentMethod: paymentData.paymentMethod || undefined,
      referenceNumber: paymentData.referenceNumber || undefined,
      receiptNumber: paymentData.receiptNumber || undefined,
      notes: paymentData.notes || undefined,
      contactName: `${contactData.firstName} ${contactData.lastName}`.trim(),
      contactEmail: contactData.email,
      contactPhone: contactData.phone || undefined,
      campaign: campaignName,
      pledgeDescription: pledgeData?.description || undefined,
    };

    // Generate PDF
    const pdfBuffer = generatePDFReceipt(receiptData);
    const filename = generateReceiptFilename(paymentData.id, type === 'manualDonation' ? 'manual' : 'payment');

    // Save PDF to public directory
    const pdfPath = await savePDFToPublic(pdfBuffer, filename);

    // Get full URL for the PDF
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` :
        'http://localhost:3000');
    const pdfUrl = `${baseUrl}/receipts/${filename}`;

    console.log(`PDF receipt generated: ${pdfUrl}`);

    // Send to webhook with PDF URL
    const webhookSuccess = await sendReceiptToWebhook({
      paymentId: paymentData.id,
      amount: paymentData.amount,
      currency: paymentData.currency,
      paymentDate: paymentData.paymentDate,
      paymentMethod: paymentData.paymentMethod || undefined,
      referenceNumber: paymentData.referenceNumber || undefined,
      receiptNumber: paymentData.receiptNumber || undefined,
      notes: paymentData.notes || undefined,
      contactName: `${contactData.firstName} ${contactData.lastName}`.trim(),
      contactEmail: contactData.email,
      contactPhone: contactData.phone || undefined,
      pledgeDescription: pledgeData?.description || undefined,
      pledgeOriginalAmount: pledgeData?.originalAmount?.toString() || undefined,
      pledgeCurrency: pledgeData?.currency || undefined,
      campaign: campaignName,
      receiptPdfUrl: pdfUrl,
    });

    if (!webhookSuccess) {
      return NextResponse.json({
        success: false,
        message: 'Failed to send receipt to webhook',
        code: 'WEBHOOK_SEND_FAILED',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Receipt sent successfully',
      code: 'RECEIPT_SENT',
      paymentId: paymentData.id,
      email: contactData.email,
      pdfUrl,
    });

  } catch (error: unknown) {
    console.error('Unexpected error in send receipt:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Unexpected server error',
        code: 'SERVER_ERROR',
        debug: process.env.NODE_ENV === 'development' ? {
          error: error instanceof Error ? error.message : String(error)
        } : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Send receipt endpoint is active',
    methods: ['POST'],
    note: 'Manually sends receipt for completed payments with email addresses',
    example: {
      jsonBody: {
        paymentId: 123,
        type: "payment"
      }
    }
  }, { status: 200 });
}