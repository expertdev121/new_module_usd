/**
 * Dispatch table for inbound GHL Marketplace webhook event types.
 *
 * The route handler hands a parsed payload here; we route by `type` to the
 * specific handler. Unknown types return `unknown_type` so the caller can
 * stamp the event row accordingly — we still return 200 to GHL.
 */
import { handleContactCreate } from "./contact-create";
import { handleContactUpdate } from "./contact-update";
import { handleContactDelete } from "./contact-delete";
import { handleContactDndUpdate } from "./contact-dnd-update";
import { handleContactTagUpdate } from "./contact-tag-update";
import { handleInvoicePaid } from "./invoice-paid";
import { handleAppUninstall } from "./app-uninstall";
import type {
  GhlContactPayload,
  GhlInvoicePayload,
  GhlWebhookEnvelope,
  GhlWebhookEventType,
} from "../webhook-types";

export type DispatchOutcome = "processed" | "unknown_type";

/**
 * Run the handler for a given event type. Throws on handler failure — the
 * caller catches and stamps `failed` on the event row.
 */
export async function dispatchEvent(
  type: string,
  payload: GhlContactPayload | GhlInvoicePayload | GhlWebhookEnvelope,
  locationId: string,
): Promise<DispatchOutcome> {
  switch (type as GhlWebhookEventType) {
    case "ContactCreate":
      await handleContactCreate(payload as GhlContactPayload, locationId);
      return "processed";
    case "ContactUpdate":
      await handleContactUpdate(payload as GhlContactPayload, locationId);
      return "processed";
    case "ContactDelete":
      await handleContactDelete(payload as GhlContactPayload, locationId);
      return "processed";
    case "ContactDndUpdate":
      await handleContactDndUpdate(payload as GhlContactPayload, locationId);
      return "processed";
    case "ContactTagUpdate":
      await handleContactTagUpdate(payload as GhlContactPayload, locationId);
      return "processed";
    case "InvoicePaid":
      await handleInvoicePaid(payload as GhlInvoicePayload, locationId);
      return "processed";
    case "AppUninstall":
    case "Uninstall":
    case "UNINSTALL":
      await handleAppUninstall(payload as GhlWebhookEnvelope, locationId);
      return "processed";
    case "INSTALL":
      // The OAuth callback (/api/oauth/callback) already stored the token
      // row when the user clicked Install. The INSTALL webhook is GHL's
      // confirmation event — we just acknowledge it.
      return "processed";
    default:
      return "unknown_type";
  }
}
