/**
 * Shared upsert for ContactCreate and ContactUpdate.
 *
 * Keyed on (ghl_contact_id, location_id). If a row exists, update;
 * otherwise insert. `firstName` and `lastName` are NOT NULL on `contact`,
 * so when GHL omits them on an insert we fall back to a placeholder so the
 * insert can succeed — the real values arrive on the next webhook.
 */
import { and, eq } from "drizzle-orm";
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
): Promise<{ action: "created" | "updated"; contactId: number | null }> {
  const ghlContactId = extractGhlContactId(payload);
  if (!ghlContactId) {
    throw new Error("contact webhook missing ghl contactId");
  }

  const mapped = mapGhlContactToDonor(payload, locationId);

  // Try update first by (ghl_contact_id, location_id). Drizzle's
  // .onConflictDoUpdate needs a unique constraint, which we don't have on
  // (ghl_contact_id, location_id) — so we explicitly select then update or
  // insert.
  const existing = await db
    .select({ id: contactWithSync.id })
    .from(contactWithSync)
    .where(
      and(
        eq(contactWithSync.ghlContactId, ghlContactId),
        eq(contactWithSync.locationId, locationId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const [row] = await db
      .update(contactWithSync)
      .set({ ...mapped, updatedAt: new Date() })
      .where(eq(contactWithSync.id, existing[0].id))
      .returning({ id: contactWithSync.id });
    return { action: "updated", contactId: row?.id ?? null };
  }

  // Insert. firstName and lastName are NOT NULL — supply placeholders when
  // GHL didn't include them. The next ContactUpdate webhook will fix them up.
  const insertValues: NewContactWithSync = {
    firstName: mapped.firstName ?? "N/A",
    lastName: mapped.lastName ?? "N/A",
    ghlContactId,
    locationId,
    ...mapped,
  };

  const [row] = await db
    .insert(contactWithSync)
    .values(insertValues)
    .returning({ id: contactWithSync.id });
  return { action: "created", contactId: row?.id ?? null };
}
