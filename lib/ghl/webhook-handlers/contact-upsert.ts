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
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contactWithSync,
  type NewContactWithSync,
} from "@/lib/db/schema-webhook";
import { mapGhlContactToDonor, extractGhlContactId } from "../webhook-mapping";
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

  return { contactId: row?.id ?? null };
}
