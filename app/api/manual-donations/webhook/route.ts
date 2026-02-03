import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { manualDonation, contact, solicitor, campaign } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Webhook URL for sending manual donation data
const MANUAL_DONATION_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/4Nzcp3vUgVbOoN9uxu5F/webhook-trigger/HDh98lieFBFX8JC6szYj';

// Helper function to send manual donation data to webhook
export async function sendManualDonationToWebhook(donationId: number) {
  try {
    // Fetch complete donation data with contact information
    const donationData = await db
      .select({
        // Manual donation fields
        id: manualDonation.id,
        contactId: manualDonation.contactId,
        amount: manualDonation.amount,
        currency: manualDonation.currency,
        amountUsd: manualDonation.amountUsd,
        exchangeRate: manualDonation.exchangeRate,
        paymentDate: manualDonation.paymentDate,
        receivedDate: manualDonation.receivedDate,
        checkDate: manualDonation.checkDate,
        accountId: manualDonation.accountId,
        campaignId: manualDonation.campaignId,
        paymentMethod: manualDonation.paymentMethod,
        methodDetail: manualDonation.methodDetail,
        paymentStatus: manualDonation.paymentStatus,
        referenceNumber: manualDonation.referenceNumber,
        checkNumber: manualDonation.checkNumber,
        receiptNumber: manualDonation.receiptNumber,
        receiptType: manualDonation.receiptType,
        receiptIssued: manualDonation.receiptIssued,
        solicitorId: manualDonation.solicitorId,
        bonusPercentage: manualDonation.bonusPercentage,
        bonusAmount: manualDonation.bonusAmount,
        bonusRuleId: manualDonation.bonusRuleId,
        notes: manualDonation.notes,
        createdAt: manualDonation.createdAt,
        updatedAt: manualDonation.updatedAt,
        // Contact fields
        contactGhlContactId: contact.ghlContactId,
        contactLocationId: contact.locationId,
        contactRecordId: contact.recordId,
        contactFirstName: contact.firstName,
        contactLastName: contact.lastName,
        contactDisplayName: contact.displayName,
        contactEmail: contact.email,
        contactEmail2: contact.email2,
        contactPhone: contact.phone,
        contactTitle: contact.title,
        contactGender: contact.gender,
        contactAddress: contact.address,
        contactCreatedAt: contact.createdAt,
        contactUpdatedAt: contact.updatedAt,
        // Solicitor information (if exists)
        solicitorName: solicitor.solicitorCode,
        // Campaign information (if exists)
        campaignName: campaign.name,
      })
      .from(manualDonation)
      .leftJoin(contact, eq(manualDonation.contactId, contact.id))
      .leftJoin(solicitor, eq(manualDonation.solicitorId, solicitor.id))
      .leftJoin(campaign, eq(manualDonation.campaignId, campaign.id))
      .where(eq(manualDonation.id, donationId))
      .limit(1);

    if (donationData.length === 0) {
      throw new Error(`Manual donation with ID ${donationId} not found`);
    }

    const data = donationData[0];

    // Check if the contact's location ID matches the required admin location ID
    if (data.contactLocationId !== '4Nzcp3vUgVbOoN9uxu5F') {
      console.log(`Skipping webhook for donation ID ${donationId}: location ID ${data.contactLocationId} does not match required location`);
      return { success: true, message: 'Webhook skipped: location ID does not match' };
    }

    // Prepare webhook payload
    const webhookPayload = {
      // Contact Information
      contact: {
        id: data.contactId,
        ghlContactId: data.contactGhlContactId,
        locationId: data.contactLocationId,
        recordId: data.contactRecordId,
        firstName: data.contactFirstName,
        lastName: data.contactLastName,
        displayName: data.contactDisplayName,
        email: data.contactEmail,
        email2: data.contactEmail2,
        phone: data.contactPhone,
        title: data.contactTitle,
        gender: data.contactGender,
        address: data.contactAddress,
        createdAt: data.contactCreatedAt,
        updatedAt: data.contactUpdatedAt,
      },
      // Donation Information
      donation: {
        id: data.id,
        amount: data.amount,
        currency: data.currency,
        amountUsd: data.amountUsd,
        exchangeRate: data.exchangeRate,
        paymentDate: data.paymentDate,
        receivedDate: data.receivedDate,
        checkDate: data.checkDate,
        accountId: data.accountId,
        campaignId: data.campaignId,
        campaignName: data.campaignName,
        paymentMethod: data.paymentMethod,
        methodDetail: data.methodDetail,
        paymentStatus: data.paymentStatus,
        referenceNumber: data.referenceNumber,
        checkNumber: data.checkNumber,
        receiptNumber: data.receiptNumber,
        receiptType: data.receiptType,
        receiptIssued: data.receiptIssued,
        solicitorId: data.solicitorId,
        solicitorName: data.solicitorName,
        bonusPercentage: data.bonusPercentage,
        bonusAmount: data.bonusAmount,
        bonusRuleId: data.bonusRuleId,
        notes: data.notes,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      // Event metadata
      eventType: 'manual_donation_created',
      timestamp: new Date().toISOString(),
    };

    // Send to webhook
    const response = await fetch(MANUAL_DONATION_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload),
    });

    if (!response.ok) {
      throw new Error(`Webhook request failed with status: ${response.status}`);
    }

    console.log(`Manual donation data sent successfully to webhook for donation ID ${donationId}`);
    return { success: true, message: 'Webhook sent successfully' };

  } catch (error) {
    console.error(`Failed to send manual donation webhook for ID ${donationId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      donationId
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { donationId } = body;

    if (!donationId || typeof donationId !== 'number') {
      return NextResponse.json(
        { error: 'Valid donationId is required' },
        { status: 400 }
      );
    }

    const result = await sendManualDonationToWebhook(donationId);

    if (result.success) {
      return NextResponse.json(
        { message: 'Webhook sent successfully', data: result },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        { error: 'Failed to send webhook', details: result },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error in manual donation webhook route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Optional: GET endpoint to manually trigger webhook for testing
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const donationId = searchParams.get('donationId');

  if (!donationId) {
    return NextResponse.json(
      { error: 'donationId query parameter is required' },
      { status: 400 }
    );
  }

  const id = parseInt(donationId);
  if (isNaN(id)) {
    return NextResponse.json(
      { error: 'Invalid donationId' },
      { status: 400 }
    );
  }

  const result = await sendManualDonationToWebhook(id);

  if (result.success) {
    return NextResponse.json(
      { message: 'Webhook sent successfully', data: result },
      { status: 200 }
    );
  } else {
    return NextResponse.json(
      { error: 'Failed to send webhook', details: result },
      { status: 500 }
    );
  }
}
