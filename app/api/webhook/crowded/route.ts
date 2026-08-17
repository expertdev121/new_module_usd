/**
 * POST /api/webhook/crowded
 *
 * Inbound Crowded webhook receiver. Crowded sends BATCHED envelopes:
 *   { batchId: "...", count: 1+, events: [ {id, eventType, context, data, timestamp} ] }
 *
 * Per-event flow:
 *   1. Read raw body (verbatim — needed for signature)
 *   2. Verify signature using the secret for context.chapterId's location
 *      (multi-tenant: each partner has their own secret)
 *   3. For each event: dedup by event.id in crowded_webhook_events
 *   4. Dispatch to the right handler; record outcome
 *
 * Always returns 2xx if the signature was valid — we don't want Crowded
 * retrying forever on logic bugs. Forensic store retains the raw payload
 * for re-processing if needed.
 */
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { crowdedWebhookEvents } from "@/lib/db/schema-crowded";
import {
  decryptWebhookSecret,
  getConnectionByChapterId,
} from "@/lib/crowded/connection-storage";
import { verifySignature } from "@/lib/crowded/webhook-signature";
import { isTestPayment } from "@/lib/payments/is-test-payment";
import {
  dispatchCrowdedEvent,
  type CrowdedEvent,
} from "@/lib/crowded/webhook-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CrowdedBatchEnvelope {
  batchId?: string;
  count?: number;
  events?: CrowdedEvent[];
}

export async function POST(req: NextRequest) {
  // Step 1 — capture the raw body for signature verification.
  const rawBody = await req.text();

  let envelope: CrowdedBatchEnvelope;
  try {
    envelope = JSON.parse(rawBody) as CrowdedBatchEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const events = envelope.events ?? [];
  if (events.length === 0) {
    // Empty batch — acknowledge.
    return NextResponse.json({ ok: true, count: 0 });
  }

  // Step 2 — verify the batch signature. All events in a batch share the
  // same chapter (Crowded guarantee per docs); we resolve the secret from
  // the FIRST event's context.chapterId.
  const firstChapterId = events[0]?.context?.chapterId;
  if (!firstChapterId) {
    return NextResponse.json(
      { error: "missing_chapter_id" },
      { status: 400 },
    );
  }
  const conn = await getConnectionByChapterId(firstChapterId);
  if (!conn || !conn.webhookSecretEnc) {
    // Unknown chapter or missing secret — 2xx so Crowded stops retrying.
    // We log so unknown-chapter floods are visible.
    console.warn(
      `[crowded-webhook] received batch for unknown chapter=${firstChapterId} or missing secret`,
    );
    return NextResponse.json({ ok: true, skipped: "unknown_chapter" });
  }
  const secret = decryptWebhookSecret(conn);
  if (!secret) {
    console.warn(
      `[crowded-webhook] decrypted webhook secret was empty for chapter=${firstChapterId}`,
    );
    return NextResponse.json({ ok: true, skipped: "no_secret" });
  }

  const sigCheck = verifySignature(
    rawBody,
    req.headers.get("x-webhook-signature"),
    secret,
  );
  if (!sigCheck.valid) {
    console.warn(
      `[crowded-webhook] signature FAILED for chapter=${firstChapterId}, location=${conn.locationId}`,
    );
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  // Step 3 — per-event processing.
  const outcomes: Array<{
    eventId: string | null;
    type: string;
    outcome: string;
    error?: string;
  }> = [];

  for (const event of events) {
    const eventId = event.id ?? null;
    const type = event.eventType ?? "unknown";

    // Skip test-mode charges so DonorHQ only records real, live revenue.
    if (isTestPayment(event)) {
      outcomes.push({ eventId, type, outcome: "skipped_test" });
      continue;
    }

    if (!eventId) {
      outcomes.push({ eventId, type, outcome: "skipped_no_id" });
      continue;
    }

    // Dedup: INSERT … ON CONFLICT DO NOTHING on event_id. If we've seen
    // it before, the insert returns no rows and we skip processing.
    const inserted = await db
      .insert(crowdedWebhookEvents)
      .values({
        eventId,
        batchId: envelope.batchId ?? null,
        eventType: type,
        chapterId: event.context?.chapterId ?? null,
        locationId: conn.locationId,
        payload: event as unknown as object,
        signatureValid: true,
        processingStatus: "received",
      })
      .onConflictDoNothing({ target: crowdedWebhookEvents.eventId })
      .returning({ id: crowdedWebhookEvents.id });

    if (inserted.length === 0) {
      // Duplicate event — already processed. 2xx, no-op.
      outcomes.push({ eventId, type, outcome: "duplicate" });
      continue;
    }
    const eventRowId = inserted[0].id;

    // Dispatch.
    try {
      const result = await dispatchCrowdedEvent(event);
      await db.execute(sql`
        UPDATE crowded_webhook_events
           SET processing_status = ${result.outcome},
               processing_error  = ${result.error ?? null},
               processed_at      = NOW()
         WHERE id = ${eventRowId}
      `);
      outcomes.push({ eventId, type, outcome: result.outcome, error: result.error });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.execute(sql`
        UPDATE crowded_webhook_events
           SET processing_status = 'failed',
               processing_error  = ${message},
               processed_at      = NOW()
         WHERE id = ${eventRowId}
      `);
      outcomes.push({ eventId, type, outcome: "failed", error: message });
      // Don't break the batch — keep processing the rest.
    }
  }

  return NextResponse.json({
    ok: true,
    batchId: envelope.batchId,
    count: events.length,
    outcomes,
  });
}
