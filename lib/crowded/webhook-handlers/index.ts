/**
 * Inbound Crowded webhook dispatcher.
 *
 * The webhook receiver parses Crowded's BATCHED envelope:
 *   { batchId, count, events: [{ id, eventType, context, data, timestamp }] }
 *
 * For each event:
 *   1. Resolve location from context.chapterId (unknown → "skipped")
 *   2. Dispatch on eventType
 *   3. Catch errors per-event so one bad event doesn't poison the batch
 *
 * Returns a per-event outcome the receiver records in crowded_webhook_events.
 */
import { getConnectionByChapterId } from "../connection-storage";
import { handlePaymentSucceeded } from "./payment-succeeded";
import { handlePaymentRefunded } from "./payment-refunded";
import {
  handlePaymentPlanCreated,
  handlePaymentPlanCompleted,
  handlePaymentPlanCanceled,
} from "./payment-plan";

export type DispatchOutcome =
  | "processed"
  | "skipped_unknown_chapter"
  | "skipped_unhandled_type"
  | "failed";

export interface CrowdedEvent {
  /** Crowded's per-event UUID — used for dedup. */
  id?: string;
  eventType: string;
  context?: {
    partnerId?: string;
    organizationId?: string;
    chapterId?: string;
  };
  data?: Record<string, unknown>;
  timestamp?: string;
}

export async function dispatchCrowdedEvent(event: CrowdedEvent): Promise<{
  outcome: DispatchOutcome;
  locationId: string | null;
  error?: string;
}> {
  const chapterId = event.context?.chapterId;
  if (!chapterId) {
    return { outcome: "skipped_unknown_chapter", locationId: null };
  }

  const conn = await getConnectionByChapterId(chapterId);
  if (!conn || conn.status !== "active") {
    // Either we don't have this chapter linked, or the connection is
    // revoked. Don't error — return 200 so Crowded doesn't retry forever.
    return { outcome: "skipped_unknown_chapter", locationId: null };
  }
  const locationId = conn.locationId;

  try {
    switch (event.eventType) {
      case "collect.payment.succeeded":
      case "collect.payment.processing":
        await handlePaymentSucceeded(event, locationId);
        return { outcome: "processed", locationId };

      case "collect.payment.refunded":
      case "collect.refund.created":
        await handlePaymentRefunded(event, locationId);
        return { outcome: "processed", locationId };

      case "collect.payment.failed":
        // Failed payment — we don't create a donation row, just record
        // the event in the forensic store. Returning "processed"
        // because we successfully decided not to write.
        return { outcome: "processed", locationId };

      case "collect.payment_plan.created":
        await handlePaymentPlanCreated(event, locationId);
        return { outcome: "processed", locationId };

      case "collect.payment_plan.completed":
        await handlePaymentPlanCompleted(event, locationId);
        return { outcome: "processed", locationId };

      case "collect.payment_plan.canceled":
        await handlePaymentPlanCanceled(event, locationId);
        return { outcome: "processed", locationId };

      default:
        return { outcome: "skipped_unhandled_type", locationId };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[crowded-webhook] handler threw for eventType=${event.eventType}, chapter=${chapterId}: ${message}`,
    );
    return { outcome: "failed", locationId, error: message };
  }
}
