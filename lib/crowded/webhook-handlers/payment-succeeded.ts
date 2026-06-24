/**
 * Handler: collect.payment.succeeded (and collect.payment.processing,
 * which uses the same upsert path but writes status='processing').
 *
 * Steps:
 *   1. Pull collectionId from event.data → look up crowded_forms row →
 *      get the campaign/category mapping and the local form id.
 *   2. Resolve donor → contact (auto-create via contact-match).
 *   3. Upsert manual_donation row keyed on (location_id, paymentId).
 *
 * If we can't find the form (admin deleted it but Crowded still has the
 * collection live), we log + skip — the donation can be recovered later
 * by manual SQL match.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { crowdedForms } from "@/lib/db/schema-crowded";
import { resolveContactForCrowdedDonor } from "../contact-match";
import { upsertCrowdedDonation } from "../donation-upsert";
import type { CrowdedEvent } from "./index";

interface CrowdedPaymentData {
  paymentId?: string;
  collectionId?: string;
  contactId?: string;
  /** Net amount in cents — what the org receives. */
  amount?: number;
  /** Processor fee in cents. */
  fee?: number;
  /** Optional gross figure if Crowded sends it directly. */
  grossAmount?: number;
  currency?: string;
  status?: string;
  method?: string;
  /** Donor identity (varies by event — fall back to contactId lookup). */
  payer?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    mobile?: string;
  };
  email?: string;
  firstName?: string;
  lastName?: string;
  /** Form-level data Crowded echoes back. */
  description?: string;
}

function dataOf(event: CrowdedEvent): CrowdedPaymentData {
  return (event.data ?? {}) as CrowdedPaymentData;
}

function mapStatus(
  crowdedStatus: string | undefined,
  eventType: string,
): "completed" | "processing" | "failed" | "refunded" {
  if (eventType === "collect.payment.processing") return "processing";
  if (eventType === "collect.payment.refunded") return "refunded";
  if (!crowdedStatus) return "completed";
  const lower = crowdedStatus.toLowerCase();
  if (lower === "succeeded" || lower === "success" || lower === "completed") return "completed";
  if (lower === "processing" || lower === "pending") return "processing";
  if (lower === "failed" || lower === "declined") return "failed";
  if (lower === "refunded") return "refunded";
  return "completed";
}

/**
 * Treats `amount` as Crowded's NET-to-org figure (per §9 of the plan).
 * For receipts we want the DONOR'S gift — which equals net only when
 * the donor covered the fee. If the org absorbed the fee, the gift is
 * net + fee. We can't know which mode without the form's fee_cover
 * setting; default to "donor covered" (most common). The reconciliation
 * column `crowded_fee_cents` always carries the raw fee for accounting.
 */
function computeGiftCents(
  netCents: number | null | undefined,
  feeCents: number | null | undefined,
  feeCoverDefault: string,
): number {
  const net = netCents ?? 0;
  const fee = feeCents ?? 0;
  if (feeCoverDefault === "org") return net + fee;
  // donor-covered (default) — gift equals net
  return net;
}

function centsToUsdString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function handlePaymentSucceeded(
  event: CrowdedEvent,
  locationId: string,
): Promise<void> {
  const d = dataOf(event);

  if (!d.paymentId) {
    console.warn(
      `[crowded-webhook] ${event.eventType}: missing paymentId, skipping`,
    );
    return;
  }
  if (!d.collectionId) {
    console.warn(
      `[crowded-webhook] ${event.eventType}: missing collectionId for paymentId=${d.paymentId}, skipping`,
    );
    return;
  }

  // 1. Look up the local form row → mapping into campaigns/categories.
  const [form] = await db
    .select()
    .from(crowdedForms)
    .where(
      and(
        eq(crowdedForms.locationId, locationId),
        eq(crowdedForms.crowdedCollectionId, d.collectionId),
      ),
    )
    .limit(1);

  if (!form) {
    // Collection exists on Crowded's side but admin deleted the form
    // row here. Record the event in the forensic store (caller does
    // this) and skip the donation insert.
    console.warn(
      `[crowded-webhook] ${event.eventType}: no crowded_forms row for ` +
        `collectionId=${d.collectionId} on location=${locationId}. ` +
        `Donation NOT recorded — recover via manual SQL if needed.`,
    );
    return;
  }

  // 2. Resolve donor → contact.
  const contactId = await resolveContactForCrowdedDonor(
    {
      crowdedContactId: d.contactId ?? null,
      email: d.payer?.email ?? d.email ?? null,
      mobile: d.payer?.mobile ?? null,
      firstName: d.payer?.firstName ?? d.firstName ?? null,
      lastName: d.payer?.lastName ?? d.lastName ?? null,
    },
    locationId,
  );

  // 3. Compute amount fields.
  const giftCents = computeGiftCents(d.amount, d.fee, form.feeCoverDefault);
  const giftUsd = centsToUsdString(giftCents);
  const paymentDate = pickDate(event.timestamp);

  // 4. Upsert.
  await upsertCrowdedDonation({
    contactId,
    locationId,
    crowdedResourceId: d.paymentId,
    crowdedFormId: form.id,
    campaignId: form.campaignId,
    categoryId: form.categoryId,
    categoryItemId: form.categoryItemId,
    accountId: form.accountId,
    amount: giftUsd,
    amountUsd: giftUsd,
    feeCents: d.fee ?? null,
    paymentMethod: d.method ?? null,
    paymentDate,
    paymentStatus: mapStatus(d.status, event.eventType),
    referenceNumber: d.paymentId,
    notes: d.description ?? form.name,
  });
}

function pickDate(iso: string | undefined): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}
