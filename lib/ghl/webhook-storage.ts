/**
 * Database helpers for the GHL webhook receiver.
 *
 * Concerns separated:
 *   - Webhook event lifecycle (received → processed/failed/skipped_*)
 *   - Loop prevention (check + record outbound writes)
 *   - Invoice event log (simple insert; full handler wired later)
 *
 * Uses Drizzle's explicit-table form (db.insert(table).values(...)). The
 * webhook tables are NOT registered with db.query.* — see schema-webhook.ts.
 */
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ghlWebhookEvents,
  ghlSyncWrites,
  ghlInvoiceEvents,
  type GhlWebhookEvent,
} from "@/lib/db/schema-webhook";
import type { ProcessingStatus } from "./webhook-types";

const LOOP_WINDOW_SECONDS = Number(
  process.env.GHL_WEBHOOK_LOOP_PREVENTION_WINDOW_SECONDS || "60",
);

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency + event lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export async function findEventByWebhookId(
  webhookId: string,
): Promise<GhlWebhookEvent | null> {
  const rows = await db
    .select()
    .from(ghlWebhookEvents)
    .where(eq(ghlWebhookEvents.webhookId, webhookId))
    .limit(1);
  return rows[0] ?? null;
}

export async function recordEventReceived(input: {
  webhookId: string;
  eventType: string;
  locationId: string | null;
  companyId: string | null;
  ghlTimestamp: Date | null;
  payload: unknown;
  signatureValid: boolean;
}): Promise<GhlWebhookEvent> {
  const [row] = await db
    .insert(ghlWebhookEvents)
    .values({
      webhookId: input.webhookId,
      eventType: input.eventType,
      locationId: input.locationId,
      companyId: input.companyId,
      ghlTimestamp: input.ghlTimestamp,
      payload: input.payload as object,
      signatureValid: input.signatureValid,
      processingStatus: "received",
    })
    .returning();
  return row;
}

export async function updateEventStatus(
  webhookId: string,
  status: ProcessingStatus,
  error?: string | null,
): Promise<void> {
  await db
    .update(ghlWebhookEvents)
    .set({
      processingStatus: status,
      processingError: error ?? null,
      processedAt: status === "received" ? null : new Date(),
    })
    .where(eq(ghlWebhookEvents.webhookId, webhookId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop prevention
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if Donor HQ recently wrote to this (location, ghlContactId)
 * pair AND that write hasn't expired yet. Used to skip echo webhooks that
 * GHL fires back at us within seconds of an outbound contact write.
 */
export async function isLoopEcho(
  locationId: string,
  ghlContactId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: ghlSyncWrites.id })
    .from(ghlSyncWrites)
    .where(
      and(
        eq(ghlSyncWrites.locationId, locationId),
        eq(ghlSyncWrites.ghlContactId, ghlContactId),
        gt(ghlSyncWrites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Public helper. Other Donor HQ code should call this immediately BEFORE (or
 * right after) writing a contact to GHL, so the subsequent echo webhook is
 * silently skipped instead of triggering a self-update loop.
 *
 *   await recordSyncWrite(locationId, ghlContactId);
 *   await fetch("https://services.leadconnectorhq.com/contacts/...", { ... });
 */
export async function recordSyncWrite(
  locationId: string,
  ghlContactId: string,
): Promise<void> {
  if (!locationId || !ghlContactId) return;
  const expiresAt = new Date(Date.now() + LOOP_WINDOW_SECONDS * 1000);
  await db.insert(ghlSyncWrites).values({
    locationId,
    ghlContactId,
    expiresAt,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice events
// ─────────────────────────────────────────────────────────────────────────────

export async function recordInvoiceEvent(input: {
  invoiceId: string | null;
  contactId: string | null;
  locationId: string | null;
  amount: string | null;
  currency: string | null;
  paidAt: Date | null;
  payload: unknown;
}): Promise<void> {
  await db.insert(ghlInvoiceEvents).values({
    invoiceId: input.invoiceId,
    contactId: input.contactId,
    locationId: input.locationId,
    amount: input.amount,
    currency: input.currency,
    paidAt: input.paidAt,
    payload: input.payload as object,
  });
}
