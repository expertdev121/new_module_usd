import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { pledge, contact, campaign } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

// Schema for send pledge request
const sendPledgeSchema = z.object({
  pledgeId: z.number().positive(),
  type: z.literal('pledge'),
});

// Helper function to send pledge data to webhook
async function sendPledgeToWebhook(pledgeData: {
  pledgeId: number;
  description?: string;
  originalAmount?: string;
  currency?: string;
  pledgeDate: string;
  campaignCode?: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  campaign?: string;
}, PLEDGE_WEBHOOK_URL: string) {
  try {
    const formData = new FormData();
    formData.append('pledgeId', pledgeData.pledgeId.toString());
    if (pledgeData.description) formData.append('description', pledgeData.description);
    if (pledgeData.originalAmount) formData.append('originalAmount', pledgeData.originalAmount);
    if (pledgeData.currency) formData.append('currency', pledgeData.currency);
    formData.append('pledgeDate', pledgeData.pledgeDate);
    if (pledgeData.campaignCode) formData.append('campaignCode', pledgeData.campaignCode);
    formData.append('name', pledgeData.contactName);
    formData.append('email', pledgeData.contactEmail);
    if (pledgeData.contactPhone) formData.append('phone', pledgeData.contactPhone);
    if (pledgeData.campaign) formData.append('campaign', pledgeData.campaign);

    const response = await fetch(PLEDGE_WEBHOOK_URL, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Webhook request failed with status: ${response.status}`);
    }

    console.log(`Pledge data sent successfully for pledge ${pledgeData.pledgeId} to ${pledgeData.contactEmail}`);
    return true;
  } catch (error) {
    console.error(`Failed to send pledge data for pledge ${pledgeData.pledgeId}:`, error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the session to access admin's location ID
    const session = await getServerSession(authOptions);
    if (!session || !session.user.locationId) {
      return NextResponse.json({
        success: false,
        message: 'Unauthorized or no location ID found',
        code: 'UNAUTHORIZED',
      }, { status: 401 });
    }

    const adminLocationId = session.user.locationId;

    // Determine PLEDGE_WEBHOOK_URL based on admin's location ID (same as receipt)
    let PLEDGE_WEBHOOK_URL: string | null = null;
    if (adminLocationId === 'E7yO96aiKmYvsbU2tRzc') {
      PLEDGE_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/E7yO96aiKmYvsbU2tRzc/webhook-trigger/5e3721b4-a558-4547-8e56-376cc4741214';
    }else {
      return NextResponse.json({
        success: false,
        message: 'Pledge sending not supported for this location',
        code: 'LOCATION_NOT_SUPPORTED',
      }, { status: 400 });
    }

    const body = await request.json();
    console.log('Send pledge request:', JSON.stringify(body, null, 2));

    // Validate incoming data
    const parsed = sendPledgeSchema.safeParse(body);
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

    const { pledgeId } = parsed.data;

    // Fetch pledge details
    const pledgeResult = await db
      .select({
        id: pledge.id,
        description: pledge.description,
        originalAmount: pledge.originalAmount,
        currency: pledge.currency,
        pledgeDate: pledge.pledgeDate,
        campaignCode: pledge.campaignCode,
        contactId: pledge.contactId,
      })
      .from(pledge)
      .where(eq(pledge.id, pledgeId))
      .limit(1);

    if (!pledgeResult.length) {
      return NextResponse.json({
        success: false,
        message: 'Pledge not found',
        code: 'PLEDGE_NOT_FOUND',
      }, { status: 404 });
    }

    const pledgeData = pledgeResult[0];

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
      .where(eq(contact.id, pledgeData.contactId))
      .limit(1);

    if (!contactResult.length) {
      return NextResponse.json({
        success: false,
        message: 'Contact not found',
        code: 'CONTACT_NOT_FOUND',
      }, { status: 404 });
    }

    const contactData = contactResult[0];

    // Check if contact has email
    if (!contactData.email) {
      return NextResponse.json({
        success: false,
        message: 'Contact has no email address',
        code: 'NO_EMAIL',
      }, { status: 400 });
    }

    // Fetch campaign name if available
    let campaignName: string | undefined;
    // Note: campaignId is not selected in pledge query, so we can't fetch campaign name
    // If needed, we can add campaignId back to the select and handle it

    // Send to webhook
    const webhookSuccess = await sendPledgeToWebhook({
      pledgeId: pledgeData.id,
      description: pledgeData.description || undefined,
      originalAmount: pledgeData.originalAmount?.toString() || undefined,
      currency: pledgeData.currency || undefined,
      pledgeDate: pledgeData.pledgeDate,
      campaignCode: pledgeData.campaignCode || undefined,
      contactName: `${contactData.firstName} ${contactData.lastName}`.trim(),
      contactEmail: contactData.email,
      contactPhone: contactData.phone || undefined,
      campaign: campaignName,
    }, PLEDGE_WEBHOOK_URL);

    if (!webhookSuccess) {
      return NextResponse.json({
        success: false,
        message: 'Failed to send pledge data to webhook',
        code: 'WEBHOOK_SEND_FAILED',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Pledge data sent successfully',
      code: 'PLEDGE_SENT',
      pledgeId: pledgeData.id,
      email: contactData.email,
    });

  } catch (error: unknown) {
    console.error('Unexpected error in send pledge:', error);
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
    message: 'Send pledge endpoint is active',
    methods: ['POST'],
    note: 'Sends pledge and contact details to webhook when a pledge is created',
    example: {
      jsonBody: {
        pledgeId: 123,
        type: "pledge"
      }
    }
  }, { status: 200 });
}
