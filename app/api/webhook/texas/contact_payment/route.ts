import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contact, pledge, payment, paymentAllocations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

// Schema for contact payment webhook data
const contactPaymentWebhookSchema = z.object({
  email: z.string().email("Invalid email format").optional(),
  name: z.string().optional(),
  ghl_contact_id: z.string().optional(),
  campaign: z.string().optional(),
  location_id: z.string().optional(),
  amount: z.number().positive("Amount must be positive"),
}).catchall(z.string().optional());

export async function POST(request: NextRequest) {
  try {
    console.log('=== Texas Contact Payment Webhook Debug ===');
    console.log('URL:', request.url);
    console.log('Method:', request.method);

    const body = await request.json();
    console.log('Received contact payment webhook data:', JSON.stringify(body, null, 2));

    // Validate incoming data
    const parsed = contactPaymentWebhookSchema.safeParse(body);
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

    // Extract contact details
    const email = paymentData.email?.toLowerCase().trim();
    const name = paymentData.name?.trim();
    const ghlContactId = paymentData.ghl_contact_id?.trim();
    const campaign = paymentData.campaign?.trim();
    const locationId = paymentData.location_id?.trim();
    const amount = paymentData.amount;

    // Validate required fields
    if (!email && !ghlContactId && !name) {
      return NextResponse.json({
        success: false,
        message: 'At least one of email, ghl_contact_id, or name is required to identify contact',
        code: 'MISSING_CONTACT_IDENTIFIER',
      }, { status: 400 });
    }

    if (!campaign) {
      return NextResponse.json({
        success: false,
        message: 'Campaign is required',
        code: 'MISSING_CAMPAIGN',
      }, { status: 400 });
    }

    // Find contact
    let contactResult: (typeof contact.$inferSelect)[] = [];

    // 1. Try to find by GHL contact ID
    if (ghlContactId) {
      contactResult = await db
        .select()
        .from(contact)
        .where(eq(contact.ghlContactId, ghlContactId))
        .limit(1);
    }

    // 2. Fallback: find by email
    if (!contactResult?.length && email) {
      contactResult = await db
        .select()
        .from(contact)
        .where(eq(contact.email, email))
        .limit(1);
    }

    // 3. Fallback: find by name (split name into first/last)
    if (!contactResult?.length && name) {
      const nameParts = name.split(' ').filter(part => part.trim());
      if (nameParts.length >= 2) {
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');
        contactResult = await db
          .select()
          .from(contact)
          .where(and(eq(contact.firstName, firstName), eq(contact.lastName, lastName)))
          .limit(1);
      } else if (nameParts.length === 1) {
        // Try matching last name only
        contactResult = await db
          .select()
          .from(contact)
          .where(eq(contact.lastName, nameParts[0]))
          .limit(1);
      }
    }

    if (!contactResult?.length) {
      return NextResponse.json({
        success: false,
        message: 'Contact not found',
        code: 'CONTACT_NOT_FOUND',
        searchCriteria: { email, name, ghlContactId },
      }, { status: 404 });
    }

    const dbContact = contactResult[0];
    console.log(`Found contact: ${dbContact.id} - ${dbContact.firstName} ${dbContact.lastName}`);

    // Find pledge for this contact and campaign
    const pledgeResult = await db
      .select()
      .from(pledge)
      .where(and(
        eq(pledge.contactId, dbContact.id),
        eq(pledge.campaignCode, campaign),
        eq(pledge.isActive, true)
      ))
      .limit(1);

    if (!pledgeResult.length) {
      return NextResponse.json({
        success: false,
        message: 'No active pledge found for this contact and campaign',
        code: 'PLEDGE_NOT_FOUND',
        contactId: dbContact.id,
        campaign,
      }, { status: 404 });
    }

    const dbPledge = pledgeResult[0];
    console.log(`Found pledge: ${dbPledge.id} for campaign: ${campaign}`);

    // Check if pledge has remaining balance
    const remainingBalance = parseFloat(dbPledge.balance || '0');
    if (remainingBalance <= 0) {
      return NextResponse.json({
        success: false,
        message: 'Pledge has no remaining balance',
        code: 'NO_REMAINING_BALANCE',
        pledgeId: dbPledge.id,
        balance: remainingBalance,
      }, { status: 400 });
    }

    // Determine payment amount (don't exceed remaining balance)
    const paymentAmount = Math.min(amount, remainingBalance);

    // Create payment record
    const paymentDate = new Date().toISOString().split('T')[0]; // Today's date in YYYY-MM-DD format

    const newPayment = {
      pledgeId: dbPledge.id,
      amount: paymentAmount.toString(),
      currency: dbPledge.currency,
      amountUsd: dbPledge.currency === 'USD' ? paymentAmount.toString() : null, // Assuming USD for now, could add exchange rate logic
      amountInPledgeCurrency: paymentAmount.toString(),
      paymentDate,
      paymentMethod: 'card',
      paymentStatus: 'completed' as const,
      receivedDate: paymentDate,
      receiptIssued: false,
      notes: `Payment received via Texas webhook for campaign: ${campaign}`,
    };

    // Insert payment
    const [createdPayment] = await db.insert(payment).values(newPayment).returning();
    console.log(`Created payment: ${createdPayment.id} for amount: ${paymentAmount} ${dbPledge.currency}`);

    // Create payment allocation
    const allocationAmount = paymentAmount;
    const newAllocation = {
      paymentId: createdPayment.id,
      pledgeId: dbPledge.id,
      allocatedAmount: allocationAmount.toString(),
      currency: dbPledge.currency,
      allocatedAmountUsd: dbPledge.currency === 'USD' ? allocationAmount.toString() : null,
      allocatedAmountInPledgeCurrency: allocationAmount.toString(),
      notes: `Allocation for Texas webhook payment`,
    };

    await db.insert(paymentAllocations).values(newAllocation);
    console.log(`Created payment allocation for pledge: ${dbPledge.id}`);

    // Update pledge totals
    const currentTotalPaid = parseFloat(dbPledge.totalPaid || '0');
    const currentTotalPaidUsd = parseFloat(dbPledge.totalPaidUsd || '0');
    const currentBalance = parseFloat(dbPledge.balance || '0');
    const currentBalanceUsd = parseFloat(dbPledge.balanceUsd || '0');

    const newTotalPaid = currentTotalPaid + paymentAmount;
    const newTotalPaidUsd = dbPledge.currency === 'USD' ? currentTotalPaidUsd + paymentAmount : currentTotalPaidUsd;
    const newBalance = Math.max(0, currentBalance - paymentAmount);
    const newBalanceUsd = dbPledge.currency === 'USD' ? Math.max(0, currentBalanceUsd - paymentAmount) : currentBalanceUsd;

    await db.update(pledge)
      .set({
        totalPaid: newTotalPaid.toString(),
        totalPaidUsd: newTotalPaidUsd.toString(),
        balance: newBalance.toString(),
        balanceUsd: newBalanceUsd.toString(),
        updatedAt: new Date(),
      })
      .where(eq(pledge.id, dbPledge.id));

    console.log(`Updated pledge ${dbPledge.id} totals - Total Paid: ${newTotalPaid}, Balance: ${newBalance}`);

    return NextResponse.json({
      success: true,
      message: 'Payment created successfully',
      code: 'PAYMENT_CREATED',
      data: {
        contactId: dbContact.id,
        contactName: `${dbContact.firstName} ${dbContact.lastName}`,
        pledgeId: dbPledge.id,
        paymentId: createdPayment.id,
        amount: paymentAmount,
        currency: dbPledge.currency,
        campaign,
        paymentMethod: 'card',
        remainingBalance: newBalance,
      },
    }, { status: 201 });

  } catch (error: unknown) {
    console.error('Unexpected error in Texas contact payment webhook:', error);
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
    message: 'Texas Contact Payment webhook endpoint is active',
    methods: ['POST'],
    note: 'Accepts contact payment data, finds contact by ghl_contact_id/email/name, locates pledge by campaign, and creates card payment.',
    example: {
      jsonBody: {
        email: "john.doe@example.com",
        name: "John Doe",
        ghl_contact_id: "12345",
        campaign: "Texas Campaign 2024",
        location_id: "texas_loc_123",
        amount: 100.00
      }
    }
  }, { status: 200 });
}
