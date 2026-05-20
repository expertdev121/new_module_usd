/**
 * Atomic upsert for ContactCreate / ContactUpdate webhook events.
 *
 * Uses Postgres INSERT ... ON CONFLICT DO UPDATE, targeted at the partial
 * UNIQUE index `contact_ghl_location_unique` created by migration 0022.
 * This is race-free — concurrent webhooks for the same (ghl_contact_id,
 * location_id) cannot both insert; the second one's INSERT is converted
 * by Postgres into an UPDATE atomically. No duplicates can be created
 * at the DB level regardless of how many Vercel instances run in parallel.
 *
 * IMPORTANT: The partial UNIQUE index has a WHERE predicate, so the
 * ON CONFLICT clause MUST repeat that predicate via `targetWhere` —
 * otherwise Postgres can't match the index.
 */
import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contactWithSync,
  type NewContactWithSync,
} from "@/lib/db/schema-webhook";
import { mapGhlContactToDonor, extractGhlContactId } from "../webhook-mapping";
import { syncContactTagsToNormalized } from "../sync-contact-tags";
import { fetchContactFromGhl } from "../api-client";
import type { GhlContactPayload } from "../webhook-types";

export async function upsertContactFromWebhook(
  payload: GhlContactPayload,
  locationId: string,
): Promise<{ contactId: number | null }> {
  const ghlContactId = extractGhlContactId(payload);
  if (!ghlContactId) {
    throw new Error("contact webhook missing ghl contactId");
  }

  const mapped = mapGhlContactToDonor(payload, locationId);

  // INSERT values. firstName/lastName are NOT NULL on contact — supply
  // placeholders if GHL didn't include them; the next webhook will fix.
  const insertValues: NewContactWithSync = {
    firstName: mapped.firstName ?? "N/A",
    lastName: mapped.lastName ?? "N/A",
    ghlContactId,
    locationId,
    ...mapped,
    isLegacyDuplicate: false, // always false for new rows
  };

  // The UPDATE side of ON CONFLICT — same column set as a fresh INSERT
  // except we don't reset isLegacyDuplicate, and we always bump updatedAt.
  const updateValues: Partial<NewContactWithSync> = {
    ...mapped,
    updatedAt: new Date(),
  };

  // Atomic INSERT or UPDATE. Targeted at the partial unique index
  // `contact_ghl_location_unique` from migration 0022.
  const [row] = await db
    .insert(contactWithSync)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [contactWithSync.ghlContactId, contactWithSync.locationId],
      targetWhere: sql`is_legacy_duplicate = FALSE AND ghl_contact_id IS NOT NULL AND location_id IS NOT NULL`,
      set: updateValues,
    })
    .returning({ id: contactWithSync.id });

  // If the payload included tags, mirror them into the normalized
  // tag + contact_tags tables so the UI can render them. The JSONB
  // column was already populated by the upsert above.
  if (row?.id && Array.isArray(payload.tags) && payload.tags.length > 0) {
    try {
      await syncContactTagsToNormalized(
        row.id,
        locationId,
        payload.tags as string[],
      );
    } catch (err) {
      console.error(
        "[ghl-webhook] tag normalization failed (non-fatal):",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ── ENRICHMENT ──────────────────────────────────────────────────────────
  // GHL's webhook payloads are intentionally sparse — ContactUpdate omits
  // phone, address1, city, state, postalCode, dateOfBirth, etc. To keep
  // Donor HQ truly in sync, fetch the canonical contact from GHL's API
  // (using the lazy-minted location token) and merge any fields that the
  // webhook didn't carry. Best-effort: if the API call fails, the webhook
  // is still "processed" and the next webhook will retry.
  if (row?.id) {
    try {
      const full = await fetchContactFromGhl(locationId, ghlContactId);
      if (full) {
        const enrichment = buildEnrichmentFromGhlFull(full);
        if (Object.keys(enrichment).length > 0) {
          await db
            .update(contactWithSync)
            .set({
              ...enrichment,
              lastGhlSyncAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(contactWithSync.id, row.id));
        }
        // Tags: GHL's API returns the canonical tag array — re-sync if
        // present (covers ContactUpdate webhooks that didn't include tags
        // but where the contact actually has them in GHL).
        if (Array.isArray(full.tags) && full.tags.length > 0) {
          try {
            await syncContactTagsToNormalized(row.id, locationId, full.tags);
          } catch {
            /* logged elsewhere */
          }
        }
      }
    } catch (err) {
      console.error(
        "[ghl-webhook] enrichment failed (non-fatal):",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { contactId: row?.id ?? null };
}

/**
 * Build a partial update object from the full GHL contact response. Unlike
 * the webhook-payload mapper, this writes NULL for explicitly empty fields
 * — when GHL says "this contact has no phone", we clear ours too. The full
 * API response is the source of truth.
 *
 * Fields not present on the GHL response at all are left out of the patch
 * (we don't blank them by accident).
 */
function buildEnrichmentFromGhlFull(
  full: import("../api-client").GhlContactFull,
): Partial<NewContactWithSync> {
  const out: Partial<NewContactWithSync> = {};

  // Helper: only include a field if GHL explicitly provided it (even if
  // the value is null — that's a "clear this" signal).
  const include = <K extends keyof NewContactWithSync>(
    key: K,
    value: NewContactWithSync[K] | undefined,
  ) => {
    if (value !== undefined) out[key] = value;
  };

  // Normalize phone (strip whitespace/punctuation).
  const normalizePhone = (p: unknown): string | null => {
    if (p === null) return null;
    if (typeof p !== "string") return null;
    const cleaned = p.replace(/[\s\-()+]/g, "").trim();
    return cleaned.length > 0 ? cleaned : null;
  };

  if ("firstName" in full) include("firstName", full.firstName?.trim() || "N/A");
  if ("lastName" in full) include("lastName", full.lastName?.trim() || "N/A");
  if ("email" in full) include("email", full.email?.trim().toLowerCase() || null);
  if ("phone" in full) include("phone", normalizePhone(full.phone));
  const addr1 = "address1" in full ? full.address1?.trim() || null : undefined;
  const city = "city" in full ? full.city?.trim() || null : undefined;
  const state = "state" in full ? full.state?.trim() || null : undefined;
  const postal = "postalCode" in full ? full.postalCode?.trim() || null : undefined;
  const country = "country" in full ? full.country?.trim() || null : undefined;
  include("address1", addr1);
  include("city", city);
  include("state", state);
  include("postalCode", postal);
  include("country", country);

  // Compose the legacy single-line `address` column from the structured
  // pieces so older UI / report code that still reads `contact.address`
  // continues to work. Only update it if at least one structured field
  // was present on the GHL response.
  if (
    addr1 !== undefined ||
    city !== undefined ||
    state !== undefined ||
    postal !== undefined ||
    country !== undefined
  ) {
    const composed = [addr1, city, state, postal, country]
      .filter((p): p is string => Boolean(p && p.length > 0))
      .join(", ");
    include("address", composed.length > 0 ? composed : null);
  }
  if ("companyName" in full) include("organization", full.companyName?.trim() || null);
  if ("dateOfBirth" in full) include("dateOfBirth", full.dateOfBirth?.trim() || null);
  if ("source" in full) include("source", full.source?.trim() || null);
  if ("dnd" in full) include("doNotContact", Boolean(full.dnd));

  // Custom fields — normalize array form into a record for storage.
  if ("customFields" in full && full.customFields) {
    if (Array.isArray(full.customFields)) {
      const cf: Record<string, unknown> = {};
      for (const f of full.customFields) {
        if (f && typeof f === "object" && "id" in f) {
          cf[String(f.id)] = (f as { value: unknown }).value;
        }
      }
      if (Object.keys(cf).length > 0) include("ghlCustomFields", cf);
    } else if (typeof full.customFields === "object") {
      include("ghlCustomFields", full.customFields as Record<string, unknown>);
    }
  }

  return out;
}
