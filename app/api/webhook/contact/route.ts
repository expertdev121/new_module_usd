import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contact } from '@/lib/db/schema';
import type { Contact } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { resolveContact } from '@/lib/contacts/resolve-contact';

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
}).catchall(z.string().optional());

// Extract names
function extractNames(data: Record<string, string | undefined>): { firstName: string | undefined; lastName: string | undefined } {
  let firstName = normalizeName(data.firstname || data.first_name);
  let lastName = normalizeName(data.lastname || data.last_name);

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

  if (!firstName && lastName) firstName = 'N/A';
  if (!lastName && firstName) lastName = 'N/A';

  return { firstName, lastName };
}

// Extract display name
function extractDisplayName(data: Record<string, string | undefined>, firstName: string | undefined, lastName: string | undefined): string | undefined {
  let displayName = data.displayname?.trim() || data.display_name?.trim();
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

// Upsert contact
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
}) {
  const { firstName, lastName, email, phone, address, displayName, title, externalContactId, ghlContactId, locationId } = data;

  /* Identity resolution (standardized 2026-08-14) — everything is
   * tenant-scoped through resolveContact:
   *   ghl_contact_id → email → phone (only if no email) → constituents_id
   * Name / displayName are intentionally NOT match keys anymore: matching
   * by name is what caused cross-person merges ("Chelsha" class of bug)
   * and false joins between different people who share a common name.
   *
   * If the webhook carries no locationId we fall back to a global
   * ghl_contact_id lookup only (GHL ids are globally unique); with no hit
   * we create a new unscoped contact — same conservative behavior as
   * before, since hijacking another tenant's record is the worse failure.
   */
  let matchedId: number | null = null;

  if (locationId) {
    const resolved = await resolveContact(
      { locationId, email, phone, ghlContactId, firstName, lastName, displayName, address },
      { createIfMissing: false },
    );
    matchedId = resolved.contactId;
  } else if (ghlContactId) {
    const rows = await db.select({ id: contact.id }).from(contact)
      .where(eq(contact.ghlContactId, ghlContactId)).limit(1);
    matchedId = rows[0]?.id ?? null;
  }

  if (matchedId != null) {
    const updateData: Partial<Contact> = { updatedAt: new Date() };
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (displayName !== undefined) updateData.displayName = displayName;
    if (title !== undefined) updateData.title = title;
    if (ghlContactId !== undefined) updateData.ghlContactId = ghlContactId;
    if (locationId !== undefined) updateData.locationId = locationId;

    const updated = await db.update(contact).set(updateData).where(eq(contact.id, matchedId)).returning();
    return { contact: { ...updated[0], externalContactId }, isNew: false, action: "updated" as const };
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
    return { contact: { ...inserted[0], externalContactId }, isNew: true, action: "created" as const };
  }
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
        received: { firstName, lastName, full_name: validData.full_name },
        debug: { availableFields: Object.keys(validData), dataSource },
      }, { status: 400 });
    }

    const displayName = extractDisplayName(validData, firstName, lastName);
    const title = validData.title?.trim() || undefined;
    const email = normalizeEmail(validData.email);
    const phone = normalizePhone(validData.phone);
    const address = validData.address?.trim() || undefined;
    const ghlContactId = validData.ghlcontactid?.trim();
    const locationId = validData.locationid?.trim();

    const result = await handleContactUpsert({
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

    console.log(`Successfully ${result.action} contact with ID: ${result.contact.id}`);

    return NextResponse.json({
      success: true,
      message: `Contact ${result.action} successfully`,
      code: result.isNew ? 'CONTACT_CREATED' : 'CONTACT_UPDATED',
      contact: result.contact,
      source: dataSource,
      action: result.action,
    }, { status: result.isNew ? 201 : 200 });

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

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Webhook endpoint is active',
    methods: ['POST'],
    note: 'Accepts data via query, form data, or JSON body. Matches contact by ghlContactId, firstname+lastname, email, or displayName. Creates user account if email is provided.',
    example: {
      queryParams: '/api/webhook/contact?firstname=John&lastname=Doe&email=john@test.com&ghlcontactid=123&locationid=loc_abc',
      formData: 'POST form data: firstname, lastname, email, ghlcontactid, locationid, etc.',
      jsonBody: 'POST JSON body: {"firstname": "John", "lastname": "Doe", "email": "john@test.com", "ghlcontactid": "123", "locationid": "loc_abc"}',
    }
  }, { status: 200 });
}