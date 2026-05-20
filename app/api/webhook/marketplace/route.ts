/**
 * POST /api/webhook/marketplace
 *
 * Single endpoint for ALL GHL Marketplace App webhooks. Paste this URL into
 * every event slot in the Marketplace App settings (ContactCreate,
 * ContactUpdate, ContactDelete, ContactDndUpdate, ContactTagUpdate,
 * InvoicePaid). We dispatch internally on the payload's `type` field.
 *
 * Hot-path: verify signature → dedupe → record → return 200 → process
 * asynchronously via Next.js `after()`. The async work updates the event
 * row's processing_status when it finishes.
 *
 * Response contract (per the brief, critical for GHL compliance):
 *   • Invalid signature → 401, nothing stored.
 *   • EVERYTHING ELSE → 200, even if the payload is malformed or the
 *     handler crashes downstream. Failures are recorded in the
 *     ghl_webhook_events table, not signaled via HTTP status.
 */
import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import {
  verifyWebhookSignature,
  maskSignature,
} from "@/lib/ghl/webhook-signature";
import {
  findEventByWebhookId,
  recordEventReceived,
  updateEventStatus,
  isLoopEcho,
} from "@/lib/ghl/webhook-storage";
import { getTokenRecord, findActiveCompanyToken } from "@/lib/ghl/oauth-storage";
import { getValidAccessToken } from "@/lib/ghl/get-access-token";
import { dispatchEvent } from "@/lib/ghl/webhook-handlers";
import { extractGhlContactId } from "@/lib/ghl/webhook-mapping";
import type {
  GhlContactPayload,
  GhlInvoicePayload,
  GhlWebhookPayload,
  ProcessingStatus,
} from "@/lib/ghl/webhook-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Logging helper. Consistent prefix + structured shape so log search works.
// Never includes raw tokens or full signature headers.
// ─────────────────────────────────────────────────────────────────────────────
function log(
  level: "info" | "warn" | "error",
  message: string,
  meta: Record<string, unknown> = {},
): void {
  const line = `[ghl-webhook] ${message} ${JSON.stringify(meta)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "<none>";
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  // 1. Read RAW body — must happen before any JSON.parse so the signature
  //    is computed against the same bytes GHL signed.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    log("error", "failed to read request body", {
      error: err instanceof Error ? err.message : String(err),
    });
    // The body might be unreadable for transport reasons — return 200 so
    // GHL doesn't retry; nothing actionable on our side.
    return NextResponse.json({ success: false });
  }

  // 2. Pull signature headers.
  const ed25519Header = req.headers.get("x-ghl-signature");
  const rsaHeader = req.headers.get("x-wh-signature");

  // 3. Verify. THIS is the only path where we return non-2xx.
  const verifyResult = verifyWebhookSignature(rawBody, ed25519Header, rsaHeader);
  if (!verifyResult.valid) {
    log("warn", "signature verification failed", {
      reason: verifyResult.reason,
      ed25519: maskSignature(ed25519Header),
      rsa: maskSignature(rsaHeader),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { success: false, error: "invalid_signature" },
      { status: 401 },
    );
  }

  // 4. Parse JSON.
  let payload: GhlWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GhlWebhookPayload;
  } catch (err) {
    log("warn", "malformed JSON body", {
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ success: true, ignored: "malformed_json" });
  }

  // 5. Extract identity fields.
  const webhookId = payload.webhookId;
  const eventType = String(payload.type ?? "");
  const locationId = payload.locationId ?? null;
  const companyId = payload.companyId ?? null;
  const ghlTimestamp = payload.timestamp ? new Date(payload.timestamp) : null;

  if (!webhookId) {
    log("warn", "payload missing webhookId — cannot dedupe", {
      eventType,
      locationId: locationId ?? "<none>",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ success: true, ignored: "missing_webhook_id" });
  }

  // 6. Idempotency check.
  try {
    const existing = await findEventByWebhookId(webhookId);
    if (existing) {
      log("info", "duplicate webhook", {
        webhookId: shortId(webhookId),
        eventType,
        locationId: locationId ?? "<none>",
        status: "duplicate",
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ success: true, duplicate: true });
    }
  } catch (err) {
    // DB error during dedupe check is not fatal — we still try to record.
    log("error", "dedupe lookup failed", {
      webhookId: shortId(webhookId),
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 7. Record event with status=received.
  try {
    await recordEventReceived({
      webhookId,
      eventType,
      locationId,
      companyId,
      ghlTimestamp: ghlTimestamp && !Number.isNaN(ghlTimestamp.getTime()) ? ghlTimestamp : null,
      payload,
      signatureValid: true,
    });
  } catch (err) {
    // If the insert raced with another process and we hit the unique
    // constraint, treat it as a duplicate. Otherwise log and proceed.
    log("error", "recordEventReceived failed", {
      webhookId: shortId(webhookId),
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ success: true, ignored: "storage_failed" });
  }

  log("info", "webhook received", {
    webhookId: shortId(webhookId),
    eventType,
    locationId: locationId ?? "<none>",
    status: "received",
    durationMs: Date.now() - startedAt,
  });

  // 8. Schedule async processing AFTER the response is flushed.
  after(async () => {
    await processWebhook({
      webhookId,
      eventType,
      locationId,
      payload,
    });
  });

  // 9. Return 200 immediately.
  return NextResponse.json({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Async processor — runs after the 200 has been sent.
// Never throws. All failures stamp the event row.
// ─────────────────────────────────────────────────────────────────────────────

async function processWebhook(input: {
  webhookId: string;
  eventType: string;
  locationId: string | null;
  payload: GhlWebhookPayload;
}): Promise<void> {
  const { webhookId, eventType, locationId, payload } = input;
  const processStartedAt = Date.now();

  const finish = async (status: ProcessingStatus, error?: string | null) => {
    try {
      await updateEventStatus(webhookId, status, error ?? null);
    } catch (err) {
      log("error", "updateEventStatus failed", {
        webhookId: shortId(webhookId),
        error: err instanceof Error ? err.message : String(err),
      });
    }
    log("info", "webhook processed", {
      webhookId: shortId(webhookId),
      eventType,
      locationId: locationId ?? "<none>",
      status,
      durationMs: Date.now() - processStartedAt,
    });
  };

  // No location → can't authenticate any callback to GHL, and we can't
  // safely target a contact (every multi-tenant lookup requires locationId).
  if (!locationId) {
    await finish("skipped_no_token", "missing locationId");
    return;
  }

  // Connection-installed check. Three valid states:
  //   (a) Per-location row exists for this locationId — proceed.
  //   (b) No per-location row, but a Company-level row exists for the
  //       parent companyId (agency-level install). Lazy-mint the per-location
  //       token from the company token, then proceed. Mirrors the official
  //       GHL template's getLocationTokenFromCompanyToken-on-demand pattern.
  //   (c) Neither — the customer never installed (or revoked). Skip.
  const payloadCompanyId =
    (payload as { companyId?: string }).companyId ?? null;
  try {
    const directToken = await getTokenRecord(locationId);
    if (!directToken) {
      // No per-location row. Try lazy-mint from a Company row if we have one.
      if (payloadCompanyId) {
        const companyRow = await findActiveCompanyToken(payloadCompanyId);
        if (companyRow) {
          try {
            // getValidAccessToken will mint + persist the per-location row.
            await getValidAccessToken(locationId, { companyId: payloadCompanyId });
            log("info", "minted lazy location token from company token", {
              webhookId: shortId(webhookId),
              locationId,
              companyId: payloadCompanyId,
            });
          } catch (mintErr) {
            await finish(
              "failed",
              `lazy-mint failed: ${mintErr instanceof Error ? mintErr.message : String(mintErr)}`,
            );
            return;
          }
        } else {
          await finish("skipped_no_token", "no per-location row and no parent company row");
          return;
        }
      } else {
        await finish("skipped_no_token", "no per-location row and no companyId in payload");
        return;
      }
    }
  } catch (err) {
    await finish(
      "failed",
      `OAuth lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Loop prevention: if Donor HQ just wrote this contact OUT to GHL, this
  // webhook is almost certainly the echo. Skip.
  const contactPayload = payload as GhlContactPayload;
  const ghlContactId = extractGhlContactId(contactPayload);
  if (ghlContactId) {
    try {
      if (await isLoopEcho(locationId, ghlContactId)) {
        await finish("skipped_loop");
        return;
      }
    } catch (err) {
      // Don't fail the whole pipeline if the loop check errors — log and
      // proceed (worst case is a self-update, which is harmless).
      log("warn", "loop-echo check failed; proceeding", {
        webhookId: shortId(webhookId),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Dispatch.
  try {
    const outcome = await dispatchEvent(eventType, payload, locationId);
    if (outcome === "unknown_type") {
      await finish("unknown_type", `unhandled event type: ${eventType}`);
    } else {
      await finish("processed");
    }
  } catch (err) {
    await finish(
      "failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Healthcheck — GET returns a JSON heartbeat so it's easy to confirm the
// endpoint is reachable in the GHL Marketplace UI / by curl.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/webhook/marketplace",
    accepts: "POST",
    note: "Configure this URL in the GHL Marketplace App for all 6 subscribed events.",
  });
}
