import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contact, manualDonation, campaign } from '@/lib/db/schema';
import type { Contact, ManualDonation, Campaign } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

// Helper: safely extract error message
function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Helper: normalize phone
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  return phone.replace(/[\s\-\(\)\+]/g, '');
}

// Helper: normalize email
function normalizeEmail(email: string | null | undefined): string | null {
  if (!email?.trim()) return null;
  return email.toLowerCase().trim();
}

// Helper: normalize name (handle dashes, empty strings, etc.)
function normalizeName(name: string | null | undefined): string | undefined {
  if (!name?.trim()) return undefined;
  const cleaned = name.trim();
  if (cleaned === '-' || cleaned === '_' || cleaned === 'N/A' || cleaned === 'n/a') return undefined;
  return cleaned;
}

// Flatten keys like 'customData[firstname]' to 'firstname'
function flattenCustomDataKeys(data: Record<string, string>): Record<string, string> {
  const flatData: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    const customDataMatch = key.match(/^customData\[(.+)\]$/);
    if (customDataMatch) {
      flatData[customDataMatch[1]] = value;
    } else {
      flatData[key] = value;
    }
  }
  return flatData;
}

// Schema for webhook data
const webhookSchema = z.object({
  contact_id: z.string().optional(),
  firstname: z.string().optional(),
  lastname: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  payer_first_name: z.string().optional(),
  payer_last_name: z.string().optional(),
  payer_name: z.string().optional(),
  payer_email: z.string().email("Invalid email format").optional().or(z.literal("")),
  displayname: z.string().optional(),
  display_name: z.string().optional(),
  title: z.string().optional(),
  full_name: z.string().optional(),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  address: z.string().optional(),
  tags: z.string().optional(),
  country: z.string().optional(),
  date_created: z.string().optional(),
  contact_type: z.string().optional(),
  location: z.string().optional(),
  workflow: z.string().optional(),
  triggerData: z.string().optional(),
  contact: z.string().optional(),
  attributionSource: z.string().optional(),
  customData: z.string().optional(),
  ghlcontactid: z.string().optional(),
  locationid: z.string().optional(),
  campaignname: z.string().optional(),
  amount: z.string().optional(),
  currency: z.string().optional(),
  paymentmethod: z.string().optional(),
  account: z.string().optional(),
}).catchall(z.string().optional());

// Extract names
function extractNames(data: Record<string, string | undefined>): { firstName: string | undefined; lastName: string | undefined } {
  let firstName = normalizeName(
    data.firstname || 
    data.first_name || 
    data.payer_first_name
  );
  let lastName = normalizeName(
    data.lastname || 
    data.last_name || 
    data.payer_last_name
  );

  if ((!firstName || !lastName) && data.full_name) {
    const fullName = data.full_name.trim();
    const parts = fullName.split(' ').filter((p: string) => p.trim() && p !== '-');
    if (parts.length >= 2) {
      if (!firstName) firstName = parts[0];
      if (!lastName) lastName = parts.slice(1).join(' ');
    } else if (parts.length === 1) {
      if (!firstName && !lastName) {
        lastName = parts[0];
        firstName = 'N/A';
      } else if (!firstName) {
        firstName = parts[0];
      } else if (!lastName) {
        lastName = parts[0];
      }
    }
  }

  // Handle payer_name if we still don't have names
  if ((!firstName || !lastName) && data.payer_name) {
    const payerName = data.payer_name.trim();
    const parts = payerName.split(' ').filter((p: string) => p.trim() && p !== '-');
    if (parts.length >= 2) {
      if (!firstName) firstName = parts[0];
      if (!lastName) lastName = parts.slice(1).join(' ');
    } else if (parts.length === 1) {
      if (!firstName && !lastName) {
        lastName = parts[0];
        firstName = 'N/A';
      } else if (!firstName) {
        firstName = parts[0];
      } else if (!lastName) {
        lastName = parts[0];
      }
    }
  }

  if (!firstName && lastName) firstName = 'N/A';
  if (!lastName && firstName) lastName = 'N/A';

  return { firstName, lastName };
}

// Extract display name
function extractDisplayName(data: Record<string, string | undefined>, firstName: string | undefined, lastName: string | undefined): string | undefined {
  let displayName = data.displayname?.trim() || 
                    data.display_name?.trim() || 
                    data.payer_name?.trim();
  
  if (!displayName && firstName && lastName) {
    if (firstName === 'N/A') displayName = lastName;
    else if (lastName === 'N/A') displayName = firstName;
    else displayName = `${firstName} ${lastName}`;
  }
  if (displayName) {
    displayName = displayName
      .replace(/-, \( & \)$/, '')
      .replace(/^-, /, '')
      .replace(/ & $/, '')
      .replace(/\(\s*&\s*\)/, '')
      .trim();
    if (!displayName || displayName === '-' || displayName === ',' || displayName === '()') {
      displayName = undefined;
    }
  }
  return displayName;
}

// Find or create campaign
async function handleCampaignUpsert(campaignName: string, locationId?: string): Promise<Campaign> {
  try {
    // Try to find existing campaign by name and location
    const conditions = [eq(campaign.name, campaignName)];
    if (locationId) {
      conditions.push(eq(campaign.locationId, locationId));
    }
    
    const existingCampaign = await db
      .select()
      .from(campaign)
      .where(and(...conditions))
      .limit(1);

    if (existingCampaign.length) {
      console.log(`Found existing campaign: ${campaignName}`);
      return existingCampaign[0];
    }

    // Create new campaign
    const newCampaign = await db.insert(campaign).values({
      name: campaignName,
      status: 'active',
      locationId: locationId || null,
    }).returning();

    console.log(`Created new campaign: ${campaignName}`);
    return newCampaign[0];
  } catch (error) {
    console.error(`Error handling campaign for ${campaignName}:`, error);
    throw error;
  }
}

// Find or create contact
async function handleContactUpsert(data: {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address?: string | undefined;
  displayName?: string | undefined;
  title?: string | undefined;
  externalContactId?: string;
  ghlContactId?: string;
  locationId?: string;
}): Promise<Contact> {
  const { firstName, lastName, email, phone, address, displayName, title, externalContactId, ghlContactId, locationId } = data;

  let existingContact: Contact[] = [];

  // 1. Match by GHL ID (primary)
  if (ghlContactId) {
    existingContact = await db.select().from(contact).where(eq(contact.ghlContactId, ghlContactId)).limit(1);
    if (existingContact.length) {
      console.log(`Found contact by GHL ID: ${ghlContactId}`);
    }
  }

  // 2. Fallback: email (only if not found by GHL ID)
  if (!existingContact.length && email) {
    existingContact = await db.select().from(contact).where(eq(contact.email, email)).limit(1);
    if (existingContact.length) {
      console.log(`Found contact by email: ${email}`);
    }
  }

  if (existingContact.length) {
    const updateData: Partial<Contact> = { updatedAt: new Date() };
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (displayName !== undefined) updateData.displayName = displayName;
    if (title !== undefined) updateData.title = title;
    if (ghlContactId !== undefined) updateData.ghlContactId = ghlContactId;
    if (locationId !== undefined) updateData.locationId = locationId;

    const updated = await db.update(contact).set(updateData).where(eq(contact.id, existingContact[0].id)).returning();
    console.log(`Updated existing contact ID: ${updated[0].id}`);
    return updated[0];
  } else {
    const inserted = await db.insert(contact).values({
      firstName,
      lastName,
      email,
      phone,
      address,
      displayName,
      title,
      ghlContactId,
      locationId,
    }).returning();
    console.log(`Created new contact ID: ${inserted[0].id}`);
    return inserted[0];
  }
}

// Create manual donation
async function createManualDonation(data: {
  contactId: number;
  amount: string;
  currency: string;
  paymentMethod: string;
  campaignId?: number;
  locationId?: string;
}): Promise<ManualDonation> {
  const { contactId, amount, currency, paymentMethod, campaignId } = data;
  
  // Validate currency (must be one of the enum values)
  const validCurrencies = ['USD', 'ILS', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'ZAR'];
  const normalizedCurrency = currency.toUpperCase();
  
  if (!validCurrencies.includes(normalizedCurrency)) {
    throw new Error(`Invalid currency: ${currency}. Must be one of: ${validCurrencies.join(', ')}`);
  }

  const currentDate = new Date().toISOString().split('T')[0]; // Current date in YYYY-MM-DD format

  const donation = await db.insert(manualDonation).values({
    contactId,
    amount,
    currency: normalizedCurrency as any,
    amountUsd: amount, // Same as amount received
    exchangeRate: "1", // Always 1 for all cases
    paymentDate: currentDate,
    receivedDate: currentDate, // Set to current date as requested
    checkDate: null,
    accountId: null,
    campaignId: campaignId || null,
    paymentMethod,
    methodDetail: null,
    paymentStatus: 'completed',
    referenceNumber: null,
    checkNumber: null,
    receiptNumber: null,
    receiptType: null,
    receiptIssued: false,
    solicitorId: null,
    bonusPercentage: null,
    bonusAmount: null,
    bonusRuleId: null,
    notes: null,
  }).returning();

  console.log(`Created manual donation ID: ${donation[0].id} for contact ${contactId}`);
  return donation[0];
}

export async function POST(request: NextRequest) {
  try {
    console.log('=== Webhook Debug ===');
    console.log('URL:', request.url);
    console.log('Method:', request.method);
    const contentType = request.headers.get('content-type') || '';
    console.log('Content-Type:', contentType);

    const url = new URL(request.url);
    let data: Record<string, string> = Object.fromEntries(url.searchParams.entries());
    let dataSource = 'query_parameters';

    if (!Object.keys(data).length) {
      if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data') || contentType === '') {
        const formData = await request.formData();
        data = {};
        for (const [k, v] of formData.entries()) data[k] = v.toString();
        dataSource = 'form_data';
      } else if (contentType.includes('application/json')) {
        const json = await request.json();
        data = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, String(v)]));
        dataSource = 'json_body';
      } else {
        const text = await request.text();
        if (text.trim()) {
          const params = new URLSearchParams(text);
          data = {};
          for (const [k, v] of params.entries()) data[k] = v;
          dataSource = 'url_encoded_text';
        }
      }
    }

    console.log('Received data:', data, 'Source:', dataSource);

    if (!Object.keys(data).length) {
      return NextResponse.json({ success: false, message: 'No data found', code: 'NO_DATA' }, { status: 400 });
    }

    data = flattenCustomDataKeys(data);

    const parsed = webhookSchema.safeParse(data);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: 'Data validation failed',
          code: 'VALIDATION_ERROR',
          errors: parsed.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
            received: data[e.path[0] as string],
          })),
          debug: { data, dataSource },
        },
        { status: 400 }
      );
    }

    const validData = parsed.data;
    const { firstName, lastName } = extractNames(validData);

    if (!firstName || !lastName) {
      return NextResponse.json({
        success: false,
        message: 'Unable to extract valid first name and last name',
        code: 'MISSING_REQUIRED_FIELDS',
        received: { firstName, lastName, full_name: validData.full_name, payer_name: validData.payer_name },
        debug: { availableFields: Object.keys(validData), dataSource },
      }, { status: 400 });
    }

    const displayName = extractDisplayName(validData, firstName, lastName);
    const title = validData.title?.trim() || undefined;
    const email = normalizeEmail(validData.email || validData.payer_email);
    const phone = normalizePhone(validData.phone);
    const address = validData.address?.trim() || undefined;
    const ghlContactId = validData.ghlcontactid?.trim();
    const locationId = validData.locationid?.trim();

    // Handle campaign if provided
    let campaignRecord: Campaign | undefined;
    if (validData.campaignname?.trim()) {
      try {
        campaignRecord = await handleCampaignUpsert(validData.campaignname.trim(), locationId);
      } catch (error) {
        console.error('Error handling campaign:', error);
        // Continue without campaign if there's an error
      }
    }

    // Handle contact (find or create)
    const contactRecord = await handleContactUpsert({
      firstName,
      lastName,
      email,
      phone,
      address,
      displayName,
      title,
      ghlContactId,
      locationId,
      externalContactId: validData.contact_id,
    });

    // Create manual donation if payment details are provided
    let donationRecord: ManualDonation | undefined;
    
    console.log('Payment fields received:', {
      amount: validData.amount,
      currency: validData.currency,
      paymentmethod: validData.paymentmethod,
      account: validData.account
    });
    
    if (validData.amount && validData.currency) {
      try {
        const paymentMethod = validData.paymentmethod || validData.account || 'unknown';
        
        console.log('Creating manual donation with:', {
          contactId: contactRecord.id,
          amount: validData.amount,
          currency: validData.currency,
          paymentMethod,
          campaignId: campaignRecord?.id,
        });
        
        donationRecord = await createManualDonation({
          contactId: contactRecord.id,
          amount: validData.amount,
          currency: validData.currency,
          paymentMethod,
          campaignId: campaignRecord?.id,
          locationId,
        });
      } catch (error) {
        console.error('Error creating manual donation:', error);
        return NextResponse.json(
          {
            success: false,
            message: 'Contact created/updated but failed to create donation',
            code: 'DONATION_CREATION_FAILED',
            contact: contactRecord,
            campaign: campaignRecord,
            error: getErrorMessage(error),
          },
          { status: 500 }
        );
      }
    } else {
      console.log('Skipping donation creation - missing amount or currency');
    }

    console.log(`Successfully processed webhook - Contact: ${contactRecord.id}, Donation: ${donationRecord?.id || 'N/A'}`);

    return NextResponse.json({
      success: true,
      message: 'Webhook processed successfully',
      code: 'SUCCESS',
      contact: contactRecord,
      campaign: campaignRecord,
      donation: donationRecord,
      source: dataSource,
    }, { status: 200 });

  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Unexpected server error',
        code: 'SERVER_ERROR',
        debug: process.env.NODE_ENV === 'development' ? { error: getErrorMessage(error) } : undefined,
      },
      { status: 500 }
    );
  }
}