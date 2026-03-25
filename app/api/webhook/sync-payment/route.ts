import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contact, manualDonation, campaign } from '@/lib/db/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { sendN8nManualDonationWebhook } from '@/lib/utils/send-n8n-manual-donation';

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
  "Record ID": z.union([z.string(), z.number()]).optional().transform(val => val?.toString()),
  "Campaign Name": z.union([z.string(), z.array(z.string())]).optional().transform(val => {
    if (Array.isArray(val)) return val[0] || '';
    return val || '';
  }),
  "Event Code": z.string().optional(),
  "Donation Amount": z.union([z.string(), z.number()]).optional().transform(val => val?.toString()),
  "Donation Date": z.string().optional(),
  "Donation Method": z.string().optional(),
  "Payment Method (Required)": z.string().optional(),
  "Check Number": z.string().optional(),
  "Check or Reference Number": z.string().optional(),
}).catchall(z.any());

// Helper: normalize email to lowercase trimmed
function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

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

    const email = normalizeEmail(data.email || customData?.email || '');
    const phone = customData?.phone || data.phone || '';
    const address = data.full_address || '';
    const recordId = customData?.reocrd_id || data["Record ID"] || '';
    const contactSource = data.contact_source || '';

    // Extract payment information from customData
    const paymentAmount = customData?.payment_amount || customData?.payment_invoice_amount;
    const paymentDate = customData?.payment_date;
    const paymentMethod = customData?.payment_method;

    // Get campaign name from customData first, then root level
    const campaignName = customData?.campaign || data["Campaign Name"] || data["Event Code"] || '';
    const donationAmount = data["Donation Amount"] || '';
    const donationDate = data["Donation Date"] || '';
    const donationMethod = data["Donation Method"] || data["Payment Method (Required)"] || '';
    const checkNumber = data["Check Number"] || data["Check or Reference Number"] || '';

    // Use root level fields as fallback if customData fields are empty
    const finalAmount = paymentAmount || donationAmount;
    const finalDate = paymentDate || donationDate;
    const finalMethod = paymentMethod || donationMethod || 'Online Payment';

    console.log('\n--- Extracted Data ---');
    console.log('Contact ID (GHL):', ghlContactId);
    console.log('Location ID:', locationId);
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

    const formattedDate = donationDateObj.toISOString().split('T')[0];

    // ─── CONTACT DEDUP (location-scoped) ─────────────────────────────────────
    // Match priority:
    //   1. ghlContactId match within this location (most reliable)
    //   2. email match within this location (handles manually-created contacts
    //      that predate GHL sync)
    //
    // Crucially, both conditions are scoped to locationId so a contact at
    // Location A is never confused with a same-email contact at Location B.

    const contactOrConditions = [eq(contact.ghlContactId, ghlContactId)];
    if (email) {
      contactOrConditions.push(eq(contact.email, email));
    }

    // Build the full WHERE: locationId AND (ghlContactId OR email)
    const contactWhereClause = locationId
      ? and(eq(contact.locationId, locationId), or(...contactOrConditions))
      : or(...contactOrConditions); // fallback if no locationId (edge case)

    const matchingContacts = await db
      .select()
      .from(contact)
      .where(contactWhereClause);

    console.log(`Found ${matchingContacts.length} matching contact(s) for locationId=${locationId}`);

    let contactId: number;

    if (matchingContacts.length === 0) {
      // ── No match: create new contact ──────────────────────────────────────
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
      // ── One or more matches found ─────────────────────────────────────────
      // Prefer the record that already has a ghlContactId match; fall back to
      // the first email match.
      const exactGhlMatch = matchingContacts.find(c => c.ghlContactId === ghlContactId);
      const chosen = exactGhlMatch || matchingContacts[0];
      contactId = chosen.id;

      console.log('Found existing contact with ID:', contactId);
      if (matchingContacts.length > 1) {
        console.warn(
          `WARNING: ${matchingContacts.length} duplicate contacts found for ` +
          `ghlContactId=${ghlContactId} / email=${email} / locationId=${locationId}. ` +
          `Using contact ID ${contactId}. Consider merging IDs: ${matchingContacts.map(c => c.id).join(', ')}`
        );
      }

      // Update chosen contact — fill in any missing fields, link ghlContactId
      await db
        .update(contact)
        .set({
          firstName,
          lastName,
          email: email || chosen.email,
          phone: phone || chosen.phone,
          address: address || chosen.address,
          recordId: recordId || chosen.recordId,
          locationId: locationId || chosen.locationId,
          // Always write the ghlContactId so future lookups hit the fast path
          ghlContactId: chosen.ghlContactId || ghlContactId,
          updatedAt: new Date(),
        })
        .where(eq(contact.id, contactId));

      console.log('Updated contact information');
    }

    // ─── DONATION DEDUP (location-scoped) ────────────────────────────────────
    // Gather all contact IDs sharing this email WITHIN THE SAME LOCATION.
    // Scoping to locationId prevents a donation at Location A from blocking
    // an identical donation at Location B.

    let allContactIdsForEmail: number[] = [contactId];
    if (email && locationId) {
      const emailMatches = await db
        .select({ id: contact.id })
        .from(contact)
        .where(
          and(
            eq(contact.email, email),
            eq(contact.locationId, locationId)
          )
        );
      allContactIdsForEmail = [...new Set(emailMatches.map(c => c.id))];
    } else if (email) {
      // No locationId available — fall back to email-only (original behaviour)
      const emailMatches = await db
        .select({ id: contact.id })
        .from(contact)
        .where(eq(contact.email, email));
      allContactIdsForEmail = [...new Set(emailMatches.map(c => c.id))];
    }

    // Guard: ensure the array is never empty (contactId is always valid here)
    if (allContactIdsForEmail.length === 0) {
      allContactIdsForEmail = [contactId];
    }

    // Check for duplicate donation across all relevant contact IDs
    const existingDonation = await db
      .select()
      .from(manualDonation)
      .where(
        and(
          sql`${manualDonation.contactId} = ANY(ARRAY[${sql.join(
            allContactIdsForEmail.map(id => sql`${id}`),
            sql`, `
          )}]::int[])`,
          eq(manualDonation.paymentDate, formattedDate),
          eq(manualDonation.amount, donationAmountNum.toFixed(2))
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

    // ─── CAMPAIGN FIND OR CREATE (location-scoped) ────────────────────────────
    // Campaign names are scoped per location so "Annual Gala" at Location A
    // does not bleed into Location B's reporting.

    let campaignId: number | null = null;
    if (campaignName && campaignName.trim() !== '') {
      const campaignWhereClause = locationId
        ? and(
            eq(campaign.name, campaignName.trim()),
            eq(campaign.locationId, locationId)
          )
        : eq(campaign.name, campaignName.trim()); // fallback if no locationId

      const existingCampaign = await db
        .select()
        .from(campaign)
        .where(campaignWhereClause)
        .limit(1);

      if (existingCampaign.length > 0) {
        campaignId = existingCampaign[0].id;
        console.log('Found existing campaign:', campaignName, 'with ID:', campaignId);
      } else {
        const [newCampaign] = await db
          .insert(campaign)
          .values({
            name: campaignName.trim(),
            locationId,
            status: 'active',
          })
          .returning();

        campaignId = newCampaign.id;
        console.log('Created new campaign:', campaignName, 'with ID:', campaignId);
      }
    }

    // ─── CREATE DONATION ──────────────────────────────────────────────────────
    const [newDonation] = await db
      .insert(manualDonation)
      .values({
        contactId,
        amount: donationAmountNum.toFixed(2),
        currency: 'USD',
        amountUsd: donationAmountNum.toFixed(2),
        paymentDate: formattedDate,
        receivedDate: formattedDate,
        campaignId,
        paymentMethod: finalMethod,
        paymentStatus: 'completed',
        checkNumber: checkNumber || null,
        receiptIssued: false,
        notes: `Imported from GHL. Workflow: ${data.workflow?.name || 'N/A'}. Record ID: ${recordId || 'N/A'}. Source: ${contactSource || 'N/A'}. Location: ${locationId || 'N/A'}`,
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
        locationId,
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
      'Deduplicates contacts by ghlContactId OR email — SCOPED to locationId',
      'Finds best matching contact when multiple exist (prefers ghlContactId match)',
      'Links ghlContactId to email-matched contacts for faster future lookups',
      'Checks for duplicate donations across contacts sharing email within same location',
      'Campaign find-or-create is scoped per location',
      'Normalizes email to lowercase for consistent matching',
      'All donations default to USD currency',
      'Supports MM/DD/YYYY date format',
      'Stores Record ID and locationId for tracking',
      'Logs all webhook data for debugging',
    ],
    currency: 'USD (fixed)',
    dateFormat: 'Supports both MM/DD/YYYY and ISO format',
  }, { status: 200 });
}