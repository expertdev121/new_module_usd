/**
 * Handlers for the three payment-plan lifecycle events:
 *   - collect.payment_plan.created   → row in crowded_payment_plans
 *   - collect.payment_plan.completed → status = 'completed'
 *   - collect.payment_plan.canceled  → status = 'canceled'
 *
 * Individual cycle charges still arrive as collect.payment.succeeded
 * with their own paymentIds and become their own manual_donation rows.
 * This module only tracks the PLAN, not the charges.
 */
import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { crowdedPaymentPlans } from "@/lib/db/schema-crowded";
import type { CrowdedEvent } from "./index";

interface CrowdedPlanData {
  planId?: string;
  contactId?: string;
  collectionId?: string;
  type?: "recurring" | "installment";
  frequency?: string;
  paymentsCount?: number | null;
  /** Crowded sends this on .completed events. */
  totalPaidCents?: number;
}

function dataOf(event: CrowdedEvent): CrowdedPlanData {
  return (event.data ?? {}) as CrowdedPlanData;
}

/**
 * INSERT … ON CONFLICT for plans, keyed on crowded_plan_id. Webhook
 * order is not guaranteed — receiving .created after a .canceled
 * shouldn't resurrect the plan.
 */
export async function handlePaymentPlanCreated(
  event: CrowdedEvent,
  locationId: string,
): Promise<void> {
  const d = dataOf(event);
  if (!d.planId) {
    console.warn("[crowded-webhook] payment_plan.created: missing planId");
    return;
  }

  await db
    .insert(crowdedPaymentPlans)
    .values({
      locationId,
      crowdedPlanId: d.planId,
      type: d.type ?? "recurring",
      frequency: d.frequency ?? null,
      totalPayments: d.paymentsCount ?? null,
      status: "active",
      firstPaymentDate: event.timestamp ? new Date(event.timestamp) : null,
    })
    .onConflictDoNothing({
      target: crowdedPaymentPlans.crowdedPlanId,
    });
}

export async function handlePaymentPlanCompleted(
  event: CrowdedEvent,
  locationId: string,
): Promise<void> {
  const d = dataOf(event);
  if (!d.planId) return;
  // Avoid overwriting a previously-set 'canceled' status.
  await db
    .update(crowdedPaymentPlans)
    .set({
      status: sql`CASE WHEN status = 'canceled' THEN 'canceled' ELSE 'completed' END`,
      totalPaidCents: d.totalPaidCents ?? sql`total_paid_cents`,
      updatedAt: new Date(),
    })
    .where(eq(crowdedPaymentPlans.crowdedPlanId, d.planId));
  void locationId; // scope check already done in dispatcher
}

export async function handlePaymentPlanCanceled(
  event: CrowdedEvent,
  locationId: string,
): Promise<void> {
  const d = dataOf(event);
  if (!d.planId) return;
  await db
    .update(crowdedPaymentPlans)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(crowdedPaymentPlans.crowdedPlanId, d.planId));
  void locationId;
}
