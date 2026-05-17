/**
 * Handler: InvoicePaid
 *
 * Two-step:
 *   1. Always log the raw event to ghl_invoice_events (forensic trail).
 *   2. If we can resolve a matching contact, insert a row into manual_donation
 *      so it appears in the Financial Module. Deduped by `reference_number`
 *      = the GHL invoiceId, so retries / duplicate webhooks won't create
 *      duplicate donations.
 *
 * Conservative on failure: if step 2 fails (no matching contact, parse
 * error, schema mismatch), step 1 still runs so the event isn't lost. The
 * webhook stays a 200 either way (we never re-throw past the route).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contact, manualDonation } from "@/lib/db/schema";
import { recordInvoiceEvent } from "../webhook-storage";
import type { GhlInvoicePayload } from "../webhook-types";

type SupportedCurrency = "USD" | "ILS" | "EUR" | "JPY" | "GBP" | "AUD" | "CAD" | "ZAR";
const SUPPORTED_CURRENCIES: SupportedCurrency[] = [
  "USD",
  "ILS",
  "EUR",
  "JPY",
  "GBP",
  "AUD",
  "CAD",
  "ZAR",
];

function normalizeCurrency(input: string | null | undefined): SupportedCurrency {
  if (!input) return "USD";
  const upper = input.toUpperCase();
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(upper)
    ? (upper as SupportedCurrency)
    : "USD";
}

function normalizeAmount(raw: number | string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

function safeDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateOnly(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().split("T")[0];
}

export async function handleInvoicePaid(
  payload: GhlInvoicePayload,
  locationId: string,
): Promise<void> {
  const invoiceId = payload.invoiceId ?? payload.id ?? null;
  const ghlContactId = payload.contactId ?? null;
  const paidAt = safeDate(payload.paidAt);
  const currency = normalizeCurrency(payload.currency);
  const amount = normalizeAmount(payload.amount);

  // Step 1 — always log.
  await recordInvoiceEvent({
    invoiceId,
    contactId: ghlContactId,
    locationId,
    amount,
    currency,
    paidAt,
    payload,
  });

  // Step 2 — best-effort donation creation. We need:
  //   • a non-empty invoiceId (for dedupe)
  //   • a matching contact row (otherwise we have no FK target)
  //   • a parseable amount
  if (!invoiceId || !ghlContactId || !amount) {
    console.warn(
      "[ghl-webhook] InvoicePaid: skipping donation create — missing required fields",
      { invoiceId, ghlContactId, hasAmount: Boolean(amount), locationId },
    );
    return;
  }

  // Find the Donor HQ contact this invoice belongs to.
  const contactRows = await db
    .select({ id: contact.id })
    .from(contact)
    .where(
      and(
        eq(contact.ghlContactId, ghlContactId),
        eq(contact.locationId, locationId),
      ),
    )
    .limit(1);

  if (contactRows.length === 0) {
    console.warn(
      "[ghl-webhook] InvoicePaid: no matching Donor HQ contact for (ghl_contact_id, location_id) — donation not created",
      { ghlContactId, locationId, invoiceId },
    );
    return;
  }
  const contactId = contactRows[0].id;

  // Dedupe: if a manual_donation with this reference_number already exists
  // for this contact, do nothing. Same-event retries / dup webhooks pass
  // through silently.
  const existing = await db
    .select({ id: manualDonation.id })
    .from(manualDonation)
    .where(
      and(
        eq(manualDonation.contactId, contactId),
        eq(manualDonation.referenceNumber, invoiceId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return; // already recorded
  }

  const paymentDate = dateOnly(paidAt) ?? new Date().toISOString().split("T")[0];

  await db.insert(manualDonation).values({
    contactId,
    amount,
    amountUsd: currency === "USD" ? amount : null,
    exchangeRate: currency === "USD" ? "1.0000" : null,
    currency,
    paymentDate,
    receivedDate: paymentDate,
    paymentMethod: "credit",
    paymentStatus: "completed",
    referenceNumber: invoiceId,
    notes: "GoHighLevel invoice (auto-recorded from InvoicePaid webhook)",
  });

  // TODO: exchange_rate / amount_usd for non-USD currencies — wire up to the
  // existing exchange-rate API helper once GHL starts sending non-USD invoices
  // and the user confirms how they want them stored.
}
