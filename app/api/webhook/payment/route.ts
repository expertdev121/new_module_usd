import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { payment, contact, pledge, paymentAllocations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

// Webhook URL for sending receipts
const RECEIPT_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/E7yO96aiKmYvsbU2tRzc/webhook-trigger/5991f595-a206-49bf-b333-08e6b5e6c9b1';

// Schema for payment webhook data
const paymentWebhookSchema = z.object({
  paymentId: z.number().positive(),
  contactId: z.number().positive().optional(),
  pledgeId: z.number().positive().optional(),
  amount: z.number().positive(),
  currency: z.string(),
  paymentDate: z.string(),
  paymentMethod: z.string().optional(),
  referenceNumber: z.string().optional(),
  receiptNumber: z.string().optional(),
  notes: z.string().optional(),
  isSplitPayment: z.boolean().optional(),
}).catchall(z.string().optional());

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
}) {
  try {
    const formData = new FormData();
    formData.append('paymentId', receiptData.paymentId.toString());
    formData.append('amount', receiptData.amount);
    formData.append('currency', receiptData.currency);
    formData.append('paymentDate', receiptData.paymentDate);
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

// Generate plain text receipt body
function generateReceiptBody(paymentData: typeof payment.$inferSelect, contactData: Pick<typeof contact.$inferSelect, 'firstName' | 'lastName' | 'email' | 'phone'>, pledgeData?: Pick<typeof pledge.$inferSelect, 'id' | 'description' | 'originalAmount' | 'currency'> | null): string {
  const lines = [
    'PAYMENT RECEIPT',
    '================',
    '',
    `Payment ID: ${paymentData.id}`,
    `Payment Date: ${new Date(paymentData.paymentDate).toLocaleDateString()}`,
    `Amount: ${paymentData.amount} ${paymentData.currency}`,
    `Payment Method: ${paymentData.paymentMethod || 'N/A'}`,
    `Reference Number: ${paymentData.referenceNumber || 'N/A'}`,
    `Receipt Number: ${paymentData.receiptNumber || 'N/A'}`,
    `Payment Status: ${paymentData.paymentStatus}`,
    '',
    'Contact Information:',
    `Name: ${contactData.firstName} ${contactData.lastName}`,
    `Email: ${contactData.email}`,
    `Phone: ${contactData.phone || 'N/A'}`,
    '',
  ];

  if (pledgeData) {
    lines.push(
      'Pledge Information:',
      `Pledge ID: ${pledgeData.id}`,
      `Description: ${pledgeData.description || 'N/A'}`,
      `Original Amount: ${pledgeData.originalAmount} ${pledgeData.currency}`,
      ''
    );
  }

  if (paymentData.notes) {
    lines.push(`Notes: ${paymentData.notes}`, '');
  }

  lines.push(
    'Thank you for your payment!',
    '',
    `Generated on: ${new Date().toLocaleString()}`
  );

  return lines.join('\n');
}

export async function POST(request: NextRequest) {
  try {
    console.log('=== Payment Webhook Debug ===');
    console.log('URL:', request.url);
    console.log('Method:', request.method);

    const body = await request.json();
    console.log('Received payment webhook data:', JSON.stringify(body, null, 2));

    // Validate incoming data
    const parsed = paymentWebhookSchema.safeParse(body);
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

    const paymentData = parsed.data;

    // Skip split payments for now
    if (paymentData.isSplitPayment) {
      console.log(`Skipping split payment ${paymentData.paymentId}`);
      return NextResponse.json({
        success: true,
        message: 'Split payment skipped',
        code: 'SPLIT_PAYMENT_SKIPPED',
        paymentId: paymentData.paymentId,
      });
    }

    // Fetch payment details from database
    const paymentResult = await db
      .select()
      .from(payment)
      .where(eq(payment.id, paymentData.paymentId))
      .limit(1);

    if (!paymentResult.length) {
      return NextResponse.json({
        success: false,
        message: 'Payment not found',
        code: 'PAYMENT_NOT_FOUND',
        paymentId: paymentData.paymentId,
      }, { status: 404 });
    }

    const dbPayment = paymentResult[0];

    // Determine contact ID - use from webhook data or from pledge
    let contactId = paymentData.contactId;
    if (!contactId && dbPayment.pledgeId) {
      const pledgeResult = await db
        .select({ contactId: pledge.contactId })
        .from(pledge)
        .where(eq(pledge.id, dbPayment.pledgeId))
        .limit(1);

      if (pledgeResult.length) {
        contactId = pledgeResult[0].contactId;
      }
    }

    if (!contactId) {
      return NextResponse.json({
        success: false,
        message: 'Contact ID not found for payment',
        code: 'CONTACT_NOT_FOUND',
        paymentId: paymentData.paymentId,
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
      .where(eq(contact.id, contactId))
      .limit(1);

    if (!contactResult.length) {
      return NextResponse.json({
        success: false,
        message: 'Contact not found',
        code: 'CONTACT_NOT_FOUND',
        contactId,
        paymentId: paymentData.paymentId,
      }, { status: 404 });
    }

    const dbContact = contactResult[0];

    // Check if contact has email
    if (!dbContact.email) {
      console.log(`Contact ${contactId} has no email, skipping receipt`);
      return NextResponse.json({
        success: true,
        message: 'Contact has no email, receipt not sent',
        code: 'NO_EMAIL_SKIP',
        paymentId: paymentData.paymentId,
        contactId,
      });
    }

    // Fetch pledge details if available
    let pledgeData = null;
    if (dbPayment.pledgeId) {
      const pledgeResult = await db
        .select({
          id: pledge.id,
          description: pledge.description,
          originalAmount: pledge.originalAmount,
          currency: pledge.currency,
        })
        .from(pledge)
        .where(eq(pledge.id, dbPayment.pledgeId))
        .limit(1);

      if (pledgeResult.length) {
        pledgeData = pledgeResult[0];
      }
    }

    // Generate receipt content
    const receiptBody = generateReceiptBody(dbPayment, dbContact, pledgeData);

    // Note: Automatic webhook sending has been disabled
    // Receipt will be sent manually via the payments table button

    return NextResponse.json({
      success: true,
      message: 'Payment processed successfully (receipt not sent automatically)',
      code: 'PAYMENT_PROCESSED',
      paymentId: paymentData.paymentId,
      contactId,
      email: dbContact.email,
    });

  } catch (error: unknown) {
    console.error('Unexpected error in payment webhook:', error);
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
    message: 'Payment webhook endpoint is active',
    methods: ['POST'],
    note: 'Accepts payment data and sends receipt to configured webhook URL if contact has email. Skips split payments.',
    webhookUrl: RECEIPT_WEBHOOK_URL,
    example: {
      jsonBody: {
        paymentId: 123,
        contactId: 456,
        amount: 100.00,
        currency: "USD",
        paymentDate: "2024-01-15",
        paymentMethod: "Credit Card",
        referenceNumber: "REF123",
        receiptNumber: "RCP456",
        notes: "Thank you for your donation",
        isSplitPayment: false
      }
    }
  }, { status: 200 });
}
