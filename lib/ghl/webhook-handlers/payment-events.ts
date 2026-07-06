/**
 * Live payment event handlers. Triggered by GHL marketplace webhooks for:
 *   - InvoicePaid / InvoiceUpdate / InvoiceSentToContact (filter for paid)
 *   - OrderPaid / OrderStatusUpdate (filter for paid)
 *   - SubscriptionTrialOver / SubscriptionCharged / SubscriptionRenewed
 *   - Any TransactionCreated / ProductPurchased / PaymentReceived event
 *
 * Each handler:
 *   1. Records a suppression entry so the inbound contact webhook (if any
 *      fires alongside the payment) doesn't process its own echo.
 *   2. Resolves the DonorHQ contact, auto-creating from GHL's API if it
 *      doesn't exist yet — same path the historical pull uses, so a fresh
 *      sub-account that's never had a contact synced still works.
 *   3. Upserts into manual_donation via the partial UNIQUE index dedup
 *      we built in migration 0025 (location_id + ghl_resource_id). Re-runs
 *      and duplicate webhooks are no-ops.
 *
 * Fails-soft: any per-step failure logs + returns. The webhook receiver
 * returns 200 to GHL either way (matches the contact-webhook pattern).
 */
import { sql, and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manualDonation } from "@/lib/db/schema";
import { contactWithSync } from "@/lib/db/schema-webhook";
import { fetchContactFromGhl } from "../api-client";
import { recordOutboundWrite } from "../suppression";
import { upsertContactFromWebhook } from "./contact-upsert";
import type { GhlWebhookEnvelope } from "../webhook-types";

// Match the discriminator we use on the historical pull so reports can
// query both interchangeably.
export type GhlPaymentSource =
  | "ghl_invoice"
  | "ghl_order"
  | "ghl_subscription"
  | "ghl_transaction";

interface NormalizedPaymentEvent {
  /** The GHL ID of the source object (invoice / order / subscription / transaction). */
  ghlResourceId: string;
  /** The GHL contact id this payment belongs to. */
  ghlContactId: string;
  /** Amount in major units (e.g. 25.00, not 2500 cents). */
  amount: number | null;
  /** ISO-4217 currency code. Defaults to USD. */
  currency: string | null;
  /** When the payment was paid / received. Used as payment_date. */
  paidAt: string | null;
  /** card / ach / cash / etc. */
  paymentMethod: string | null;
  /** succeeded / paid / pending / etc. */
  status: string | null;
  /** External reference (invoice number, order number, etc.). */
  referenceNumber: string | null;
  /** Description / line item / product name. */
  description: string | null;
}

// ─── pickers (defensive — GHL payload shapes drift over time) ───────────────

function pickString(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
function pickNumber(
  obj: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// ─── normalizers — one per source type ──────────────────────────────────────

function normalizeInvoiceEvent(
  payload: Record<string, unknown>,
): NormalizedPaymentEvent | null {
  const id = pickString(payload, "invoiceId", "id", "_id");
  const contactId = pickString(payload, "contactId", "contact_id");
  if (!id || !contactId) return null;
  return {
    ghlResourceId: id,
    ghlContactId: contactId,
    amount: pickNumber(payload, "amount", "amountPaid", "total"),
    currency: pickString(payload, "currency"),
    paidAt: pickString(payload, "paidAt", "issueDate", "updatedAt", "createdAt"),
    paymentMethod: pickString(payload, "paymentMethod"),
    status: pickString(payload, "status"),
    referenceNumber: pickString(payload, "invoiceNumber", "name"),
    description: pickString(payload, "title", "description", "name"),
  };
}

function normalizeOrderEvent(
  payload: Record<string, unknown>,
): NormalizedPaymentEvent | null {
  const id = pickString(payload, "orderId", "id", "_id");
  const contactId = pickString(payload, "contactId", "contact_id");
  if (!id || !contactId) return null;
  return {
    ghlResourceId: id,
    ghlContactId: contactId,
    amount: pickNumber(payload, "amount", "total"),
    currency: pickString(payload, "currency"),
    paidAt: pickString(payload, "createdAt", "completedAt", "paidAt"),
    paymentMethod: pickString(payload, "paymentMethod", "paymentMethodType"),
    status: pickString(payload, "status"),
    referenceNumber: pickString(payload, "orderNumber", "referenceNumber"),
    description: pickString(payload, "description", "productName"),
  };
}

function normalizeSubscriptionEvent(
  payload: Record<string, unknown>,
): NormalizedPaymentEvent | null {
  const id = pickString(
    payload,
    "subscriptionId",
    "subscription_id",
    "id",
    "_id",
  );
  const contactId = pickString(payload, "contactId", "contact_id");
  if (!id || !contactId) return null;
  return {
    ghlResourceId: id,
    ghlContactId: contactId,
    amount: pickNumber(payload, "amount", "amountInCents"),
    currency: pickString(payload, "currency"),
    paidAt: pickString(
      payload,
      "lastChargeAt",
      "currentPeriodStart",
      "createdAt",
      "startDate",
    ),
    paymentMethod: pickString(payload, "paymentMethod", "type"),
    status: pickString(payload, "status", "subscriptionStatus"),
    referenceNumber: pickString(
      payload,
      "subscriptionNumber",
      "referenceNumber",
    ),
    description: pickString(payload, "description", "name"),
  };
}

function normalizeTransactionEvent(
  payload: Record<string, unknown>,
): NormalizedPaymentEvent | null {
  const id = pickString(payload, "transactionId", "id", "_id");
  const contactId = pickString(payload, "contactId", "contact_id");
  if (!id || !contactId) return null;
  return {
    ghlResourceId: id,
    ghlContactId: contactId,
    amount: pickNumber(payload, "amount", "amountInCents"),
    currency: pickString(payload, "currency"),
    paidAt: pickString(
      payload,
      "completedAt",
      "paidAt",
      "transactionDate",
      "createdAt",
    ),
    paymentMethod: pickString(payload, "paymentMethod", "paymentMethodType", "type"),
    status: pickString(payload, "status", "paymentStatus"),
    referenceNumber: pickString(payload, "transactionNumber", "referenceNumber"),
    description: pickString(payload, "description"),
  };
}

// ─── shared upsert path ─────────────────────────────────────────────────────

async function applyPaymentEvent(
  source: GhlPaymentSource,
  event: NormalizedPaymentEvent,
  locationId: string,
  companyId: string | undefined,
): Promise<void> {
  // 1. Suppression marker so the inbound contact webhook (firing alongside
  // the payment for the same contact) is treated as our own write.
  await recordOutboundWrite(locationId, event.ghlContactId);

  // 2. Resolve the DonorHQ contact, creating from GHL API if missing.
  const contactId = await resolveContactId(
    event.ghlContactId,
    locationId,
    companyId,
  );
  if (!contactId) {
    console.warn(
      `[ghl-payment-webhook] could not resolve DonorHQ contact for ` +
        `ghlContactId=${event.ghlContactId} (source=${source}, ` +
        `resourceId=${event.ghlResourceId}) — skipping`,
    );
    return;
  }

  // 3. Map to manual_donation insert values.
  const currency = normalizeCurrency(event.currency);
  const amount = event.amount != null ? event.amount.toFixed(2) : "0.00";
  const paymentDate = pickDate(event.paidAt);
  const status = normalizeStatus(event.status);

  // 3a. CROSS-SOURCE DEDUP.
  // GHL fires multiple webhooks for the same underlying payment (an Order
  // event AND a Transaction event, for example). Each has a distinct
  // ghl_resource_id, so the (location_id, ghl_resource_id) UNIQUE index
  // does not catch them — we end up recording the same money twice.
  //
  // Guard: if a row already exists for the same (location, contact,
  // amount, payment_date) but a DIFFERENT ghl_source, treat this incoming
  // event as the sibling and skip. First webhook wins. Same-source
  // retries are still handled by ON CONFLICT DO UPDATE below.
  if (amount !== "0.00" && paymentDate) {
    const twin = await db
      .select({ id: manualDonation.id, existingSource: manualDonation.ghlSource })
      .from(manualDonation)
      .where(
        and(
          eq(manualDonation.locationId, locationId),
          eq(manualDonation.contactId, contactId),
          eq(manualDonation.amount, amount),
          eq(manualDonation.paymentDate, paymentDate),
        ),
      )
      .limit(1);
    if (twin.length > 0 && twin[0].existingSource !== source) {
      console.log(
        `[ghl-payment-webhook] cross-source duplicate — skipping insert. ` +
          `source=${source} resourceId=${event.ghlResourceId} ` +
          `existing.source=${twin[0].existingSource} existing.id=${twin[0].id}`,
      );
      return;
    }
  }

  const insertValues = {
    contactId,
    amount,
    currency,
    amountUsd: currency === "USD" ? amount : null,
    paymentDate,
    receivedDate: paymentDate,
    paymentMethod: event.paymentMethod ?? null,
    methodDetail: event.description ?? null,
    paymentStatus: status,
    referenceNumber: event.referenceNumber ?? null,
    notes: event.description ?? null,
    ghlSource: source,
    ghlResourceId: event.ghlResourceId,
    ghlPaymentMethod: event.paymentMethod ?? null,
    locationId,
  } as typeof manualDonation.$inferInsert;

  // 4. INSERT ... ON CONFLICT DO UPDATE against the partial unique
  // (location_id, ghl_resource_id). Idempotent across retries.
  await db
    .insert(manualDonation)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [manualDonation.locationId, manualDonation.ghlResourceId],
      targetWhere: sql`location_id IS NOT NULL AND ghl_resource_id IS NOT NULL`,
      set: {
        amount,
        currency,
        amountUsd: currency === "USD" ? amount : null,
        paymentDate,
        receivedDate: paymentDate,
        paymentMethod: event.paymentMethod ?? null,
        paymentStatus: status,
        referenceNumber: event.referenceNumber ?? null,
        notes: event.description ?? null,
        ghlPaymentMethod: event.paymentMethod ?? null,
        updatedAt: new Date(),
      },
    });
}

async function resolveContactId(
  ghlContactId: string,
  locationId: string,
  companyId: string | undefined,
): Promise<number | null> {
  const [existing] = await db
    .select({ id: contactWithSync.id })
    .from(contactWithSync)
    .where(
      and(
        eq(contactWithSync.ghlContactId, ghlContactId),
        eq(contactWithSync.locationId, locationId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  // Not in DonorHQ yet — fetch from GHL + upsert via the contact webhook
  // handler (same enrichment + tag normalization the inbound contact
  // webhook produces).
  let full;
  try {
    full = await fetchContactFromGhl(locationId, ghlContactId, { companyId });
  } catch (err) {
    console.error(
      `[ghl-payment-webhook] fetchContactFromGhl threw for ${ghlContactId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
  if (!full) return null;

  try {
    const { contactId } = await upsertContactFromWebhook(
      {
        id: full.id,
        contactId: full.id,
        firstName: full.firstName ?? null,
        lastName: full.lastName ?? null,
        email: full.email ?? null,
        phone: full.phone ?? null,
        address1: full.address1 ?? null,
        city: full.city ?? null,
        state: full.state ?? null,
        postalCode: full.postalCode ?? null,
        country: full.country ?? null,
        companyName: full.companyName ?? null,
        dateOfBirth: full.dateOfBirth ?? null,
        source: full.source ?? null,
        tags: full.tags,
        dnd: full.dnd,
        customFields: full.customFields,
      } as Parameters<typeof upsertContactFromWebhook>[0],
      locationId,
    );
    return contactId;
  } catch (err) {
    console.error(
      `[ghl-payment-webhook] contact upsert threw for ${ghlContactId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ─── public handlers (each maps an event type → upsert path) ───────────────

function isLikelyPaidStatus(status: string | null): boolean {
  if (!status) return true; // assume paid if not specified
  const s = status.toLowerCase();
  return (
    s === "paid" ||
    s === "succeeded" ||
    s === "success" ||
    s === "completed" ||
    s === "active" ||
    s === "charged"
  );
}

export async function handleInvoicePaidEvent(
  payload: Record<string, unknown>,
  locationId: string,
): Promise<void> {
  const companyId = pickString(payload, "companyId") ?? undefined;
  const event = normalizeInvoiceEvent(payload);
  if (!event) {
    console.warn(
      "[ghl-payment-webhook] InvoicePaid: missing invoiceId or contactId — skipping",
    );
    return;
  }
  if (!isLikelyPaidStatus(event.status)) {
    console.log(
      `[ghl-payment-webhook] InvoicePaid: skipping non-paid invoice ${event.ghlResourceId} (status=${event.status})`,
    );
    return;
  }
  await applyPaymentEvent("ghl_invoice", event, locationId, companyId);
}

export async function handleOrderPaidEvent(
  payload: Record<string, unknown>,
  locationId: string,
): Promise<void> {
  const companyId = pickString(payload, "companyId") ?? undefined;
  const event = normalizeOrderEvent(payload);
  if (!event) {
    console.warn(
      "[ghl-payment-webhook] OrderPaid: missing orderId or contactId — skipping",
    );
    return;
  }
  if (!isLikelyPaidStatus(event.status)) {
    console.log(
      `[ghl-payment-webhook] OrderPaid: skipping non-paid order ${event.ghlResourceId} (status=${event.status})`,
    );
    return;
  }
  await applyPaymentEvent("ghl_order", event, locationId, companyId);
}

export async function handleSubscriptionEvent(
  payload: Record<string, unknown>,
  locationId: string,
): Promise<void> {
  const companyId = pickString(payload, "companyId") ?? undefined;
  const event = normalizeSubscriptionEvent(payload);
  if (!event) {
    console.warn(
      "[ghl-payment-webhook] Subscription: missing subscriptionId or contactId — skipping",
    );
    return;
  }
  await applyPaymentEvent("ghl_subscription", event, locationId, companyId);
}

export async function handleTransactionEvent(
  payload: Record<string, unknown>,
  locationId: string,
): Promise<void> {
  const companyId = pickString(payload, "companyId") ?? undefined;
  const event = normalizeTransactionEvent(payload);
  if (!event) {
    console.warn(
      "[ghl-payment-webhook] Transaction: missing transactionId or contactId — skipping",
    );
    return;
  }
  await applyPaymentEvent("ghl_transaction", event, locationId, companyId);
}

// ─── small helpers reused from payments-backfill ────────────────────────────

type CurrencyEnumValue =
  | "USD"
  | "ILS"
  | "EUR"
  | "JPY"
  | "GBP"
  | "AUD"
  | "CAD"
  | "ZAR";
const ALLOWED_CURRENCIES: ReadonlySet<CurrencyEnumValue> = new Set<CurrencyEnumValue>([
  "USD",
  "ILS",
  "EUR",
  "JPY",
  "GBP",
  "AUD",
  "CAD",
  "ZAR",
]);
function normalizeCurrency(c: string | null): CurrencyEnumValue {
  if (!c) return "USD";
  const upper = c.toUpperCase() as CurrencyEnumValue;
  return ALLOWED_CURRENCIES.has(upper) ? upper : "USD";
}

type PaymentStatusEnumValue =
  | "pending"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded"
  | "processing"
  | "expected";
function normalizeStatus(s: string | null): PaymentStatusEnumValue {
  if (!s) return "completed";
  const lower = s.toLowerCase();
  if (
    lower === "succeeded" ||
    lower === "success" ||
    lower === "paid" ||
    lower === "completed" ||
    lower === "active" ||
    lower === "charged"
  )
    return "completed";
  if (lower === "pending") return "pending";
  if (lower === "processing") return "processing";
  if (lower === "failed" || lower === "declined") return "failed";
  if (lower === "cancelled" || lower === "canceled" || lower === "expired")
    return "cancelled";
  if (lower === "refunded") return "refunded";
  return "completed";
}

function pickDate(s: string | null): string {
  if (!s) return new Date().toISOString().slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

// Reference for type-checkers that we use GhlWebhookEnvelope downstream.
void (null as unknown as GhlWebhookEnvelope);
