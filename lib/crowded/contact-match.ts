/**
 * Resolve (or create) the DonorHQ contact for a Crowded donor.
 *
 * Match order (best → worst signal):
 *   1. crowded_contact_id + location_id   — survives email changes
 *   2. email                + location_id  — common case
 *   3. mobile               + location_id  — fallback
 *
 * If none match, we INSERT a new contact carrying:
 *   - The Crowded contactId (so #1 wins next time)
 *   - The location_id (tenant scope)
 *   - First / last / email / phone we have
 *   - syncSource = "crowded_webhook" (parallels "ghl_webhook" / "ghl_backfill")
 *
 * Never returns null — donor identification is a hard requirement before
 * the donation row can be written. If we can't even build a placeholder
 * (e.g. zero identifying info), we throw and let the webhook handler
 * mark the event 'skipped' for manual triage.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export interface CrowdedDonorInput {
  /** Crowded's per-donor ID — if known, sets up best-match for future webhooks. */
  crowdedContactId?: string | null;
  email?: string | null;
  mobile?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * Returns the DonorHQ contact.id. Creates if missing.
 *
 * We use raw SQL because:
 *   - The "match by EITHER crowded_contact_id OR email OR mobile" is one
 *     OR-chained query, awkward in Drizzle's fluent builder.
 *   - We need access to the contact.crowded_contact_id column added in
 *     migration 0028, which isn't on the canonical Drizzle `contact`
 *     type (kept off schema.ts per project convention).
 */
export async function resolveContactForCrowdedDonor(
  donor: CrowdedDonorInput,
  locationId: string,
): Promise<number> {
  if (!locationId) {
    throw new Error("resolveContactForCrowdedDonor: locationId required");
  }
  const normalizedEmail = donor.email ? donor.email.trim().toLowerCase() : null;
  const normalizedMobile = donor.mobile
    ? donor.mobile.replace(/[\s\-()+]/g, "").trim()
    : null;

  if (!donor.crowdedContactId && !normalizedEmail && !normalizedMobile) {
    throw new Error(
      "resolveContactForCrowdedDonor: cannot identify donor — no Crowded id, email, or mobile",
    );
  }

  // 1. Match by crowded_contact_id + location_id (best).
  if (donor.crowdedContactId) {
    const rows = (await db.execute(sql`
      SELECT id FROM contact
       WHERE crowded_contact_id = ${donor.crowdedContactId}
         AND location_id = ${locationId}
         AND deleted_at IS NULL
       LIMIT 1
    `)) as unknown;
    const id = pickFirstId(rows);
    if (id) return id;
  }

  // 2. Match by email + location_id.
  if (normalizedEmail) {
    const rows = (await db.execute(sql`
      SELECT id FROM contact
       WHERE LOWER(email) = ${normalizedEmail}
         AND location_id = ${locationId}
         AND deleted_at IS NULL
       LIMIT 1
    `)) as unknown;
    const id = pickFirstId(rows);
    if (id) {
      // Backfill the Crowded id onto the existing contact so future
      // webhooks hit step 1.
      if (donor.crowdedContactId) {
        await db.execute(sql`
          UPDATE contact
             SET crowded_contact_id = ${donor.crowdedContactId},
                 updated_at = NOW()
           WHERE id = ${id}
             AND (crowded_contact_id IS NULL OR crowded_contact_id = '')
        `);
      }
      return id;
    }
  }

  // 3. Match by mobile + location_id.
  if (normalizedMobile) {
    const rows = (await db.execute(sql`
      SELECT id FROM contact
       WHERE REGEXP_REPLACE(COALESCE(phone, ''), '[\\s\\-()+]', '', 'g') = ${normalizedMobile}
         AND location_id = ${locationId}
         AND deleted_at IS NULL
       LIMIT 1
    `)) as unknown;
    const id = pickFirstId(rows);
    if (id) {
      if (donor.crowdedContactId) {
        await db.execute(sql`
          UPDATE contact
             SET crowded_contact_id = ${donor.crowdedContactId},
                 updated_at = NOW()
           WHERE id = ${id}
             AND (crowded_contact_id IS NULL OR crowded_contact_id = '')
        `);
      }
      return id;
    }
  }

  // 4. No match — create the contact. firstName/lastName NOT NULL, so
  // we fall back to 'N/A' placeholders the way upsertContactFromWebhook
  // does for sparse GHL payloads.
  const firstName = donor.firstName?.trim() || "N/A";
  const lastName = donor.lastName?.trim() || "N/A";

  const inserted = (await db.execute(sql`
    INSERT INTO contact (
      first_name, last_name, email, phone,
      location_id, crowded_contact_id, sync_source, last_ghl_sync_at,
      created_at, updated_at
    ) VALUES (
      ${firstName},
      ${lastName},
      ${normalizedEmail},
      ${normalizedMobile},
      ${locationId},
      ${donor.crowdedContactId ?? null},
      'crowded_webhook',
      NOW(),
      NOW(),
      NOW()
    )
    RETURNING id
  `)) as unknown;

  const newId = pickFirstId(inserted);
  if (!newId) {
    throw new Error("resolveContactForCrowdedDonor: insert returned no id");
  }
  return newId;
}

function pickFirstId(result: unknown): number | null {
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  if (rows.length === 0) return null;
  const first = rows[0] as { id?: number | string };
  if (first.id == null) return null;
  return typeof first.id === "string" ? parseInt(first.id, 10) : first.id;
}
