/**
 * Maps a GHL contact webhook payload into the columns we store on `contact`
 * (extended schema, see lib/db/schema-webhook.ts).
 *
 * Conservative by default: every field is optional. The mapper only returns
 * values for fields that GHL actually sent — the caller merges these into
 * its update/insert statement so columns that weren't in the payload are
 * left untouched.
 *
 * Customisation note: if Donor HQ's contact model gains more typed columns
 * later (e.g. a separate "donor_status" enum), extend this function rather
 * than scattering field mapping across handlers.
 */
import type { NewContactWithSync } from "@/lib/db/schema-webhook";
import type { GhlContactPayload } from "./webhook-types";

/** Lowercase + trim email. Returns null for empty/whitespace inputs. */
function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** Strip whitespace, dashes, parens, plus from a phone string. */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s\-()+]/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function nonEmpty(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Coerce GHL's customFields shape into a flat Record. GHL can send either an
 * object map or an array of {id, value} pairs depending on the integration —
 * normalize both into `Record<string, unknown>` for storage.
 */
function normalizeCustomFields(
  cf: GhlContactPayload["customFields"],
): Record<string, unknown> | null {
  if (!cf) return null;
  if (Array.isArray(cf)) {
    const out: Record<string, unknown> = {};
    for (const item of cf) {
      if (item && typeof item === "object" && "id" in item) {
        out[String(item.id)] = (item as { value: unknown }).value;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  if (typeof cf === "object") {
    return cf as Record<string, unknown>;
  }
  return null;
}

/**
 * Returns the GHL contactId from a payload, tolerating either `contactId`
 * or `id` (GHL has historically used both).
 */
export function extractGhlContactId(payload: GhlContactPayload): string | null {
  return payload.contactId || payload.id || null;
}

/**
 * Build a partial contact row from a GHL payload. The result is meant to be
 * spread into an insert or update — every field is optional. Required
 * columns (firstName, lastName) get default placeholders if GHL omitted them
 * so we never fail an INSERT (the contact table requires them NOT NULL).
 */
export function mapGhlContactToDonor(
  payload: GhlContactPayload,
  locationId: string,
): Partial<NewContactWithSync> {
  const email = normalizeEmail(payload.email);
  const phone = normalizePhone(payload.phone);
  const customFields = normalizeCustomFields(payload.customFields);

  const mapped: Partial<NewContactWithSync> = {
    ghlContactId: extractGhlContactId(payload) ?? undefined,
    locationId,

    // GHL sometimes sends an empty string for missing fields — coerce to null.
    firstName: nonEmpty(payload.firstName) ?? undefined,
    lastName: nonEmpty(payload.lastName) ?? undefined,
    email: email ?? undefined,
    phone: phone ?? undefined,

    address1: nonEmpty(payload.address1) ?? undefined,
    city: nonEmpty(payload.city) ?? undefined,
    state: nonEmpty(payload.state) ?? undefined,
    postalCode: nonEmpty(payload.postalCode) ?? undefined,
    country: nonEmpty(payload.country) ?? undefined,
    organization: nonEmpty(payload.companyName) ?? undefined,
    dateOfBirth: nonEmpty(payload.dateOfBirth) ?? undefined,
    source: nonEmpty(payload.source) ?? undefined,

    doNotContact: payload.dnd ?? undefined,
    tags: Array.isArray(payload.tags) ? payload.tags : undefined,
    ghlCustomFields: customFields ?? undefined,

    // Always set when we touch a contact via webhook.
    syncSource: "ghl_webhook",
    lastGhlSyncAt: new Date(),
  };

  // Strip the undefined values so the caller's spread doesn't blow away
  // existing column values on update.
  for (const key of Object.keys(mapped) as (keyof typeof mapped)[]) {
    if (mapped[key] === undefined) delete mapped[key];
  }

  // TODO: if Donor HQ adds dedicated columns for any of these GHL fields,
  // map them here:
  //   - displayName (already exists on contact, but not synced from GHL)
  //   - title (already exists on contact, not in standard GHL payload)
  //   - gender (enum on contact, not in standard GHL payload)
  //   - email2 (already exists on contact, not in standard GHL payload)

  return mapped;
}
