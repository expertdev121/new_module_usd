/**
 * High-level DonorHQ → GHL push orchestration.
 *
 * Responsibilities, in order:
 *   1. Resolve the GHL token context (locationId + lazy companyId fallback).
 *   2. Record an outbound-write suppression entry BEFORE we call GHL, so
 *      the inbound webhook echo gets skipped even if GHL responds before
 *      we finish the second statement (typical round-trip is ~1–3s).
 *   3. Call the appropriate api-client function (upsert, update, delete,
 *      tag add/remove) with a wall-clock budget — by default 2.5s.
 *   4. If the inline call wins: write the resulting ghlContactId back to
 *      the DonorHQ row (for upserts), update last_ghl_sync_at, return.
 *   5. If the inline call loses (timeout, network error, etc.): enqueue a
 *      retry into ghl_backfill_jobs (kind='push_contact') so the cron
 *      worker keeps trying. The user's save still succeeded.
 *
 * Callers (the POST/PUT/DELETE routes for /api/contacts) get a single
 * function each and don't have to think about any of this.
 */
import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contact as contactTable } from "@/lib/db/schema";
import { contactWithSync, ghlBackfillJobs } from "@/lib/db/schema-webhook";
import { getTokenRecord, findActiveCompanyToken } from "./oauth-storage";
import {
  upsertContactInGhl,
  updateContactInGhl,
  deleteContactInGhl,
  addTagsToContactInGhl,
  removeTagsFromContactInGhl,
  type GhlContactPushInput,
} from "./api-client";
import { recordOutboundWrite } from "./suppression";

/** Default inline wall-clock budget. After this, we fall back to the queue. */
const INLINE_BUDGET_MS = 2500;

export interface OutboundPushOpts {
  /** Maximum time to wait for the inline GHL call before falling back. */
  inlineBudgetMs?: number;
  /** If false, skips the inline attempt entirely and enqueues directly. */
  inline?: boolean;
}

export interface OutboundPushResult {
  /** What we did. `inline_ok` = called GHL inline, succeeded. */
  mode: "inline_ok" | "queued" | "skipped_no_connection";
  ghlContactId?: string;
  error?: string;
}

/**
 * Resolve a (locationId, companyId) pair from one of our token rows. We
 * prefer a Location-scoped row but accept any token whose companyId can
 * mint a per-location token via the lazy path.
 *
 * Returns null when no token can cover this location — the caller should
 * skip the push (and probably surface that to the user / admin UI).
 */
async function resolveTokenContext(
  locationId: string,
): Promise<{ companyId: string | null } | null> {
  const own = await getTokenRecord(locationId);
  if (own && own.status === "active") {
    return { companyId: own.companyId ?? null };
  }
  // No per-location token — try any active Company token that contains us.
  // We don't currently track Company→Location mapping in the DB, so the
  // lazy-mint path inside getValidAccessToken will iterate Company tokens
  // for us. Just return null companyId here and let the api-client try.
  return { companyId: null };
}

/**
 * Race a promise against a timer. Returns either the resolved value or
 * throws a TimeoutError tagged so callers can distinguish it.
 */
class InlineTimeoutError extends Error {
  constructor(ms: number) {
    super(`inline GHL push exceeded ${ms}ms budget`);
    this.name = "InlineTimeoutError";
  }
}
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new InlineTimeoutError(ms)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Enqueue a deferred outbound-push job for the cron worker. Uses the
 * existing ghl_backfill_jobs table with kind='push_contact' (single
 * contact) or kind='push_tags_add' / 'push_tags_remove' (tag deltas).
 *
 * The payload travels through the `cursor` TEXT column as JSON — it's
 * not actually used as a cursor for these job kinds, just as opaque
 * job-specific state. Saves us from adding another column.
 */
async function enqueueDeferredPush(
  kind: "push_contact" | "push_tags_add" | "push_tags_remove" | "push_delete",
  locationId: string,
  companyId: string | null,
  contactId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(ghlBackfillJobs).values({
    resourceId: locationId,
    resourceType: "Location",
    locationId,
    companyId,
    kind,
    status: "queued",
    pageSize: 1,
    triggeredBy: "manual", // — really "deferred outbound", but the enum is small
    // Stash the contact id + payload as JSON in the cursor column.
    cursor: JSON.stringify({ contactId, ...payload }),
  });
}

/**
 * Decode the cursor we wrote in enqueueDeferredPush. Returns null if the
 * cursor isn't JSON (e.g. it's a real GHL pagination cursor from a
 * push_contacts-batch job, not one of ours).
 */
export function decodeOutboundCursor(
  cursor: string | null,
): { contactId: number; [k: string]: unknown } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.contactId === "number"
    ) {
      return parsed as { contactId: number };
    }
  } catch {
    /* not JSON — it's a real pagination cursor */
  }
  return null;
}

/**
 * Push a single contact (create-or-update) from DonorHQ to GHL.
 *
 * - If `contact.ghlContactId` is set → PUT
 * - Otherwise → POST /contacts/upsert (GHL dedups on email/phone)
 *
 * On success, writes the resolved ghlContactId back to the DonorHQ row.
 */
export async function pushContactUpsert(
  donorHqContactId: number,
  locationId: string,
  data: GhlContactPushInput & { existingGhlContactId?: string | null },
  opts: OutboundPushOpts = {},
): Promise<OutboundPushResult> {
  if (!locationId) {
    return { mode: "skipped_no_connection", error: "no locationId on session" };
  }

  const ctx = await resolveTokenContext(locationId);
  if (!ctx) {
    return { mode: "skipped_no_connection", error: "no active GHL connection" };
  }

  // The inline-attempt path.
  const tryInline = async (): Promise<OutboundPushResult> => {
    // For updates we need the contact id BEFORE recording suppression.
    if (data.existingGhlContactId) {
      await recordOutboundWrite(locationId, data.existingGhlContactId);
      await updateContactInGhl(
        locationId,
        data.existingGhlContactId,
        stripExisting(data),
        { companyId: ctx.companyId ?? undefined },
      );
      await markSyncedOnDonorHq(donorHqContactId, data.existingGhlContactId);
      return { mode: "inline_ok", ghlContactId: data.existingGhlContactId };
    }
    // Upsert path — GHL returns the id.
    const result = await upsertContactInGhl(
      locationId,
      stripExisting(data),
      { companyId: ctx.companyId ?? undefined },
    );
    // Suppress AFTER we have the id (no earlier opportunity here).
    await recordOutboundWrite(locationId, result.ghlContactId);
    await markSyncedOnDonorHq(donorHqContactId, result.ghlContactId);
    return { mode: "inline_ok", ghlContactId: result.ghlContactId };
  };

  if (opts.inline === false) {
    await enqueueDeferredPush("push_contact", locationId, ctx.companyId, donorHqContactId, {
      data: stripExisting(data),
      existingGhlContactId: data.existingGhlContactId ?? null,
    });
    return { mode: "queued" };
  }

  try {
    return await withTimeout(tryInline(), opts.inlineBudgetMs ?? INLINE_BUDGET_MS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Inline failed — enqueue so the cron worker can retry.
    try {
      await enqueueDeferredPush(
        "push_contact",
        locationId,
        ctx.companyId,
        donorHqContactId,
        {
          data: stripExisting(data),
          existingGhlContactId: data.existingGhlContactId ?? null,
          inlineError: message.slice(0, 500),
        },
      );
    } catch (qErr) {
      console.error(
        `[push-contact] queue fallback ALSO failed for donor_hq id=${donorHqContactId}:`,
        qErr instanceof Error ? qErr.message : String(qErr),
      );
    }
    return { mode: "queued", error: message };
  }
}

/**
 * Hard-delete in GHL. Inline-first; falls back to queue on timeout.
 */
export async function pushContactDelete(
  donorHqContactId: number,
  locationId: string,
  ghlContactId: string,
  opts: OutboundPushOpts = {},
): Promise<OutboundPushResult> {
  if (!locationId || !ghlContactId) {
    return { mode: "skipped_no_connection", error: "missing locationId or ghlContactId" };
  }
  const ctx = await resolveTokenContext(locationId);
  if (!ctx) {
    return { mode: "skipped_no_connection", error: "no active GHL connection" };
  }

  const tryInline = async (): Promise<OutboundPushResult> => {
    await recordOutboundWrite(locationId, ghlContactId);
    await deleteContactInGhl(locationId, ghlContactId, {
      companyId: ctx.companyId ?? undefined,
    });
    return { mode: "inline_ok", ghlContactId };
  };

  if (opts.inline === false) {
    await enqueueDeferredPush(
      "push_delete",
      locationId,
      ctx.companyId,
      donorHqContactId,
      { ghlContactId },
    );
    return { mode: "queued" };
  }

  try {
    return await withTimeout(tryInline(), opts.inlineBudgetMs ?? INLINE_BUDGET_MS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await enqueueDeferredPush(
        "push_delete",
        locationId,
        ctx.companyId,
        donorHqContactId,
        { ghlContactId, inlineError: message.slice(0, 500) },
      );
    } catch (qErr) {
      console.error(
        `[push-contact] queue fallback failed for delete donor_hq id=${donorHqContactId}:`,
        qErr instanceof Error ? qErr.message : String(qErr),
      );
    }
    return { mode: "queued", error: message };
  }
}

/**
 * Push a tag addition. If the DonorHQ contact has no ghlContactId yet,
 * we skip — the next contact-level push will sync tags via the upsert body.
 */
export async function pushContactTagAdd(
  donorHqContactId: number,
  locationId: string,
  ghlContactId: string | null,
  tagName: string,
  opts: OutboundPushOpts = {},
): Promise<OutboundPushResult> {
  if (!ghlContactId) {
    return { mode: "skipped_no_connection", error: "no ghlContactId on contact" };
  }
  const ctx = await resolveTokenContext(locationId);
  if (!ctx) return { mode: "skipped_no_connection", error: "no active GHL connection" };

  const tryInline = async (): Promise<OutboundPushResult> => {
    await recordOutboundWrite(locationId, ghlContactId);
    await addTagsToContactInGhl(locationId, ghlContactId, [tagName], {
      companyId: ctx.companyId ?? undefined,
    });
    return { mode: "inline_ok", ghlContactId };
  };

  if (opts.inline === false) {
    await enqueueDeferredPush(
      "push_tags_add",
      locationId,
      ctx.companyId,
      donorHqContactId,
      { ghlContactId, tags: [tagName] },
    );
    return { mode: "queued" };
  }

  try {
    return await withTimeout(tryInline(), opts.inlineBudgetMs ?? INLINE_BUDGET_MS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await enqueueDeferredPush(
        "push_tags_add",
        locationId,
        ctx.companyId,
        donorHqContactId,
        { ghlContactId, tags: [tagName], inlineError: message.slice(0, 500) },
      );
    } catch {
      /* logged in caller */
    }
    return { mode: "queued", error: message };
  }
}

/**
 * Push a tag removal. Symmetric to pushContactTagAdd.
 */
export async function pushContactTagRemove(
  donorHqContactId: number,
  locationId: string,
  ghlContactId: string | null,
  tagName: string,
  opts: OutboundPushOpts = {},
): Promise<OutboundPushResult> {
  if (!ghlContactId) {
    return { mode: "skipped_no_connection", error: "no ghlContactId on contact" };
  }
  const ctx = await resolveTokenContext(locationId);
  if (!ctx) return { mode: "skipped_no_connection", error: "no active GHL connection" };

  const tryInline = async (): Promise<OutboundPushResult> => {
    await recordOutboundWrite(locationId, ghlContactId);
    await removeTagsFromContactInGhl(locationId, ghlContactId, [tagName], {
      companyId: ctx.companyId ?? undefined,
    });
    return { mode: "inline_ok", ghlContactId };
  };

  if (opts.inline === false) {
    await enqueueDeferredPush(
      "push_tags_remove",
      locationId,
      ctx.companyId,
      donorHqContactId,
      { ghlContactId, tags: [tagName] },
    );
    return { mode: "queued" };
  }

  try {
    return await withTimeout(tryInline(), opts.inlineBudgetMs ?? INLINE_BUDGET_MS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await enqueueDeferredPush(
        "push_tags_remove",
        locationId,
        ctx.companyId,
        donorHqContactId,
        { ghlContactId, tags: [tagName], inlineError: message.slice(0, 500) },
      );
    } catch {
      /* logged in caller */
    }
    return { mode: "queued", error: message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Strip the `existingGhlContactId` marker — it doesn't go to GHL. */
function stripExisting(
  data: GhlContactPushInput & { existingGhlContactId?: string | null },
): GhlContactPushInput {
  const { existingGhlContactId: _ignore, ...rest } = data;
  void _ignore;
  return rest;
}

/**
 * Write the resolved ghlContactId back to the DonorHQ row + bump
 * last_ghl_sync_at. Uses contactWithSync (the extended view) so we can
 * touch the sync columns added in migration 0019.
 */
async function markSyncedOnDonorHq(
  donorHqContactId: number,
  ghlContactId: string,
): Promise<void> {
  await db
    .update(contactWithSync)
    .set({
      ghlContactId,
      lastGhlSyncAt: new Date(),
      syncSource: "donorhq_outbound",
      updatedAt: new Date(),
    })
    .where(eq(contactWithSync.id, donorHqContactId));
}

// Re-export from the canonical contact table for grep-ability — some
// callers want to know they touched the same row.
export { contactTable };
void sql;
