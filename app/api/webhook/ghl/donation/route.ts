import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contact, manualDonation, campaign } from "@/lib/db/schema";
import type { Contact, Campaign, ManualDonation } from "@/lib/db/schema";
import { and, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";

const SUPPORTED_CURRENCIES = ["USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR"] as const;
type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

// GHL custom-data keys come through with user-defined labels. Accept the
// snake_case names the workflow is configured with (per the workflow screen),
// plus a few common variants in case the keys get re-labelled.
const payloadSchema = z
  .object({
    first_name: z.string().optional(),
    firstName: z.string().optional(),
    last_name: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().optional(),

    donation_amount: z.union([z.string(), z.number()]).optional(),
    amount: z.union([z.string(), z.number()]).optional(),

    transaction_id: z.string().optional(),
    transactionId: z.string().optional(),

    campaign_name: z.string().optional(),
    campaignName: z.string().optional(),
    campaign_id: z.string().optional(),
    campaignId: z.string().optional(),
    sub_campaign_id: z.string().optional(),
    subCampaignId: z.string().optional(),

    payment_type: z.string().optional(),
    paymentType: z.string().optional(),
    payment_method: z.string().optional(),

    received_date: z.string().optional(),
    receivedDate: z.string().optional(),

    currency: z.string().optional(),

    location_id: z.string().optional(),
    locationId: z.string().optional(),

    contact_id: z.string().optional(),
    contactId: z.string().optional(),
  })
  .passthrough();

type Payload = z.infer<typeof payloadSchema>;

function pickString(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickAmount(data: Payload): number | undefined {
  const raw = data.donation_amount ?? data.amount;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function normalizeCurrency(raw: string | undefined): SupportedCurrency {
  const c = (raw ?? "USD").toUpperCase();
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(c)
    ? (c as SupportedCurrency)
    : "USD";
}

// Parse a date string into YYYY-MM-DD (Postgres date column format).
// Accepts ISO timestamps, YYYY-MM-DD, MM/DD/YYYY, or anything Date() can parse.
function parseIsoDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().split("T")[0];
}

async function findContactInLocation(opts: {
  locationId: string;
  ghlContactId?: string;
  email?: string;
}): Promise<Contact | null> {
  const { locationId, ghlContactId, email } = opts;

  if (ghlContactId) {
    const byGhl = await db
      .select()
      .from(contact)
      .where(and(eq(contact.locationId, locationId), eq(contact.ghlContactId, ghlContactId)))
      .limit(1);
    if (byGhl.length) return byGhl[0];
  }

  if (email) {
    const byEmail = await db
      .select()
      .from(contact)
      .where(and(eq(contact.locationId, locationId), ilike(contact.email, email)))
      .limit(1);
    if (byEmail.length) return byEmail[0];
  }

  return null;
}

function buildDisplayName(firstName: string, lastName: string): string | null {
  const f = firstName === "N/A" ? "" : firstName.trim();
  const l = lastName === "N/A" ? "" : lastName.trim();
  const joined = `${f} ${l}`.trim();
  return joined || null;
}

async function findOrCreateContact(opts: {
  locationId: string;
  ghlContactId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}): Promise<{ contact: Contact; created: boolean }> {
  const existing = await findContactInLocation(opts);
  if (existing) return { contact: existing, created: false };

  // `first_name` and `last_name` are NOT NULL in the schema. Fall back to
  // "N/A" when only an email or contact_id is available so the row can land.
  const firstName = opts.firstName ?? "N/A";
  const lastName = opts.lastName ?? "N/A";
  const displayName = buildDisplayName(firstName, lastName);

  const [created] = await db
    .insert(contact)
    .values({
      firstName,
      lastName,
      displayName,
      email: opts.email ?? null,
      ghlContactId: opts.ghlContactId ?? null,
      locationId: opts.locationId,
    })
    .returning();

  return { contact: created, created: true };
}

async function findOrCreateCampaign(
  name: string,
  locationId: string
): Promise<{ campaign: Campaign; created: boolean }> {
  const existing = await db
    .select()
    .from(campaign)
    .where(and(eq(campaign.name, name), eq(campaign.locationId, locationId)))
    .limit(1);

  if (existing.length) return { campaign: existing[0], created: false };

  const [created] = await db
    .insert(campaign)
    .values({ name, locationId, status: "active" })
    .returning();
  return { campaign: created, created: true };
}

// GHL workflow webhooks send standard contact data at the top level AND nest
// the workflow-configured custom-data fields under either a `customData` object,
// a JSON-string `customData`, or form-encoded `customData[key]` entries. Pull
// them all up to the top level so the schema can see fields like `location_id`.
function flattenGhlPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const flat: Record<string, unknown> = {};

  // Bracket-style first so non-bracket top-level keys override (they shouldn't
  // collide, but if they do the explicit top-level wins).
  for (const [k, v] of Object.entries(obj)) {
    const m = k.match(/^customData\[(.+)\]$/);
    if (m) flat[m[1]] = v;
  }

  // Copy top-level keys (skip the customData container itself).
  for (const [k, v] of Object.entries(obj)) {
    if (k === "customData" || /^customData\[.+\]$/.test(k)) continue;
    flat[k] = v;
  }

  // customData as object or JSON string — its keys win over GHL's standard keys
  // since they're the values the workflow author explicitly wired up.
  let cd: unknown = obj.customData;
  if (typeof cd === "string") {
    try {
      cd = JSON.parse(cd);
    } catch {
      cd = undefined;
    }
  }
  if (cd && typeof cd === "object") {
    for (const [k, v] of Object.entries(cd as Record<string, unknown>)) {
      flat[k] = v;
    }
  }

  // `location` from standard data is sometimes a JSON object `{id, name}` and
  // sometimes a stringified version of the same. Use it as a fallback for
  // location_id when the custom-data field wasn't configured.
  if (flat.location_id === undefined && flat.locationId === undefined && flat.location !== undefined) {
    let loc: unknown = flat.location;
    if (typeof loc === "string") {
      try {
        loc = JSON.parse(loc);
      } catch {
        // not JSON — leave alone
      }
    }
    if (loc && typeof loc === "object" && "id" in (loc as Record<string, unknown>)) {
      flat.location_id = (loc as Record<string, unknown>).id;
    }
  }

  return flat;
}

function fail(
  reqId: string,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
) {
  const body = { success: false, code, message, reqId, ...(extra ?? {}) };
  console.warn(`[ghl-donation-webhook] ${reqId} fail status=${status} code=${code}`, body);
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  const reqId =
    (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const startedAt = Date.now();
  const contentType = request.headers.get("content-type") ?? "";
  let raw: unknown;

  try {
    if (contentType.includes("application/json")) {
      raw = await request.json();
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await request.formData();
      raw = Object.fromEntries(form.entries());
    } else {
      const text = await request.text();
      try {
        raw = JSON.parse(text);
      } catch {
        raw = Object.fromEntries(new URLSearchParams(text).entries());
      }
    }
  } catch (err) {
    console.error(`[ghl-donation-webhook] ${reqId} body-parse-failed contentType=${contentType}`, err);
    return fail(reqId, 400, "BODY_PARSE_ERROR", "Could not parse request body", {
      contentType,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  console.log(
    `[ghl-donation-webhook] ${reqId} incoming contentType=${contentType} body=`,
    JSON.stringify(raw, null, 2)
  );

  const flattened = flattenGhlPayload(raw);

  if (raw && typeof raw === "object" && "customData" in raw) {
    console.log(
      `[ghl-donation-webhook] ${reqId} flattened customData → keys=`,
      Object.keys(flattened)
    );
  }

  try {
    const parsed = payloadSchema.safeParse(flattened);
    if (!parsed.success) {
      return fail(reqId, 400, "VALIDATION_ERROR", "Payload schema validation failed", {
        errors: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
        receivedKeys: Object.keys(flattened),
        rawKeys: raw && typeof raw === "object" ? Object.keys(raw) : [],
      });
    }

    const data = parsed.data;

    // Query-param fallback for location_id, since it has no source field in
    // the standard Connection Point payload — it lives only in the inbound
    // webhook URL segment. If the workflow author forgot to add the custom
    // data row, they can still recover by appending ?location_id=... to the
    // outbound URL. Body wins if both are provided.
    const qsLocationId =
      request.nextUrl.searchParams.get("location_id") ??
      request.nextUrl.searchParams.get("locationId") ??
      undefined;
    const locationId = pickString(data.location_id, data.locationId, qsLocationId ?? undefined);
    const ghlContactId = pickString(data.contact_id, data.contactId);
    const email = pickString(data.email)?.toLowerCase();
    const firstName = pickString(data.first_name, data.firstName);
    const lastName = pickString(data.last_name, data.lastName);
    const campaignName = pickString(data.campaign_name, data.campaignName);
    const ghlCampaignId = pickString(data.campaign_id, data.campaignId);
    const subCampaignId = pickString(data.sub_campaign_id, data.subCampaignId);
    const transactionId = pickString(data.transaction_id, data.transactionId);
    const paymentMethod =
      pickString(data.payment_type, data.paymentType, data.payment_method) ?? "unknown";
    const currency = normalizeCurrency(pickString(data.currency));
    const amount = pickAmount(data);
    const receivedDateRaw = pickString(data.received_date, data.receivedDate);
    const receivedDate = parseIsoDate(receivedDateRaw);
    if (receivedDateRaw && !receivedDate) {
      return fail(reqId, 400, "INVALID_RECEIVED_DATE", "received_date is not a parseable date", {
        receivedDate: receivedDateRaw,
      });
    }

    if (!locationId) {
      return fail(reqId, 400, "MISSING_LOCATION_ID", "location_id is required", {
        receivedKeys: Object.keys(data),
      });
    }
    if (!ghlContactId && !email) {
      return fail(
        reqId,
        400,
        "MISSING_CONTACT_IDENTIFIER",
        "Either contact_id or email is required to locate the contact",
        { locationId, receivedKeys: Object.keys(data) }
      );
    }
    if (!campaignName) {
      return fail(reqId, 400, "MISSING_CAMPAIGN_NAME", "campaign_name is required", {
        locationId,
      });
    }
    if (amount === undefined || amount <= 0) {
      return fail(reqId, 400, "INVALID_AMOUNT", "donation_amount must be a positive number", {
        locationId,
        receivedAmount: data.donation_amount ?? data.amount ?? null,
      });
    }

    let dbContact: Contact;
    let contactCreated = false;
    try {
      const result = await findOrCreateContact({
        locationId,
        ghlContactId,
        email,
        firstName,
        lastName,
      });
      dbContact = result.contact;
      contactCreated = result.created;
      if (contactCreated) {
        console.log(
          `[ghl-donation-webhook] ${reqId} contact-created id=${dbContact.id} location=${locationId} ghlContactId=${ghlContactId ?? "none"} email=${email ?? "none"}`
        );
      }
    } catch (err) {
      console.error(`[ghl-donation-webhook] ${reqId} contact-upsert-failed`, {
        locationId,
        ghlContactId,
        email,
        firstName,
        lastName,
        error: err,
      });
      return fail(reqId, 500, "CONTACT_UPSERT_FAILED", "Database error finding or creating contact", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    let campaignRecord: Campaign;
    let campaignCreated = false;
    try {
      const result = await findOrCreateCampaign(campaignName, locationId);
      campaignRecord = result.campaign;
      campaignCreated = result.created;
      if (campaignCreated) {
        console.log(
          `[ghl-donation-webhook] ${reqId} campaign-created id=${campaignRecord.id} name="${campaignName}" location=${locationId}`
        );
      }
    } catch (err) {
      console.error(`[ghl-donation-webhook] ${reqId} campaign-upsert-failed`, {
        campaignName,
        locationId,
        error: err,
      });
      return fail(
        reqId,
        500,
        "CAMPAIGN_UPSERT_FAILED",
        "Database error finding or creating campaign",
        { campaignName, locationId, error: err instanceof Error ? err.message : String(err) }
      );
    }

    const today = new Date().toISOString().split("T")[0];
    const paymentDate = receivedDate ?? today;
    const amountStr = amount.toFixed(2);

    const noteParts = [
      "Donation received via GHL workflow",
      firstName || lastName ? `from ${[firstName, lastName].filter(Boolean).join(" ")}` : null,
      transactionId ? `transaction_id=${transactionId}` : null,
      ghlCampaignId ? `ghl_campaign_id=${ghlCampaignId}` : null,
      subCampaignId ? `sub_campaign_id=${subCampaignId}` : null,
    ].filter(Boolean);

    let donation: ManualDonation | undefined;
    let alreadyExisted = false;
    try {
      // Dedup on (locationId, transactionId) via the partial unique index
      // `manual_donation_ghl_location_unique`. If a row already exists we
      // skip insert and look it up below so the workflow can safely retry.
      const insertQuery = db
        .insert(manualDonation)
        .values({
          contactId: dbContact.id,
          amount: amountStr,
          currency,
          amountUsd: currency === "USD" ? amountStr : null,
          exchangeRate: currency === "USD" ? "1.0000" : null,
          paymentDate,
          receivedDate: receivedDate ?? today,
          campaignId: campaignRecord.id,
          paymentMethod,
          paymentStatus: "completed",
          ghlSource: "ghl_workflow",
          ghlResourceId: transactionId ?? null,
          ghlPaymentMethod: paymentMethod,
          locationId,
          referenceNumber: transactionId ?? null,
          notes: noteParts.join(" | "),
          importSource: "ghl_webhook",
        });

      const inserted = transactionId
        ? await insertQuery
            .onConflictDoNothing({
              target: [manualDonation.locationId, manualDonation.ghlResourceId],
              where: sql`location_id IS NOT NULL AND ghl_resource_id IS NOT NULL`,
            })
            .returning()
        : await insertQuery.returning();

      if (inserted.length) {
        donation = inserted[0];
      } else if (transactionId) {
        const existing = await db
          .select()
          .from(manualDonation)
          .where(
            and(
              eq(manualDonation.locationId, locationId),
              eq(manualDonation.ghlResourceId, transactionId)
            )
          )
          .limit(1);
        if (existing.length) {
          donation = existing[0];
          alreadyExisted = true;
        }
      }
    } catch (err) {
      console.error(`[ghl-donation-webhook] ${reqId} donation-insert-failed`, {
        contactId: dbContact.id,
        campaignId: campaignRecord.id,
        locationId,
        transactionId,
        amount: amountStr,
        currency,
        error: err,
      });
      return fail(reqId, 500, "DONATION_INSERT_FAILED", "Database error inserting donation", {
        contactId: dbContact.id,
        campaignId: campaignRecord.id,
        transactionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (!donation) {
      console.error(`[ghl-donation-webhook] ${reqId} donation-insert-returned-empty`, {
        contactId: dbContact.id,
        campaignId: campaignRecord.id,
        locationId,
        transactionId,
      });
      return fail(reqId, 500, "DONATION_INSERT_FAILED", "Insert returned no row", {
        contactId: dbContact.id,
        campaignId: campaignRecord.id,
        transactionId,
      });
    }

    console.log(
      `[ghl-donation-webhook] ${reqId} ${alreadyExisted ? "duplicate" : "success"} donation=${donation.id} contact=${dbContact.id} campaign=${campaignRecord.id} location=${locationId} txn=${transactionId ?? "none"} amount=${amountStr} ${currency} elapsed=${Date.now() - startedAt}ms`
    );

    return NextResponse.json(
      {
        success: true,
        code: alreadyExisted ? "DONATION_ALREADY_EXISTS" : "DONATION_CREATED",
        reqId,
        data: {
          donation,
          contact: {
            id: dbContact.id,
            firstName: dbContact.firstName,
            lastName: dbContact.lastName,
            created: contactCreated,
          },
          campaign: {
            id: campaignRecord.id,
            name: campaignRecord.name,
            created: campaignCreated,
          },
          locationId,
          transactionId: transactionId ?? null,
        },
      },
      { status: alreadyExisted ? 200 : 201 }
    );
  } catch (err) {
    console.error(`[ghl-donation-webhook] ${reqId} unhandled-error`, {
      contentType,
      rawBody: raw,
      error: err,
      stack: err instanceof Error ? err.stack : undefined,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        success: false,
        code: "SERVER_ERROR",
        reqId,
        message: err instanceof Error ? err.message : "Unknown error",
        ...(process.env.NODE_ENV !== "production" && err instanceof Error
          ? { stack: err.stack }
          : {}),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "GHL donation webhook endpoint is active",
    methods: ["POST"],
    expectedFields: {
      location_id: "GHL location ID (required, scopes all lookups)",
      contact_id: "GHL contact ID (required if email is missing)",
      email: "Contact email (used if contact_id is missing)",
      first_name:
        "Used to populate a newly-created contact (falls back to 'N/A' when missing). Existing contacts are not updated.",
      last_name:
        "Used to populate a newly-created contact (falls back to 'N/A' when missing). Existing contacts are not updated.",
      campaign_name: "Required — find-or-create within this location",
      campaign_id: "Optional — GHL campaign ID, stored in notes for traceability",
      sub_campaign_id: "Optional — GHL sub-campaign ID, stored in notes",
      donation_amount: "Required, positive number",
      transaction_id:
        "Optional but recommended — stored as referenceNumber + ghl_resource_id. Used to dedup repeated webhook fires for the same payment.",
      received_date:
        "Optional — when the org received the funds. Accepts YYYY-MM-DD or ISO timestamp. Defaults to today. Also used as paymentDate.",
      payment_type: "Optional, stored as payment_method (defaults to 'unknown')",
      currency: "Optional, defaults to USD",
    },
    dedup:
      "If transaction_id is provided, repeated POSTs for the same (location_id, transaction_id) return 200 DONATION_ALREADY_EXISTS instead of creating a duplicate row.",
  });
}
