/**
 * Handler: ContactTagUpdate
 *
 * Replaces the contact's `tags` JSONB column with the full tag array from
 * the payload. Per Nikhil's decision in the webhook task, we store GHL tags
 * on a JSONB column rather than syncing into the normalized contact_tags /
 * tag tables. The Manage Tags page won't see these GHL tags — that's
 * intentional for this milestone.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactWithSync } from "@/lib/db/schema-webhook";
import { extractGhlContactId } from "../webhook-mapping";
import type { GhlContactPayload } from "../webhook-types";

export async function handleContactTagUpdate(
  payload: GhlContactPayload,
  locationId: string,
): Promise<void> {
  const ghlContactId = extractGhlContactId(payload);
  if (!ghlContactId) {
    throw new Error("ContactTagUpdate webhook missing ghl contactId");
  }

  // Normalize: keep the array as-is, dedupe, drop empty strings.
  const rawTags = Array.isArray(payload.tags) ? payload.tags : [];
  const tags = Array.from(
    new Set(
      rawTags
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter((t) => t.length > 0),
    ),
  );

  await db
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
    );
}
