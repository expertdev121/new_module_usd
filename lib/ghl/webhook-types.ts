/**
 * Type definitions for inbound GHL Marketplace webhook payloads.
 *
 * GHL sends event-specific fields at the top level (not nested under a `data`
 * key). We use a discriminated union keyed on `type`.
 */

export type GhlWebhookEventType =
  | "ContactCreate"
  | "ContactUpdate"
  | "ContactDelete"
  | "ContactDndUpdate"
  | "ContactTagUpdate"
  | "InvoicePaid"
  | "AppUninstall"
  | "Uninstall" // legacy name
  | "UNINSTALL" // marketplace event (uppercase)
  | "INSTALL"; // marketplace event — fires when app is installed; OAuth callback already handled it, we just ack

export interface GhlWebhookEnvelope {
  type: GhlWebhookEventType | string;
  locationId?: string;
  companyId?: string;
  timestamp?: string;
  webhookId?: string;
}

export interface GhlContactPayload extends GhlWebhookEnvelope {
  contactId?: string;
  id?: string; // GHL sometimes uses `id` instead of `contactId`
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dnd?: boolean;
  tags?: string[];
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  companyName?: string;
  dateOfBirth?: string;
  source?: string;
  customFields?: Record<string, unknown> | Array<{ id: string; value: unknown }>;
}

export interface GhlInvoicePayload extends GhlWebhookEnvelope {
  invoiceId?: string;
  id?: string;
  contactId?: string;
  amount?: number | string;
  currency?: string;
  paidAt?: string;
  status?: string;
}

export type GhlWebhookPayload =
  | GhlContactPayload
  | GhlInvoicePayload
  | GhlWebhookEnvelope;

export type ProcessingStatus =
  | "received"
  | "processed"
  | "failed"
  | "skipped_no_token"
  | "skipped_loop"
  | "unknown_type"
  | "duplicate";
