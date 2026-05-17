/**
 * Handler: ContactUpdate
 *
 * Same flow as ContactCreate — upserts by (ghl_contact_id, location_id).
 */
import type { GhlContactPayload } from "../webhook-types";
import { upsertContactFromWebhook } from "./contact-upsert";

export async function handleContactUpdate(
  payload: GhlContactPayload,
  locationId: string,
): Promise<void> {
  await upsertContactFromWebhook(payload, locationId);
}
