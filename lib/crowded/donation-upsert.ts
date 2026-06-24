/**
 * Upsert a Crowded payment event into manual_donation.
 *
 * Same shape used by:
 *   - The webhook handler (live event)
 *   - Future "manual re-pull" if Crowded adds a list-payments endpoint
 *
 * Dedup key: (location_id, crowded_resource_id) via the partial UNIQUE
 * `manual_donation_crowded_location_unique` (migration 0027). Same
 * payment.succeeded event delivered twice → one row, not two.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manualDonation } from "@/lib/db/schema";

export interface CrowdedDonationUpsertInput {
  /** Resolved DonorHQ contact.id from contact-match. */
  contactId: number;
  /** Tenant scope — from the crowded_connections lookup via chapterId. */
  locationId: string;
  /** Crowded's paymentId — dedup key. */
  crowdedResourceId: string;
  /** Local crowded_forms.id — gives reports the form/campaign mapping. */
  crowdedFormId: number | null;
  /** Optional DonorHQ campaign / category to attach (from the form row). */
  campaignId: number | null;
  categoryId: number | null;
  categoryItemId: number | null;
  accountId: number | null;
  /** Gift amount in WHOLE units (numeric), USD. */
  amountUsd: string;
  /** Same value duplicated in `amount` column (Crowded is USD-only). */
  amount: string;
  /** Processor fee in cents, kept raw for reconciliation reports. */
  feeCents: number | null;
  /** card / ach / bank / etc — raw value Crowded sent. */
  paymentMethod: string | null;
  /** ISO date — when the payment cleared. */
  paymentDate: string;
  /** Crowded status mapped to our enum. */
  paymentStatus: "completed" | "pending" | "failed" | "refunded" | "processing";
  /** Crowded paymentId, also stored on reference_number for convenience. */
  referenceNumber: string;
  /** Free-form notes — usually the form name / description. */
  notes: string | null;
}

/**
 * Insert OR update the manual_donation row. Returns nothing — webhook
 * handler treats the call as opaque.
 */
export async function upsertCrowdedDonation(
  input: CrowdedDonationUpsertInput,
): Promise<void> {
  const values = {
    contactId: input.contactId,
    locationId: input.locationId,
    amount: input.amount,
    amountUsd: input.amountUsd,
    currency: "USD" as const,
    exchangeRate: "1.0000",
    paymentDate: input.paymentDate,
    receivedDate: input.paymentDate,
    paymentMethod: input.paymentMethod,
    paymentStatus: input.paymentStatus,
    referenceNumber: input.referenceNumber,
    notes: input.notes,
    campaignId: input.campaignId,
    categoryId: input.categoryId,
    categoryItemId: input.categoryItemId,
    accountId: input.accountId,
    // Crowded provenance — used for badge + reconciliation
    crowdedSource: "crowded_payment",
    crowdedResourceId: input.crowdedResourceId,
    crowdedFormId: input.crowdedFormId,
    crowdedPaymentMethod: input.paymentMethod,
    crowdedFeeCents: input.feeCents,
  } as typeof manualDonation.$inferInsert;

  await db
    .insert(manualDonation)
    .values(values)
    .onConflictDoUpdate({
      target: [manualDonation.locationId, manualDonation.crowdedResourceId],
      targetWhere: sql`location_id IS NOT NULL AND crowded_resource_id IS NOT NULL`,
      set: {
        // Only update fields that can legitimately change between
        // payment.processing → payment.succeeded → payment.refunded.
        // We never overwrite the contact_id or form_id on an existing row.
        amount: input.amount,
        amountUsd: input.amountUsd,
        paymentStatus: input.paymentStatus,
        paymentDate: input.paymentDate,
        receivedDate: input.paymentDate,
        paymentMethod: input.paymentMethod,
        crowdedPaymentMethod: input.paymentMethod,
        crowdedFeeCents: input.feeCents,
        notes: input.notes,
        updatedAt: new Date(),
      },
    });
}
