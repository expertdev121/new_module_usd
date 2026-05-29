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
import {
  handleInvoicePaidEvent,
  handleOrderPaidEvent,
  handleSubscriptionEvent,
  handleTransactionEvent,
} from "./payment-events";
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
      // Legacy logger (writes to ghl_invoice_events) — keeps the forensic
      // trail intact. Runs alongside the new event handler below.
      await handleInvoicePaid(payload as GhlInvoicePayload, locationId);
      // New canonical path: upsert into manual_donation via the
      // ghl_source/ghl_resource_id partial UNIQUE. Auto-creates the
      // contact from GHL if missing. Matches the historical pull dedup
      // so a re-run won't duplicate.
      await handleInvoicePaidEvent(
        payload as unknown as Record<string, unknown>,
        locationId,
      );
      return "processed";
    case "InvoiceUpdate":
    case "InvoiceSentToContact":
      // Some GHL flows fire Update instead of Paid when status flips to
      // paid. Treat as InvoicePaid — the handler self-skips when the
      // payload's status isn't a paid-like value.
      await handleInvoicePaidEvent(
        payload as unknown as Record<string, unknown>,
        locationId,
      );
      return "processed";
    case "OrderPaid":
    case "OrderStatusUpdate":
      await handleOrderPaidEvent(
        payload as unknown as Record<string, unknown>,
        locationId,
      );
      return "processed";
    case "SubscriptionCharged":
    case "SubscriptionTrialOver":
    case "SubscriptionRenewed":
    case "SubscriptionStarted":
      await handleSubscriptionEvent(
        payload as unknown as Record<string, unknown>,
        locationId,
      );
      return "processed";
    case "TransactionCreated":
    case "TransactionCompleted":
    case "PaymentReceived":
    case "ProductPurchased":
      await handleTransactionEvent(
        payload as unknown as Record<string, unknown>,
        locationId,
      );
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
