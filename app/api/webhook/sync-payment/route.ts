import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contact, manualDonation, campaign } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

// Schema for the webhook data from GHL
const ghlWebhookSchema = z.object({
  contact_id: z.string(),
  full_name: z.string().optional(),
  phone: z.string().optional(),
  tags: z.string().optional(),
  country: z.string().optional(),
  date_created: z.string().optional(),
  full_address: z.string().optional(),
  contact_type: z.string().optional(),
  location: z.object({
    name: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    postalCode: z.string().optional(),
    fullAddress: z.string().optional(),
    id: z.string(),
  }).optional(),
  workflow: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
  }).optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  contact_source: z.string().optional(),
  customData: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    reocrd_id: z.string().optional(),
    payment_amount: z.string().optional(),
    payment_method: z.string().optional(),
    payment_date: z.string().optional(),
    payment_invoice_amount: z.string().optional(),
    location_id: z.string().optional(),
    contact_id: z.string().optional(),
    campaign: z.string().optional(),
  }).optional(),
}).catchall(z.any());

export async function POST(request: NextRequest) {
  try {
    console.log('\n=== GHL WEBHOOK RECEIVED ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('URL:', request.url);

    const body = await request.json();
    console.log('\n--- Full Request Body ---');
    console.log(JSON.stringify(body, null, 2));

    // Validate the webhook data
    const parsed = ghlWebhookSchema.safeParse(body);
    if (!parsed.success) {
      console.error('Validation errors:', parsed.error.errors);
      return NextResponse.json({
        success: false,
        message: 'Invalid webhook data format',
        errors: parsed.error.errors,
      }, { status: 400 });
    }

    const data = parsed.data;
    const locationId = data.location?.id || data.customData?.location_id;
    const customData = data.customData;

    // Extract contact information
    const ghlContactId = data.contact_id;
    
    // Prioritize root level first_name and last_name
    let firstName = data.first_name || '';
    let lastName = data.last_name || '';
    
    // If not available at root, try to split from customData.name or full_name
    if (!firstName || !lastName) {
      const fullName = customData?.name || data.full_name || '';
      if (fullName && fullName.trim() !== '') {
        const nameParts = fullName.trim().split(' ');
        firstName = firstName || nameParts[0] || '';
        lastName = lastName || nameParts.slice(1).join(' ') || '';
      }
    }

    const email = data.email || customData?.email || '';
    const phone = customData?.phone || data.phone || '';
    const address = data.full_address || '';
    const recordId = customData?.reocrd_id || (body as any)["Record ID"]?.toString() || '';
    const contactSource = data.contact_source || '';

    // Extract payment information from customData
    const paymentAmount = customData?.payment_amount || customData?.payment_invoice_amount;
    const paymentDate = customData?.payment_date;
    const paymentMethod = customData?.payment_method;

    // Get campaign name from customData first, then root level
    const campaignName = customData?.campaign || (body as any)["Campaign Name"] || (body as any)["Event Code"] || '';
    const donationAmount = (body as any)["Donation Amount"] || '';
    const donationDate = (body as any)["Donation Date"] || '';
    const donationMethod = (body as any)["Donation Method"] || (body as any)["Payment Method (Required)"] || '';
    const checkNumber = (body as any)["Check Number"] || (body as any)["Check or Reference Number"] || '';

    // Use root level fields as fallback if customData fields are empty
    const finalAmount = paymentAmount || donationAmount;
    const finalDate = paymentDate || donationDate;
    const finalMethod = paymentMethod || donationMethod || 'Online Payment';

    console.log('\n--- Extracted Data ---');
    console.log('Contact ID (GHL):', ghlContactId);
    console.log('Record ID:', recordId);
    console.log('First Name:', firstName);
    console.log('Last Name:', lastName);
    console.log('Email:', email);
    console.log('Phone:', phone);
    console.log('Contact Source:', contactSource);
    console.log('Payment Amount:', finalAmount);
    console.log('Payment Date:', finalDate);
    console.log('Payment Method:', finalMethod);
    console.log('Campaign:', campaignName);
    console.log('Check Number:', checkNumber);

    // Validate required fields
    if (!firstName || !lastName) {
      return NextResponse.json({
        success: false,
        message: 'First name and last name are required',
        code: 'MISSING_NAME',
        debug: {
          root_first_name: data.first_name,
          root_last_name: data.last_name,
          customData_name: customData?.name,
          full_name: data.full_name,
        }
      }, { status: 400 });
    }

    if (!finalAmount || finalAmount.trim() === '') {
      return NextResponse.json({
        success: false,
        message: 'Payment amount is required',
        code: 'MISSING_AMOUNT',
        debug: {
          payment_amount: paymentAmount,
          payment_invoice_amount: customData?.payment_invoice_amount,
          donation_amount: donationAmount,
        }
      }, { status: 400 });
    }

    if (!finalDate || finalDate.trim() === '') {
      return NextResponse.json({
        success: false,
        message: 'Payment date is required',
        code: 'MISSING_DATE',
        debug: {
          payment_date: paymentDate,
          donation_date: donationDate,
        }
      }, { status: 400 });
    }

    // Parse donation amount
    const donationAmountNum = parseFloat(finalAmount.replace(/[^0-9.-]+/g, ''));
    if (isNaN(donationAmountNum) || donationAmountNum <= 0) {
      return NextResponse.json({
        success: false,
        message: 'Invalid donation amount',
        code: 'INVALID_AMOUNT',
        receivedAmount: finalAmount,
      }, { status: 400 });
    }

    // Parse donation date - handle MM/DD/YYYY format
    let donationDateObj: Date;
    
    // Check if date is in MM/DD/YYYY format
    if (finalDate.includes('/')) {
      const [month, day, year] = finalDate.split('/');
      donationDateObj = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    } else {
      donationDateObj = new Date(finalDate);
    }
    
    if (isNaN(donationDateObj.getTime())) {
      return NextResponse.json({
        success: false,
        message: 'Invalid payment date',
        code: 'INVALID_DATE',
        receivedDate: finalDate,
      }, { status: 400 });
    }

    // Check if contact exists, if not create one
    const existingContact = await db
      .select()
      .from(contact)
      .where(eq(contact.ghlContactId, ghlContactId))
      .limit(1);

    let contactId: number;

    if (existingContact.length === 0) {
      console.log('Creating new contact...');
      const [newContact] = await db
        .insert(contact)
        .values({
          ghlContactId,
          locationId,
          recordId: recordId || null,
          firstName,
          lastName,
          email: email || null,
          phone: phone || null,
          address: address || null,
        })
        .returning();
      
      contactId = newContact.id;
      console.log('Created new contact with ID:', contactId);
    } else {
      contactId = existingContact[0].id;
      console.log('Found existing contact with ID:', contactId);
      
      // Update contact info if needed
      await db
        .update(contact)
        .set({
          firstName,
          lastName,
          email: email || existingContact[0].email,
          phone: phone || existingContact[0].phone,
          address: address || existingContact[0].address,
          recordId: recordId || existingContact[0].recordId,
          locationId: locationId || existingContact[0].locationId,
          updatedAt: new Date(),
        })
        .where(eq(contact.id, contactId));
      
      console.log('Updated contact information');
    }

    // Check for duplicate donation
    const formattedDate = donationDateObj.toISOString().split('T')[0];
    const existingDonation = await db
      .select()
      .from(manualDonation)
      .where(
        and(
          eq(manualDonation.contactId, contactId),
          eq(manualDonation.paymentDate, formattedDate),
          eq(manualDonation.amount, donationAmountNum.toString())
        )
      )
      .limit(1);

    if (existingDonation.length > 0) {
      console.log('Duplicate donation found, skipping creation');
      return NextResponse.json({
        success: true,
        message: 'Duplicate donation detected, skipped creation',
        code: 'DUPLICATE_SKIPPED',
        contactId,
        existingDonationId: existingDonation[0].id,
      });
    }

    // Find or create campaign if campaign name is provided
    let campaignId: number | null = null;
    if (campaignName && campaignName.trim() !== '') {
      const existingCampaign = await db
        .select()
        .from(campaign)
        .where(eq(campaign.name, campaignName))
        .limit(1);

      if (existingCampaign.length > 0) {
        campaignId = existingCampaign[0].id;
        console.log('Found existing campaign:', campaignName, 'with ID:', campaignId);
      } else {
        const [newCampaign] = await db
          .insert(campaign)
          .values({
            name: campaignName,
            locationId,
            status: 'active',
          })
          .returning();
        
        campaignId = newCampaign.id;
        console.log('Created new campaign:', campaignName, 'with ID:', campaignId);
      }
    }

    // Currency is always USD
    const currency = 'USD';

    // Create manual donation
    const [newDonation] = await db
      .insert(manualDonation)
      .values({
        contactId,
        amount: donationAmountNum.toString(),
        currency: 'USD',
        amountUsd: donationAmountNum.toString(),
        paymentDate: formattedDate,
        receivedDate: formattedDate,
        campaignId,
        paymentMethod: finalMethod,
        paymentStatus: 'completed',
        checkNumber: checkNumber || null,
        receiptIssued: false,
        notes: `Imported from GHL. Workflow: ${data.workflow?.name || 'N/A'}. Record ID: ${recordId || 'N/A'}. Source: ${contactSource || 'N/A'}`,
      })
      .returning();

    console.log('Created manual donation with ID:', newDonation.id);
    console.log('=== WEBHOOK PROCESSED SUCCESSFULLY ===\n');

    return NextResponse.json({
      success: true,
      message: 'Donation created successfully',
      code: 'DONATION_CREATED',
      data: {
        contactId,
        donationId: newDonation.id,
        amount: donationAmountNum,
        currency: 'USD',
        date: formattedDate,
        campaignId,
        recordId,
      },
    });

  } catch (error: unknown) {
    console.error('\n=== WEBHOOK ERROR ===');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    console.error('=== END ERROR ===\n');

    return NextResponse.json({
      success: false,
      message: 'Error processing webhook',
      code: 'SERVER_ERROR',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'GHL Payment/Donation webhook endpoint is active',
    methods: ['POST'],
    description: 'Processes GHL payment webhooks and creates manual donations',
    features: [
      'Creates or updates contacts based on GHL contact ID',
      'Creates manual donations with duplicate checking',
      'Handles campaign creation if needed',
      'All donations default to USD currency',
      'Supports MM/DD/YYYY date format',
      'Stores Record ID for tracking',
      'Logs all webhook data for debugging'
    ],
    dataSource: 'customData fields with root level fallbacks',
    expectedFields: {
      rootLevel: {
        required: [
          'contact_id',
          'first_name',
          'last_name'
        ],
        optional: [
          'email',
          'phone',
          'contact_source',
          'Campaign Name',
          'Event Code',
          'Donation Amount (fallback)',
          'Donation Date (fallback)',
          'Donation Method (fallback)',
          'Payment Method (Required) (fallback)',
          'Check Number',
          'Check or Reference Number',
          'Record ID'
        ]
      },
      customData: {
        required: [
          'payment_amount or payment_invoice_amount',
          'payment_date'
        ],
        optional: [
          'name (fallback for first/last name)',
          'email',
          'phone',
          'payment_method',
          'reocrd_id',
          'location_id',
          'contact_id',
          'campaign'
        ]
      }
    },
    currency: 'USD (fixed)',
    dateFormat: 'Supports both MM/DD/YYYY and ISO format'
  }, { status: 200 });
}