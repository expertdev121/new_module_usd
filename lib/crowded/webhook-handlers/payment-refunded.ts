/**
 * Handler: collect.payment.refunded / collect.refund.created.
 *
 * Marks the existing manual_donation row (matched by Crowded paymentId)
 * as refunded. If we never recorded the original payment (e.g. the
 * webhook delivery for `payment.succeeded` failed and was never retried),
 * we log + skip — there's nothing to refund on our side.
 *
 * Partial refunds: we still mark the row 'refunded' rather than trying
 * to compute net-of-refund amounts. Finance reconciliation reads the
 * raw fee/refund detail from the forensic store (crowded_webhook_events)
 * when partial-refund accuracy matters.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { CrowdedEvent } from "./index";

interface CrowdedRefundData {
  /** Crowded's paymentId of the ORIGINAL charge being refunded. */
  paymentId?: string;
  refundId?: string;
  /** Some refund events nest the original payment id. */
  payment?: { id?: string };
  /** Refund amount in cents (might be partial). */
  amount?: number;
}

export async function handlePaymentRefunded(
  event: CrowdedEvent,
  locationId: string,
): Promise<void> {
  const d = (event.data ?? {}) as CrowdedRefundData;
  const originalPaymentId = d.paymentId ?? d.payment?.id;
  if (!originalPaymentId) {
    console.warn(
      `[crowded-webhook] ${event.eventType}: missing original paymentId, skipping`,
    );
    return;
  }

  // Update the manual_donation row keyed by (location_id, crowded_resource_id).
  // We use raw SQL since manual_donation's Drizzle handle in schema.ts
  // doesn't expose the partial-unique index condition directly.
  await db.execute(sql`
    UPDATE manual_donation
       SET payment_status = 'refunded',
           updated_at = NOW()
     WHERE location_id = ${locationId}
       AND crowded_resource_id = ${originalPaymentId}
  `);
}
