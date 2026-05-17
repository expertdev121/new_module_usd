/**
 * Handler: ContactDndUpdate
 *
 * Updates the `do_not_contact` flag on the contact. Other fields are not
 * touched — this event is specifically about DND status.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactWithSync } from "@/lib/db/schema-webhook";
import { extractGhlContactId } from "../webhook-mapping";
import type { GhlContactPayload } from "../webhook-types";

export async function handleContactDndUpdate(
  payload: GhlContactPayload,
  locationId: string,
): Promise<void> {
  const ghlContactId = extractGhlContactId(payload);
  if (!ghlContactId) {
    throw new Error("ContactDndUpdate webhook missing ghl contactId");
  }

  await db
    .update(contactWithSync)
    .set({
      doNotContact: Boolean(payload.dnd),
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
