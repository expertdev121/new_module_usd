import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { contact, manualDonation } from '@/lib/db/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { z } from 'zod';

// ─── Schema matching your GHL workflow custom data fields ─────────────────────
const stripePaymentWebhookSchema = z.object({
  // Your custom data fields (lowercase, no spaces)
  displayname: z.string().optional(),   // {{inboundWebhookRequest.data.object.customer_name}}
  email: z.string().optional(),         // {{inboundWebhookRequest.data.object.customer_email}}
  amount: z                             // {{inboundWebhookRequest.data.object.amount}} — Stripe sends cents
    .union([z.string(), z.number()])
    .optional()
    .transform(val => val?.toString()),
  paymentmethod: z.string().optional(), // hardcoded "card"
  locationid: z.string().optional(),    // hardcoded NikJ6tAcHSe8UCLgYMqM
  receiveddate: z.string().optional(),  // {{right_now.middle_endian_date}} → MM/DD/YYYY

  // GHL standard data fields also sent alongside custom data
  contact_id: z.string().optional(),
  ghlContactId: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  full_name: z.string().optional(),
  phone: z.string().optional(),
  full_address: z.string().optional(),
}).catchall(z.any());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Parse MM/DD/YYYY (GHL middle-endian) or ISO 8601.
 * Returns formatted YYYY-MM-DD string or null if invalid.
 */
function parseDate(raw: string): string | null {
  let d: Date;
  if (raw.includes('/')) {
    const [mm, dd, yyyy] = raw.split('/');
    if (!mm || !dd || !yyyy) return null;
    d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`);
  } else {
    d = new Date(raw);
  }
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function parseUnixTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const d = new Date(value * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function getSafeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Stripe sends amounts in cents (e.g. 5000 = $50.00).
 * If the value is a whole integer with no decimal point, divide by 100.
 * If it already has a decimal (e.g. "50.00"), use as-is.
 */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return null;
  // Divide by 100 only if it looks like raw Stripe cents (no decimal point)
  return !raw.includes('.') && Number.isInteger(num) ? num / 100 : num;
}

/**
 * Split "John Smith" → { firstName: "John", lastName: "Smith" }
 * Single word → { firstName: "John", lastName: "" }
 */
function splitName(displayName: string): { firstName: string; lastName: string } {
  const parts = displayName.trim().split(/\s+/);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const debugId = `stripe-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log('\n=== STRIPE SYNC-PAYMENT WEBHOOK RECEIVED ===');
    console.log('Debug ID:', debugId);
    console.log('Timestamp:', new Date().toISOString());

    const body = await request.json();
    console.log('\n--- Raw Body ---');
    console.log(JSON.stringify(body, null, 2));

    // Validate
    const parsed = stripePaymentWebhookSchema.safeParse(body);
    if (!parsed.success) {
      console.error('Validation errors:', parsed.error.errors);
      return NextResponse.json({
        success: false,
        message: 'Invalid webhook data',
        code: 'VALIDATION_ERROR',
        errors: parsed.error.errors,
      }, { status: 400 });
    }

    const data = parsed.data;
    const invoice = data?.data?.object;
    const firstLine = invoice?.lines?.data?.[0];
    const extractionSources = {
      locationId: data.locationid
        ? 'custom.locationid'
        : firstLine?.price?.metadata?.location_id
          ? 'stripe.data.object.lines.data[0].price.metadata.location_id'
          : firstLine?.plan?.metadata?.location_id
            ? 'stripe.data.object.lines.data[0].plan.metadata.location_id'
            : null,
      ghlContactId: data.contact_id
        ? 'custom.contact_id'
        : data.ghlContactId
          ? 'custom.ghlContactId'
          : null,
      email: data.email
        ? 'custom.email'
        : invoice?.customer_email
          ? 'stripe.data.object.customer_email'
          : null,
      phone: data.phone
        ? 'custom.phone'
        : invoice?.customer_phone
          ? 'stripe.data.object.customer_phone'
          : null,
      amount: data.amount
        ? 'custom.amount'
        : invoice?.amount_paid != null
          ? 'stripe.data.object.amount_paid'
          : invoice?.total != null
            ? 'stripe.data.object.total'
            : invoice?.amount_due != null
              ? 'stripe.data.object.amount_due'
              : null,
      receivedDate: data.receiveddate
        ? 'custom.receiveddate'
        : invoice?.status_transitions?.paid_at
          ? 'stripe.data.object.status_transitions.paid_at'
          : invoice?.created
            ? 'stripe.data.object.created'
            : null,
      displayName: data.displayname
        ? 'custom.displayname'
        : data.full_name
          ? 'custom.full_name'
          : invoice?.customer_name
            ? 'stripe.data.object.customer_name'
            : null,
    };

    // ── Field extraction ────────────────────────────────────────────────────
    const locationId =
      data.locationid ||
      firstLine?.price?.metadata?.location_id ||
      firstLine?.plan?.metadata?.location_id ||
      null;
    const ghlContactId  = data.contact_id || data.ghlContactId || null;
    const rawEmail      = data.email || invoice?.customer_email || '';
    const email         = rawEmail ? normalizeEmail(rawEmail) : '';
    const phone         = data.phone || invoice?.customer_phone || '';
    const address       = data.full_address || '';
    const paymentMethod = data.paymentmethod || 'card';
    const rawAmount =
      data.amount?.toString() ||
      invoice?.amount_paid?.toString() ||
      invoice?.total?.toString() ||
      invoice?.amount_due?.toString() ||
      '';
    const rawDate =
      data.receiveddate ||
      parseUnixTimestamp(invoice?.status_transitions?.paid_at) ||
      parseUnixTimestamp(invoice?.created) ||
      '';

    // Name resolution: explicit GHL fields → split displayname → split full_name
    let firstName = data.first_name || '';
    let lastName  = data.last_name  || '';

    if (!firstName || !lastName) {
      const source = data.displayname || data.full_name || invoice?.customer_name || '';
      if (source) {
        const split = splitName(source);
        firstName = firstName || split.firstName;
        lastName  = lastName  || split.lastName;
      }
    }

    console.log('\n--- Extracted ---');
    console.log({ locationId, ghlContactId, firstName, lastName, email, phone, rawAmount, rawDate, paymentMethod });
    console.log('\n--- Debug Summary ---');
    console.log(JSON.stringify({
      debugId,
      eventType: body?.type || null,
      topLevelKeys: Object.keys(body || {}),
      customKeysPresent: {
        displayname: data.displayname !== undefined,
        email: data.email !== undefined,
        amount: data.amount !== undefined,
        paymentmethod: data.paymentmethod !== undefined,
        locationid: data.locationid !== undefined,
        receiveddate: data.receiveddate !== undefined,
        contact_id: data.contact_id !== undefined,
        ghlContactId: data.ghlContactId !== undefined,
      },
      extractionSources,
      extractedValues: {
        locationId,
        ghlContactId,
        firstName,
        lastName,
        email,
        phone,
        rawAmount,
        rawDate,
        paymentMethod,
      },
    }, null, 2));

    // ── Required field guards ───────────────────────────────────────────────
    if (!firstName && !email) {
      console.error('\n--- Validation Failure ---');
      console.error(JSON.stringify({
        debugId,
        code: 'MISSING_CONTACT_IDENTIFIER',
        reason: 'Both firstName and email were empty after extraction',
        extractedValues: { firstName, lastName, email, rawAmount, rawDate, locationId, ghlContactId },
      }, null, 2));
      return NextResponse.json({
        success: false,
        debugId,
        message: 'displayname or email is required to identify the contact',
        code: 'MISSING_CONTACT_IDENTIFIER',
      }, { status: 400 });
    }

    if (!rawAmount) {
      console.error('\n--- Validation Failure ---');
      console.error(JSON.stringify({
        debugId,
        code: 'MISSING_AMOUNT',
        reason: 'Amount was empty after extraction',
        extractionSources,
        extractedValues: { rawAmount, rawDate, email, locationId, ghlContactId },
      }, null, 2));
      return NextResponse.json({
        success: false,
        debugId,
        message: 'amount is required',
        code: 'MISSING_AMOUNT',
      }, { status: 400 });
    }

    if (!rawDate) {
      console.error('\n--- Validation Failure ---');
      console.error(JSON.stringify({
        debugId,
        code: 'MISSING_DATE',
        reason: 'Received date was empty after extraction',
        extractionSources,
        extractedValues: { rawAmount, rawDate, email, locationId, ghlContactId },
      }, null, 2));
      return NextResponse.json({
        success: false,
        debugId,
        message: 'receiveddate is required',
        code: 'MISSING_DATE',
      }, { status: 400 });
    }

    // ── Parse amount ────────────────────────────────────────────────────────
    const donationAmount = parseAmount(rawAmount);
    if (donationAmount === null) {
      console.error('\n--- Validation Failure ---');
      console.error(JSON.stringify({
        debugId,
        code: 'INVALID_AMOUNT',
        reason: 'Amount parsing returned null',
        rawAmount,
        extractionSources,
      }, null, 2));
      return NextResponse.json({
        success: false,
        debugId,
        message: 'Could not parse amount value',
        code: 'INVALID_AMOUNT',
        received: rawAmount,
      }, { status: 400 });
    }

    // ── Parse date ──────────────────────────────────────────────────────────
    const formattedDate = parseDate(rawDate);
    if (!formattedDate) {
      console.error('\n--- Validation Failure ---');
      console.error(JSON.stringify({
        debugId,
        code: 'INVALID_DATE',
        reason: 'Date parsing returned null',
        rawDate,
        extractionSources,
      }, null, 2));
      return NextResponse.json({
        success: false,
        debugId,
        message: 'Could not parse receiveddate — expected MM/DD/YYYY or ISO 8601',
        code: 'INVALID_DATE',
        received: rawDate,
      }, { status: 400 });
    }

    // ─── CONTACT UPSERT (location-scoped) ─────────────────────────────────────
    // Match by ghlContactId OR email, scoped to locationId.
    // A contact at Location A with the same email as Location B is a different record.

    const orConditions = [];
    if (ghlContactId) orConditions.push(eq(contact.ghlContactId, ghlContactId));
    if (email)        orConditions.push(eq(contact.email, email));

    let matchingContacts: (typeof contact.$inferSelect)[] = [];

    if (orConditions.length > 0) {
      const whereClause = locationId
        ? and(eq(contact.locationId, locationId), or(...orConditions))
        : or(...orConditions);

      matchingContacts = await db.select().from(contact).where(whereClause);
    }

    console.log(`\nMatched ${matchingContacts.length} contact(s) for locationId=${locationId}`);

    let contactId: number;
    let contactAction: 'created' | 'updated';

    if (matchingContacts.length === 0) {
      // ── Create ──────────────────────────────────────────────────────────
      // firstName is NOT NULL in schema — use email local part as safe fallback
      const safeFirstName = firstName || (email ? email.split('@')[0] : 'Unknown');

      const [newContact] = await db
        .insert(contact)
        .values({
          ghlContactId,
          locationId,
          firstName: safeFirstName,
          lastName:  lastName || '',
          email:     email   || null,
          phone:     phone   || null,
          address:   address || null,
        })
        .returning();

      contactId     = newContact.id;
      contactAction = 'created';
      console.log('Created contact ID:', contactId);

    } else {
      // ── Update ──────────────────────────────────────────────────────────
      if (matchingContacts.length > 1) {
        console.warn(
          `WARNING: ${matchingContacts.length} duplicate contacts — ` +
          `IDs: ${matchingContacts.map(c => c.id).join(', ')}. Using best match.`
        );
      }

      // FIX: separate the find() from the condition so TypeScript infers
      // `chosen` as the full contact row type — not string | ContactRow.
      const ghlMatch = ghlContactId
        ? matchingContacts.find(c => c.ghlContactId === ghlContactId)
        : undefined;
      const chosen = ghlMatch ?? matchingContacts[0];

      contactId = chosen.id;

      await db
        .update(contact)
        .set({
          // Only overwrite with incoming data if non-empty; preserve existing otherwise
          firstName:    firstName    || chosen.firstName,
          lastName:     lastName     || chosen.lastName,
          email:        email        || chosen.email,
          phone:        phone        || chosen.phone, 
          address:      address      || chosen.address,
          locationId:   locationId   || chosen.locationId,
          ghlContactId: chosen.ghlContactId || ghlContactId,
          updatedAt: new Date(),
        })
        .where(eq(contact.id, contactId));

      contactAction = 'updated';
      console.log('Updated contact ID:', contactId);
    }

    // ─── DONATION DEDUP ───────────────────────────────────────────────────────
    // Collect all contact IDs sharing this email within the same location,
    // then check if an identical donation (same date + amount) already exists.

    let siblingIds: number[] = [contactId];
    if (email) {
      const siblingsWhere = locationId
        ? and(eq(contact.email, email), eq(contact.locationId, locationId))
        : eq(contact.email, email);
      const siblings = await db.select({ id: contact.id }).from(contact).where(siblingsWhere);
      siblingIds = [...new Set(siblings.map(s => s.id))];
    }
    // Safety guard: never pass an empty array to ANY()
    if (siblingIds.length === 0) siblingIds = [contactId];

    const existingDonation = await db
      .select({ id: manualDonation.id })
      .from(manualDonation)
      .where(
        and(
          sql`${manualDonation.contactId} = ANY(ARRAY[${sql.join(
            siblingIds.map(id => sql`${id}`),
            sql`, `
          )}]::int[])`,
          eq(manualDonation.paymentDate, formattedDate),
          eq(manualDonation.amount, donationAmount.toFixed(2))
        )
      )
      .limit(1);

    if (existingDonation.length > 0) {
      console.log('Duplicate donation — skipping creation');
      return NextResponse.json({
        success: true,
        message: 'Duplicate donation detected, skipped',
        code: 'DUPLICATE_SKIPPED',
        data: { contactId, contactAction, existingDonationId: existingDonation[0].id },
      });
    }

    // ─── CREATE MANUAL DONATION ───────────────────────────────────────────────

    const [newDonation] = await db
      .insert(manualDonation)
      .values({
        contactId,
        amount:        donationAmount.toFixed(2),
        currency:      'USD',
        amountUsd:     donationAmount.toFixed(2),
        paymentDate:   formattedDate,
        receivedDate:  formattedDate,
        paymentMethod,
        paymentStatus: 'completed',
        receiptIssued: false,
        notes: `Stripe sync via GHL. Location: ${locationId ?? 'N/A'}. Contact ${contactAction}.`,
      })
      .returning();

    console.log('Created donation ID:', newDonation.id);
    console.log('=== PROCESSED SUCCESSFULLY ===\n');

    return NextResponse.json({
      success: true,
      debugId,
      message: `Contact ${contactAction} and donation created`,
      code: 'DONATION_CREATED',
      data: {
        contactId,
        contactAction,
        donationId: newDonation.id,
        amount: donationAmount,
        currency: 'USD',
        date: formattedDate,
        locationId,
      },
    });

  } catch (error: unknown) {
    console.error('\n=== STRIPE SYNC-PAYMENT ERROR ===');
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
    return NextResponse.json({
      success: false,
      debugId: 'server-error',
      message: 'Unexpected server error',
      code: 'SERVER_ERROR',
      error: getSafeErrorMessage(error),
    }, { status: 500 });
  }
}

// ─── GET — health check ───────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Stripe sync-payment webhook endpoint is active',
    methods: ['POST'],
    description: 'Receives GHL workflow Stripe payment data, upserts contact by location, creates manual donation.',
    expectedCustomDataFields: {
      displayname:   'Contact full name — split into first/last automatically',
      email:         'Contact email — used for dedup and matching',
      amount:        'Stripe amount in cents (e.g. 5000 = $50.00) — auto-converted',
      paymentmethod: 'Payment method label, e.g. "card"',
      locationid:    'GHL location ID — scopes all contact lookups',
      receiveddate:  'MM/DD/YYYY from {{right_now.middle_endian_date}}',
    },
    behaviours: [
      'Contact created if not found within location; updated if found (by ghlContactId or email)',
      'Donation deduplicated by contactId + date + amount within same location',
      'Stripe cents auto-divided by 100 when no decimal point present',
      'All donations recorded in USD as completed',
    ],
  }, { status: 200 });
}
