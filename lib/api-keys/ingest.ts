/**
 * Ingest service for the public Integrations API.
 *
 * Two operations, shared by every public endpoint:
 *   - upsertContactFromApi  → find-or-create a donor (reuses resolveContact,
 *                             the one canonical dedup path: email → phone →
 *                             constituents_id, tenant-scoped) and best-effort
 *                             mirrors the contact to GHL.
 *   - recordDonationFromApi → insert a manual_donation, idempotent on the
 *                             caller-supplied external reference so a retry
 *                             never double-counts a gift.
 *
 * Everything is scoped to the locationId resolved from the API key — callers
 * never pass a location, so a key can only ever write to its own account.
 */
import { db } from "@/lib/db";
import { manualDonation, campaign } from "@/lib/db/schema";
import { and, eq, ilike } from "drizzle-orm";
import { resolveContact } from "@/lib/contacts/resolve-contact";
import { parseAmount } from "@/lib/money/parse-amount";

export const SUPPORTED_CURRENCIES = [
  "USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR",
] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

// A donation pushed from an external platform is, by default, money that
// already changed hands — "completed". We accept a few others so a platform
// can mirror refunds/failures too, but only these (validated against the
// payment_status enum).
export const SUPPORTED_STATUSES = [
  "completed", "pending", "refunded", "failed", "cancelled", "processing",
] as const;
export type SupportedStatus = (typeof SUPPORTED_STATUSES)[number];

export interface ApiContactInput {
  firstName?: string | null;
  lastName?: string | null;
  /** Convenience: a single "name" we split when firstName/lastName absent. */
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  /** External CRM id, matched as a last resort and backfilled. */
  externalId?: string | null;
}

export interface ApiDonationInput {
  amount: number | string;
  currency?: string | null;
  /** ISO date (YYYY-MM-DD). Defaults to today when omitted. */
  date?: string | null;
  /** REQUIRED for idempotency — the sender's own unique transaction id. */
  reference: string;
  paymentMethod?: string | null;
  /** Campaign name — found-or-created within the tenant. */
  campaign?: string | null;
  /** Free-text fund/designation, stored on the donation note. */
  designation?: string | null;
  note?: string | null;
  status?: string | null;
}

export interface UpsertContactResult {
  contactId: number;
  matchedBy: string;
  created: boolean;
}

function splitName(input: ApiContactInput): { firstName: string; lastName: string } {
  const fn = (input.firstName ?? "").trim();
  const ln = (input.lastName ?? "").trim();
  if (fn || ln) return { firstName: fn || "Unknown", lastName: ln || "Contact" };
  const whole = (input.name ?? "").trim();
  if (whole) {
    const parts = whole.split(/\s+/);
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(" ") || "Contact",
    };
  }
  return { firstName: "Unknown", lastName: "Contact" };
}

/**
 * Find-or-create the donor and (best-effort) mirror to GHL.
 * Throws only on a hard DB failure — GHL sync problems never break ingest.
 */
export async function upsertContactFromApi(
  locationId: string,
  input: ApiContactInput,
): Promise<UpsertContactResult> {
  const { firstName, lastName } = splitName(input);

  const resolved = await resolveContact(
    {
      locationId,
      email: input.email,
      phone: input.phone,
      constituentsId: input.externalId,
      firstName,
      lastName,
      address: input.address,
    },
    { createIfMissing: true },
  );

  if (resolved.contactId == null) {
    // resolveContact only returns null when createIfMissing is false.
    throw new Error("Failed to resolve or create contact");
  }

  // Best-effort GHL mirror — pushContactUpsert is inline-first with its own
  // 2.5s budget + queue fallback, and needs an email or phone to dedup.
  if (input.email || input.phone) {
    try {
      const { pushContactUpsert } = await import("@/lib/ghl/push-contact");
      await pushContactUpsert(resolved.contactId, locationId, {
        firstName,
        lastName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address1: input.address ?? null,
      });
    } catch (err) {
      console.error(
        `[api.ingest] GHL push failed for contact ${resolved.contactId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    contactId: resolved.contactId,
    matchedBy: resolved.matchedBy,
    created: resolved.matchedBy === "created",
  };
}

/** Find-or-create a campaign by name within the tenant. */
async function resolveCampaignId(
  locationId: string,
  name: string,
): Promise<number | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = await db
    .select({ id: campaign.id })
    .from(campaign)
    .where(and(eq(campaign.locationId, locationId), ilike(campaign.name, trimmed)))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [created] = await db
    .insert(campaign)
    .values({ name: trimmed, locationId })
    .returning({ id: campaign.id });
  return created?.id ?? null;
}

export interface RecordDonationResult {
  donationId: number;
  duplicate: boolean;
}

/**
 * Insert a donation for an existing contact. Idempotent on
 * (location_id, reference_number) among import_source='api' rows — a repeat
 * of the same reference returns the original row instead of a second gift.
 */
export async function recordDonationFromApi(
  locationId: string,
  contactId: number,
  input: ApiDonationInput,
): Promise<RecordDonationResult> {
  const reference = String(input.reference ?? "").trim();
  if (!reference) {
    throw new ApiIngestError("Each donation must include a unique 'reference'.");
  }

  const amount = parseAmount(input.amount);
  if (amount == null || !(amount > 0)) {
    throw new ApiIngestError("Donation 'amount' must be a positive number.");
  }

  const currency = (input.currency ?? "USD").toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency as SupportedCurrency)) {
    throw new ApiIngestError(
      `Unsupported currency '${currency}'. Supported: ${SUPPORTED_CURRENCIES.join(", ")}.`,
    );
  }

  const status = (input.status ?? "completed").toLowerCase();
  if (!SUPPORTED_STATUSES.includes(status as SupportedStatus)) {
    throw new ApiIngestError(
      `Unsupported status '${status}'. Supported: ${SUPPORTED_STATUSES.join(", ")}.`,
    );
  }

  const paymentDate = normalizeDate(input.date);

  // Idempotency: has this reference already landed for this tenant via the API?
  const dup = await db
    .select({ id: manualDonation.id })
    .from(manualDonation)
    .where(
      and(
        eq(manualDonation.locationId, locationId),
        eq(manualDonation.referenceNumber, reference),
        eq(manualDonation.importSource, "api"),
      ),
    )
    .limit(1);
  if (dup[0]) return { donationId: dup[0].id, duplicate: true };

  const campaignId = input.campaign
    ? await resolveCampaignId(locationId, input.campaign)
    : null;

  const noteParts = [input.designation, input.note].filter(Boolean);

  try {
    const [row] = await db
      .insert(manualDonation)
      .values({
        contactId,
        amount: amount.toFixed(2),
        currency: currency as SupportedCurrency,
        // USD conversion is only trivially correct for USD; non-USD gifts
        // land without a USD figure (reports show them un-converted) rather
        // than guessing a rate.
        amountUsd: currency === "USD" ? amount.toFixed(2) : null,
        paymentDate,
        paymentStatus: status as SupportedStatus,
        paymentMethod: input.paymentMethod ?? null,
        campaignId,
        referenceNumber: reference,
        importSource: "api",
        notes: noteParts.length ? noteParts.join(" — ") : null,
      })
      .returning({ id: manualDonation.id });
    return { donationId: row.id, duplicate: false };
  } catch (err) {
    // Lost an idempotency race — the partial unique index rejected us.
    // Re-select the winner and report it as the (idempotent) result.
    const again = await db
      .select({ id: manualDonation.id })
      .from(manualDonation)
      .where(
        and(
          eq(manualDonation.locationId, locationId),
          eq(manualDonation.referenceNumber, reference),
          eq(manualDonation.importSource, "api"),
        ),
      )
      .limit(1);
    if (again[0]) return { donationId: again[0].id, duplicate: true };
    throw err;
  }
}

/** ISO date passthrough with a today() default; rejects clearly-bad input. */
function normalizeDate(input?: string | null): string {
  const raw = (input ?? "").trim();
  if (!raw) return new Date().toISOString().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  throw new ApiIngestError(`Invalid date '${raw}'. Use ISO format YYYY-MM-DD.`);
}

/** Thrown for caller-fixable validation problems → surfaced as HTTP 422. */
export class ApiIngestError extends Error {}
