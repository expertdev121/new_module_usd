/**
 * Historical-contact backfill.
 *
 * Runs in chunks driven by a Vercel cron (every minute) + a manual trigger
 * endpoint. Each tick:
 *   1. claimNextJob() — atomically lease the oldest queued/running job whose
 *      next_run_at <= NOW(), with a short (60s) lease so a second cron
 *      instance can't double-process the same job.
 *   2. listContactsFromGhl() — fetch one page of contacts from GHL.
 *   3. For each contact: build the same insert/update values shape the
 *      webhook handler uses, run INSERT ... ON CONFLICT DO UPDATE targeted
 *      at the `contact_ghl_location_unique` partial index. This is the
 *      critical dedup guarantee — if a contact already exists (from a prior
 *      webhook or a prior backfill run), we UPDATE rather than insert a dupe.
 *   4. Sync normalized tags + advance the cursor + reschedule (or complete).
 *
 * IMPORTANT: This module imports from the same upsert path as the webhook
 * handler so the dedup behaviour is identical. The partial UNIQUE index
 * added in migration 0022 is what makes concurrent webhook + backfill safe.
 */
import { sql, eq, and, or, lte, isNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contactWithSync,
  ghlBackfillJobs,
  type NewContactWithSync,
  type GhlBackfillJob,
} from "@/lib/db/schema-webhook";
import { listContactsFromGhl, type GhlContactFull } from "./api-client";
import { syncContactTagsToNormalized } from "./sync-contact-tags";
import { randomUUID } from "node:crypto";

const LEASE_SECONDS = 60;
const DEFAULT_PAGE_SIZE = 100;
// After a successful chunk we reschedule the job for ~2s later so the next
// cron tick or the same invocation (if still warm) can pick it up. The cron
// runs every minute on Vercel Pro so realistically the next tick will fire
// at most 60s later — which is fine for a multi-thousand-contact backfill.
const REQUEUE_SECONDS_OK = 2;
// On error we back off — 60s on first failure, capped at 10 min.
function backoffSeconds(attempt: number): number {
  const base = Math.min(60 * Math.pow(2, attempt - 1), 600);
  return base;
}

export interface EnqueueOpts {
  resourceId: string;
  resourceType: "Location" | "Company";
  locationId: string;
  companyId?: string | null;
  triggeredBy?: "install" | "manual" | "cron";
  pageSize?: number;
}

/**
 * Enqueue a backfill job for one location. Idempotent — if an active job
 * already exists for (resource_id, kind='contacts'), this is a no-op and
 * returns the existing row. Safe to call from the OAuth callback on every
 * install (re-installs won't create a duplicate job).
 */
export async function enqueueContactBackfill(
  opts: EnqueueOpts,
): Promise<{ job: GhlBackfillJob; created: boolean }> {
  const { resourceId, resourceType, locationId, companyId, triggeredBy, pageSize } =
    opts;
  if (!resourceId || !locationId) {
    throw new Error("enqueueContactBackfill: resourceId and locationId required");
  }

  // SELECT-then-INSERT. We can't reliably use ON CONFLICT against the
  // partial unique index because Postgres requires the WHERE predicate to
  // match the index's normalized form exactly (and Drizzle's serializer
  // doesn't guarantee that). The partial index still protects us at the
  // DB layer if two enqueues race — the second INSERT will hit the index
  // violation and throw, which the caller treats as "already enqueued".
  const [existing] = await db
    .select()
    .from(ghlBackfillJobs)
    .where(
      and(
        eq(ghlBackfillJobs.resourceId, resourceId),
        eq(ghlBackfillJobs.kind, "contacts"),
        inArray(ghlBackfillJobs.status, ["queued", "running"]),
      ),
    )
    .limit(1);

  if (existing) {
    return { job: existing, created: false };
  }

  try {
    const [inserted] = await db
      .insert(ghlBackfillJobs)
      .values({
        resourceId,
        resourceType,
        locationId,
        companyId: companyId ?? null,
        kind: "contacts",
        status: "queued",
        pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
        triggeredBy: triggeredBy ?? "install",
      })
      .returning();
    return { job: inserted, created: true };
  } catch (err) {
    // Lost the race against the partial UNIQUE index — another caller
    // just enqueued. Re-read and return whichever row won.
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("ghl_backfill_jobs_active_unique") ||
      message.includes("duplicate key")
    ) {
      const [winner] = await db
        .select()
        .from(ghlBackfillJobs)
        .where(
          and(
            eq(ghlBackfillJobs.resourceId, resourceId),
            eq(ghlBackfillJobs.kind, "contacts"),
            inArray(ghlBackfillJobs.status, ["queued", "running"]),
          ),
        )
        .limit(1);
      if (winner) return { job: winner, created: false };
    }
    throw err;
  }
}

/**
 * Atomic lease acquisition. Picks the oldest job whose:
 *   - status is queued OR running
 *   - next_run_at <= NOW()
 *   - lease has expired or never been set
 *
 * Uses an UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)
 * pattern so two concurrent workers can't grab the same job. Returns null
 * when there's nothing to do.
 */
async function claimNextJob(): Promise<GhlBackfillJob | null> {
  const leaseToken = randomUUID();
  // Postgres-flavoured atomic claim. We use raw SQL because Drizzle doesn't
  // model SELECT ... FOR UPDATE SKIP LOCKED in its chainable builder.
  const result = await db.execute(sql`
    WITH pick AS (
      SELECT id FROM ghl_backfill_jobs
      WHERE status IN ('queued', 'running')
        AND next_run_at <= NOW()
        AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())
      ORDER BY next_run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE ghl_backfill_jobs j
       SET status = 'running',
           lease_token = ${leaseToken}::uuid,
           lease_expires_at = NOW() + (${LEASE_SECONDS} || ' seconds')::interval,
           started_at = COALESCE(started_at, NOW()),
           updated_at = NOW(),
           attempt_count = attempt_count + 1
      FROM pick
     WHERE j.id = pick.id
    RETURNING j.*
  `);

  // Drizzle's db.execute returns a result object whose shape depends on the
  // underlying driver. neon-http returns `{ rows: [...] }`, neon-serverless
  // sometimes returns the array directly. Be defensive.
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  if (rows.length === 0) return null;

  // CRITICAL: db.execute returns rows with the raw Postgres column names
  // (snake_case). The rest of the codepath consumes camelCase (because the
  // Drizzle Selects use the column object names). Map here so consumers
  // don't all have to switch — and so we don't silently get `undefined`
  // values that cascade into Invalid Date + NaN errors downstream.
  const r = rows[0] as Record<string, unknown>;
  return {
    id: r.id as string,
    resourceId: r.resource_id as string,
    resourceType: r.resource_type as string,
    locationId: (r.location_id as string | null) ?? null,
    companyId: (r.company_id as string | null) ?? null,
    kind: r.kind as string,
    status: r.status as string,
    cursor: (r.cursor as string | null) ?? null,
    page: r.page as number,
    pageSize: r.page_size as number,
    totalEstimate: (r.total_estimate as number | null) ?? null,
    processedCount: r.processed_count as number,
    upsertedCount: r.upserted_count as number,
    failedCount: r.failed_count as number,
    lastError: (r.last_error as string | null) ?? null,
    attemptCount: r.attempt_count as number,
    triggeredBy: r.triggered_by as string,
    leaseToken: (r.lease_token as string | null) ?? null,
    leaseExpiresAt: r.lease_expires_at ? new Date(r.lease_expires_at as string) : null,
    nextRunAt: new Date(r.next_run_at as string),
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
    startedAt: r.started_at ? new Date(r.started_at as string) : null,
    completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
  } as unknown as GhlBackfillJob;
}

/**
 * Build the INSERT values for one GHL contact, matching the shape used by
 * the webhook handler so the ON CONFLICT branch produces identical results.
 *
 * Notably, we set `sync_source = 'ghl_backfill'` so we can tell in the DB
 * which rows came from the historical pull vs. live webhooks.
 */
function buildContactValues(
  contact: GhlContactFull,
  locationId: string,
): NewContactWithSync {
  const normalizePhone = (p: string | null | undefined) => {
    if (!p) return null;
    const cleaned = p.replace(/[\s\-()+]/g, "").trim();
    return cleaned.length > 0 ? cleaned : null;
  };
  const nonEmpty = (s: string | null | undefined) =>
    s && s.trim().length > 0 ? s.trim() : null;

  const addr1 = nonEmpty(contact.address1);
  const city = nonEmpty(contact.city);
  const state = nonEmpty(contact.state);
  const postal = nonEmpty(contact.postalCode);
  const country = nonEmpty(contact.country);
  const legacyAddress = [addr1, city, state, postal, country]
    .filter((p): p is string => Boolean(p))
    .join(", ");

  // GHL's customFields can be an array of {id, value} or an object map.
  let ghlCustomFields: Record<string, unknown> | null = null;
  if (contact.customFields) {
    if (Array.isArray(contact.customFields)) {
      const cf: Record<string, unknown> = {};
      for (const f of contact.customFields) {
        if (f && typeof f === "object" && "id" in f) {
          cf[String(f.id)] = (f as { value: unknown }).value;
        }
      }
      ghlCustomFields = Object.keys(cf).length > 0 ? cf : null;
    } else if (typeof contact.customFields === "object") {
      ghlCustomFields = contact.customFields as Record<string, unknown>;
    }
  }

  return {
    ghlContactId: contact.id,
    locationId,
    firstName: nonEmpty(contact.firstName) ?? "N/A",
    lastName: nonEmpty(contact.lastName) ?? "N/A",
    email: contact.email ? contact.email.trim().toLowerCase() : null,
    phone: normalizePhone(contact.phone),
    address: legacyAddress.length > 0 ? legacyAddress : null,
    address1: addr1,
    city,
    state,
    postalCode: postal,
    country,
    organization: nonEmpty(contact.companyName),
    dateOfBirth: nonEmpty(contact.dateOfBirth),
    source: nonEmpty(contact.source),
    doNotContact: contact.dnd ?? false,
    tags: Array.isArray(contact.tags) ? contact.tags : null,
    ghlCustomFields,
    syncSource: "ghl_backfill",
    lastGhlSyncAt: new Date(),
    isLegacyDuplicate: false,
  };
}

/**
 * Process one chunk of one job. Returns a status string for logging:
 *   - "no_jobs"     — nothing in the queue
 *   - "chunk_done"  — processed N contacts, more to come, requeued
 *   - "completed"   — job finished (last page)
 *   - "failed"      — error mid-chunk, job backed off / marked failed
 *
 * The cron route calls this in a loop until it returns no_jobs or the
 * function's wall-clock budget runs out (we cap at ~50s on Vercel Pro's
 * 300s function limit to stay well under).
 */
export async function processNextChunk(): Promise<{
  status: "no_jobs" | "chunk_done" | "completed" | "failed";
  jobId?: string;
  processed?: number;
  upserted?: number;
  hasMore?: boolean;
  error?: string;
}> {
  const job = await claimNextJob();
  if (!job) return { status: "no_jobs" };

  try {
    if (!job.locationId) {
      throw new Error(`job ${job.id} has no location_id — cannot list contacts`);
    }

    const page = await listContactsFromGhl(job.locationId, {
      companyId: job.companyId ?? undefined,
      limit: job.pageSize,
      startAfter: parseCursorTimestamp(job.cursor),
      startAfterId: parseCursorId(job.cursor),
    });

    let upserted = 0;
    let failed = 0;
    for (const contact of page.contacts) {
      try {
        const values = buildContactValues(contact, job.locationId);
        const [row] = await db
          .insert(contactWithSync)
          .values(values)
          .onConflictDoUpdate({
            target: [contactWithSync.ghlContactId, contactWithSync.locationId],
            targetWhere: sql`is_legacy_duplicate = FALSE AND ghl_contact_id IS NOT NULL AND location_id IS NOT NULL`,
            set: {
              // Backfill should NOT clobber live webhook updates — only fill
              // gaps. We update fields that are NULL on the existing row,
              // leave the rest alone. Postgres COALESCE expression in SET.
              firstName: sql`COALESCE(NULLIF(${contactWithSync.firstName}, 'N/A'), EXCLUDED.first_name)`,
              lastName: sql`COALESCE(NULLIF(${contactWithSync.lastName}, 'N/A'), EXCLUDED.last_name)`,
              email: sql`COALESCE(${contactWithSync.email}, EXCLUDED.email)`,
              phone: sql`COALESCE(${contactWithSync.phone}, EXCLUDED.phone)`,
              address: sql`COALESCE(${contactWithSync.address}, EXCLUDED.address)`,
              address1: sql`COALESCE(${contactWithSync.address1}, EXCLUDED.address1)`,
              city: sql`COALESCE(${contactWithSync.city}, EXCLUDED.city)`,
              state: sql`COALESCE(${contactWithSync.state}, EXCLUDED.state)`,
              postalCode: sql`COALESCE(${contactWithSync.postalCode}, EXCLUDED.postal_code)`,
              country: sql`COALESCE(${contactWithSync.country}, EXCLUDED.country)`,
              organization: sql`COALESCE(${contactWithSync.organization}, EXCLUDED.organization)`,
              dateOfBirth: sql`COALESCE(${contactWithSync.dateOfBirth}, EXCLUDED.date_of_birth)`,
              source: sql`COALESCE(${contactWithSync.source}, EXCLUDED.source)`,
              tags: sql`COALESCE(${contactWithSync.tags}, EXCLUDED.tags)`,
              ghlCustomFields: sql`COALESCE(${contactWithSync.ghlCustomFields}, EXCLUDED.ghl_custom_fields)`,
              lastGhlSyncAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning({ id: contactWithSync.id });

        // Mirror tags into normalized model. Best-effort — log + continue.
        if (row?.id && Array.isArray(contact.tags) && contact.tags.length > 0) {
          try {
            await syncContactTagsToNormalized(row.id, job.locationId, contact.tags);
          } catch (tagErr) {
            console.error(
              "[ghl-backfill] tag normalization failed (non-fatal):",
              tagErr instanceof Error ? tagErr.message : String(tagErr),
            );
          }
        }
        upserted++;
      } catch (err) {
        failed++;
        console.error(
          `[ghl-backfill] contact upsert failed (job=${job.id}, ghlId=${contact.id}):`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const newCursor = encodeCursor(page.nextStartAfter, page.nextStartAfterId);
    const done = !page.hasMore;

    await db
      .update(ghlBackfillJobs)
      .set({
        status: done ? "completed" : "queued",
        cursor: done ? null : newCursor,
        page: job.page + 1,
        processedCount: job.processedCount + page.contacts.length,
        upsertedCount: job.upsertedCount + upserted,
        failedCount: job.failedCount + failed,
        totalEstimate: page.total ?? job.totalEstimate,
        nextRunAt: done
          ? new Date()
          : new Date(Date.now() + REQUEUE_SECONDS_OK * 1000),
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: done ? new Date() : null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(ghlBackfillJobs.id, job.id));

    return {
      status: done ? "completed" : "chunk_done",
      jobId: job.id,
      processed: page.contacts.length,
      upserted,
      hasMore: page.hasMore,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nextAttempt = job.attemptCount; // already incremented by claimNextJob
    const backoff = backoffSeconds(nextAttempt);
    const giveUp = nextAttempt >= 8; // ~10min backoff cap × 8 attempts

    await db
      .update(ghlBackfillJobs)
      .set({
        status: giveUp ? "failed" : "queued",
        lastError: message.slice(0, 2000),
        nextRunAt: new Date(Date.now() + backoff * 1000),
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: giveUp ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(ghlBackfillJobs.id, job.id));

    console.error(
      `[ghl-backfill] chunk failed for job ${job.id} (attempt ${nextAttempt}, ${giveUp ? "GIVING UP" : `backoff ${backoff}s`}): ${message}`,
    );

    return { status: "failed", jobId: job.id, error: message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor encoding. GHL paginates by (startAfter timestamp, startAfterId).
// We squash both into a single TEXT column so the job row stays simple.
// Format: "<startAfter>|<startAfterId>". Either side can be empty.
// ─────────────────────────────────────────────────────────────────────────────
function encodeCursor(
  startAfter: number | null,
  startAfterId: string | null,
): string | null {
  if (startAfter == null && !startAfterId) return null;
  return `${startAfter ?? ""}|${startAfterId ?? ""}`;
}
function parseCursorTimestamp(cursor: string | null): number | null {
  if (!cursor) return null;
  const [ts] = cursor.split("|");
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function parseCursorId(cursor: string | null): string | null {
  if (!cursor) return null;
  const parts = cursor.split("|");
  return parts[1] && parts[1].length > 0 ? parts[1] : null;
}

/**
 * Get a summary of backfill progress for one or all locations. Used by the
 * connections page UI.
 */
export async function getBackfillStatus(
  locationId?: string,
): Promise<GhlBackfillJob[]> {
  const query = db
    .select()
    .from(ghlBackfillJobs)
    .orderBy(sql`created_at DESC`);

  if (locationId) {
    return await query.where(eq(ghlBackfillJobs.locationId, locationId)).limit(20);
  }
  return await query.limit(50);
}

// Re-export type for convenience.
export type { GhlBackfillJob };

// Mark unused imports as intentional so the linter doesn't complain.
void or;
void lte;
void isNull;
