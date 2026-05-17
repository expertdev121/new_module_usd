/**
 * Handler: ContactCreate
 *
 * Upserts the contact keyed on (ghl_contact_id, location_id). Idempotent —
 * if GHL re-fires the create webhook, we treat it as an update.
 */
import type { GhlContactPayload } from "../webhook-types";
import { upsertContactFromWebhook } from "./contact-upsert";

export async function handleContactCreate(
  payload: GhlContactPayload,
  locationId: string,
): Promise<void> {
  await upsertContactFromWebhook(payload, locationId);
}
