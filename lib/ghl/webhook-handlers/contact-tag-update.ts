/**
 * Handler: ContactTagUpdate
 *
 * Replaces the contact's tag set in TWO places:
 *   1. `contact.tags` JSONB column — fast denormalized cache (this was the
 *      original implementation per Nikhil's option (b) decision).
 *   2. The normalized `tag` + `contact_tags` tables — what the Financial
 *      Module and Manage Tags page actually read from.
 *
 * Without step 2, GHL-sync'd tags would be stored but invisible in the UI.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactWithSync } from "@/lib/db/schema-webhook";
import { extractGhlContactId } from "../webhook-mapping";
import { syncContactTagsToNormalized } from "../sync-contact-tags";
import type { GhlContactPayload } from "../webhook-types";

export async function handleContactTagUpdate(
  payload: GhlContactPayload,
  locationId: string,
): Promise<void> {
  const ghlContactId = extractGhlContactId(payload);
  if (!ghlContactId) {
    throw new Error("ContactTagUpdate webhook missing ghl contactId");
  }

  // Normalize: trim, drop empties, dedupe.
  const rawTags = Array.isArray(payload.tags) ? payload.tags : [];
  const tags = Array.from(
    new Set(
      rawTags
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter((t) => t.length > 0),
    ),
  );

  // Step 1 — update the JSONB cache + return the contact id.
  const updated = await db
    .update(contactWithSync)
    .set({
      tags,
      lastGhlSyncAt: new Date(),
      syncSource: "ghl_webhook",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contactWithSync.ghlContactId, ghlContactId),
        eq(contactWithSync.locationId, locationId),
      ),
    )
    .returning({ id: contactWithSync.id });

  if (updated.length === 0) {
    // Contact doesn't exist yet — GHL fired ContactTagUpdate before
    // ContactCreate (rare but possible). Nothing to do here; the next
    // create webhook will populate tags via upsertContactFromWebhook.
    return;
  }
  const contactId = updated[0].id;

  // Step 2 — sync to the normalized tables so the UI shows the tags.
  await syncContactTagsToNormalized(contactId, locationId, tags);
}
