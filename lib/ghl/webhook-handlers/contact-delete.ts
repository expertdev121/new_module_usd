/**
 * Handler: ContactDelete
 *
 * Soft-deletes the contact by stamping `deleted_at = NOW()`. Never hard-deletes.
 * If no matching row is found, this is a no-op — GHL may legitimately fire a
 * delete for a contact we never received a create for.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactWithSync } from "@/lib/db/schema-webhook";
import { extractGhlContactId } from "../webhook-mapping";
import type { GhlContactPayload } from "../webhook-types";

export async function handleContactDelete(
  payload: GhlContactPayload,
  locationId: string,
): Promise<void> {
  const ghlContactId = extractGhlContactId(payload);
  if (!ghlContactId) {
    throw new Error("ContactDelete webhook missing ghl contactId");
  }

  await db
    .update(contactWithSync)
    .set({
      deletedAt: new Date(),
      lastGhlSyncAt: new Date(),
      syncSource: "ghl_webhook",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contactWithSync.ghlContactId, ghlContactId),
        eq(contactWithSync.locationId, locationId),
        // Only soft-delete if not already deleted, to keep deleted_at stable.
        isNull(contactWithSync.deletedAt),
      ),
    );
}
