/**
 * Pull payments (transactions / invoices / orders / subscriptions) from
 * GHL into DonorHQ's `manual_donation` table.
 *
 * Architecture mirrors the contact backfill:
 *   - Jobs live in ghl_backfill_jobs with new kinds (`payments_transactions`,
 *     `payments_invoices`, `payments_orders`, `payments_subscriptions`).
 *   - The same cron + lease + backoff machinery runs them.
 *   - Each chunk fetches one GHL page, maps records to manual_donation
 *     rows, runs INSERT ... ON CONFLICT DO UPDATE keyed on the partial
 *     UNIQUE index (location_id, ghl_resource_id).
 *   - If a payment references a GHL contact we don't have yet, we fetch
 *     it from GHL's /contacts/{id} endpoint and upsert via the same
 *     contact-webhook handler — keeps inbound contact + payment paths
 *     using one mapping.
 */
import { sql, eq, and, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { manualDonation } from "@/lib/db/schema";
import {
  contactWithSync,
  ghlBackfillJobs,
  type GhlBackfillJob,
} from "@/lib/db/schema-webhook";
import {
  listTransactionsFromGhl,
  listInvoicesFromGhl,
  listOrdersFromGhl,
  listSubscriptionsFromGhl,
  fetchContactFromGhl,
  type GhlPaymentRecord,
  type GhlPaymentListPage,
} from "./api-client";
import { upsertContactFromWebhook } from "./webhook-handlers/contact-upsert";

export const PAYMENT_JOB_KINDS = [
  "payments_transactions",
  "payments_invoices",
  "payments_orders",
  "payments_subscriptions",
] as const;
export type PaymentJobKind = (typeof PAYMENT_JOB_KINDS)[number];

/** Maps a job kind → its ghl_source discriminator on the manual_donation row. */
const KIND_TO_SOURCE: Record<PaymentJobKind, string> = {
  payments_transactions: "ghl_transaction",
  payments_invoices: "ghl_invoice",
  payments_orders: "ghl_order",
  payments_subscriptions: "ghl_subscription",
};

const DEFAULT_PAGE_SIZE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Enqueue
// ─────────────────────────────────────────────────────────────────────────────

export interface EnqueuePaymentsOpts {
  resourceId: string;
  locationId: string;
  companyId?: string | null;
  triggeredBy?: "install" | "manual" | "cron";
  pageSize?: number;
  /** Which kinds to enqueue. Defaults to all four. */
  kinds?: PaymentJobKind[];
  /**
   * Optional cutoff. When set, the worker skips any GHL payment whose
   * paidAt is BEFORE this date. Regular admins get this = install date
   * (set by the trigger route) so historical GHL data does not duplicate
   * pre-existing DHQ rows. Super-admins can omit for full history.
   */
  sinceDate?: Date | null;
}

export interface EnqueuePaymentsResult {
  jobs: GhlBackfillJob[];
  created: PaymentJobKind[];
  skipped: PaymentJobKind[];
}

/**
 * Enqueue ALL payment backfill jobs for a location. Idempotent per kind —
 * if an active job for (resource_id, kind) already exists we skip it and
 * return the existing row instead.
 */
export async function enqueuePaymentsBackfill(
  opts: EnqueuePaymentsOpts,
): Promise<EnqueuePaymentsResult> {
  const {
    resourceId,
    locationId,
    companyId,
    triggeredBy,
    pageSize,
    kinds = [...PAYMENT_JOB_KINDS],
    sinceDate,
  } = opts;
  if (!resourceId || !locationId) {
    throw new Error("enqueuePaymentsBackfill: resourceId and locationId required");
  }

  const out: EnqueuePaymentsResult = {
    jobs: [],
    created: [],
    skipped: [],
  };

  for (const kind of kinds) {
    // Check for an existing active job for this (resource_id, kind).
    const [existing] = await db
      .select()
      .from(ghlBackfillJobs)
      .where(
        and(
          eq(ghlBackfillJobs.resourceId, resourceId),
          eq(ghlBackfillJobs.kind, kind),
          inArray(ghlBackfillJobs.status, ["queued", "running"]),
        ),
      )
      .limit(1);

    if (existing) {
      out.jobs.push(existing);
      out.skipped.push(kind);
      continue;
    }

    try {
      const [inserted] = await db
        .insert(ghlBackfillJobs)
        .values({
          resourceId,
          resourceType: "Location",
          locationId,
          companyId: companyId ?? null,
          kind,
          status: "queued",
          pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
          triggeredBy: triggeredBy ?? "manual",
          sinceDate: sinceDate ?? null,
        })
        .returning();
      out.jobs.push(inserted);
      out.created.push(kind);
    } catch (err) {
      // Lost race against the partial unique — re-read.
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
              eq(ghlBackfillJobs.kind, kind),
              inArray(ghlBackfillJobs.status, ["queued", "running"]),
            ),
          )
          .limit(1);
        if (winner) {
          out.jobs.push(winner);
          out.skipped.push(kind);
          continue;
        }
      }
      throw err;
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunk processor — called by processNextChunk in lib/ghl/backfill.ts when
// the job's kind is one of the payment kinds.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessPaymentChunkResult {
  status: "chunk_done" | "completed" | "failed";
  jobId: string;
  processed: number;
  upserted: number;
  hasMore: boolean;
  error?: string;
}

/**
 * Process one chunk of one payment job. Caller (processNextChunk) has
 * already claimed the lease and bumped attempt_count. We're responsible
 * for fetching one page, upserting, and either rescheduling or marking
 * completed.
 *
 * On error the caller's catch path handles backoff + retry — we just
 * throw and let it deal.
 */
export async function processPaymentChunk(
  job: GhlBackfillJob,
  backoffSeconds: (attempt: number) => number,
): Promise<ProcessPaymentChunkResult> {
  if (!job.locationId) {
    throw new Error(`payment job ${job.id} has no location_id`);
  }
  const kind = job.kind as PaymentJobKind;
  if (!PAYMENT_JOB_KINDS.includes(kind)) {
    throw new Error(`payment job ${job.id} has non-payment kind: ${kind}`);
  }
  const ghlSource = KIND_TO_SOURCE[kind];

  // Fetch one page from the right endpoint.
  let page: GhlPaymentListPage;
  try {
    page = await fetchPageByKind(kind, job.locationId, {
      companyId: job.companyId ?? undefined,
      limit: job.pageSize,
      cursor: job.cursor,
    });
  } catch (err) {
    return await rescheduleOnError(job, err, backoffSeconds);
  }

  let upserted = 0;
  let failed = 0;
  let skippedByDate = 0;
  const sinceMs = job.sinceDate ? new Date(job.sinceDate).getTime() : null;

  for (const record of page.records) {
    // Cutoff filter: skip records paid before job.sinceDate. Applied when
    // the job was enqueued with a cutoff (regular admin path). Super-admin
    // full-history jobs have sinceDate=null and every record passes.
    if (sinceMs !== null) {
      const paidTs = record.paidAt ? new Date(record.paidAt).getTime() : null;
      if (paidTs !== null && paidTs < sinceMs) {
        skippedByDate++;
        continue;
      }
    }
    try {
      const upsertResult = await upsertOnePayment(
        record,
        job.locationId,
        ghlSource,
        job.companyId ?? null,
      );
      if (upsertResult.didWrite) upserted++;
    } catch (err) {
      failed++;
      console.error(
        `[ghl-payments] upsert failed (job=${job.id}, ghlId=${record.id}, kind=${kind}):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  if (skippedByDate > 0) {
    console.log(
      `[ghl-payments] job=${job.id} kind=${kind} — skipped ${skippedByDate} record(s) before sinceDate=${job.sinceDate?.toISOString?.() ?? job.sinceDate}`,
    );
  }

  const done = !page.nextCursor;
  await db
    .update(ghlBackfillJobs)
    .set({
      status: done ? "completed" : "queued",
      cursor: done ? null : page.nextCursor,
      page: job.page + 1,
      processedCount: job.processedCount + page.records.length,
      upsertedCount: job.upsertedCount + upserted,
      failedCount: job.failedCount + failed,
      totalEstimate: page.total ?? job.totalEstimate,
      nextRunAt: done ? new Date() : new Date(Date.now() + 2 * 1000),
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
    processed: page.records.length,
    upserted,
    hasMore: Boolean(page.nextCursor),
  };
}

async function rescheduleOnError(
  job: GhlBackfillJob,
  err: unknown,
  backoffSeconds: (attempt: number) => number,
): Promise<ProcessPaymentChunkResult> {
  const message = err instanceof Error ? err.message : String(err);
  const nextAttempt = job.attemptCount;
  const backoff = backoffSeconds(nextAttempt);
  const giveUp = nextAttempt >= 8;

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
    `[ghl-payments] chunk failed for job ${job.id} (attempt ${nextAttempt}, ${giveUp ? "GIVING UP" : `backoff ${backoff}s`}): ${message}`,
  );
  return {
    status: "failed",
    jobId: job.id,
    processed: 0,
    upserted: 0,
    hasMore: false,
    error: message,
  };
}

function fetchPageByKind(
  kind: PaymentJobKind,
  locationId: string,
  opts: { companyId?: string; limit?: number; cursor?: string | null },
): Promise<GhlPaymentListPage> {
  switch (kind) {
    case "payments_transactions":
      return listTransactionsFromGhl(locationId, opts);
    case "payments_invoices":
      return listInvoicesFromGhl(locationId, opts);
    case "payments_orders":
      return listOrdersFromGhl(locationId, opts);
    case "payments_subscriptions":
      return listSubscriptionsFromGhl(locationId, opts);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One-payment upsert. Resolves the DonorHQ contact (auto-creates from GHL
// if missing), then ON CONFLICT inserts into manual_donation.
// ─────────────────────────────────────────────────────────────────────────────

interface UpsertResult {
  didWrite: boolean;
}

async function upsertOnePayment(
  record: GhlPaymentRecord,
  locationId: string,
  ghlSource: string,
  companyId: string | null,
): Promise<UpsertResult> {
  if (!record.id) {
    // No source id → can't dedup, skip.
    return { didWrite: false };
  }
  if (!record.contactId) {
    // Payment with no contact → there's nothing to attach to.
    // We deliberately don't create a placeholder — better to log + skip
    // than pollute the DB with orphan donations the admin can't reconcile.
    console.warn(
      `[ghl-payments] skipping ${ghlSource} ${record.id} — no contactId on payload`,
    );
    return { didWrite: false };
  }

  // 1. Resolve the DonorHQ contact (or create from GHL).
  const contactId = await resolveContactId(
    record.contactId,
    locationId,
    companyId ?? undefined,
  );
  if (!contactId) {
    console.warn(
      `[ghl-payments] could not resolve DonorHQ contact for ghlId=${record.contactId} (${ghlSource} ${record.id}) — skipping`,
    );
    return { didWrite: false };
  }

  // 2. Normalize the donation fields.
  const currency = normalizeCurrency(record.currency);
  const amount = record.amount != null ? record.amount.toFixed(2) : "0.00";
  const paymentDate = pickDate(record.paidAt);
  const status = normalizeStatus(record.status);

  // 3. Build insert values. Map our enum + text fields. The dedup key is
  // (location_id, ghl_resource_id).
  const insertValues = {
    contactId,
    amount,
    currency,
    amountUsd: currency === "USD" ? amount : null,
    paymentDate,
    paymentMethod: record.paymentMethod ?? null,
    methodDetail: record.description ?? null,
    paymentStatus: status,
    referenceNumber: record.referenceNumber ?? null,
    notes: record.description ?? null,
    ghlSource,
    ghlResourceId: record.id,
    ghlPaymentMethod: record.paymentMethod ?? null,
    locationId,
  } as typeof manualDonation.$inferInsert;

  // 4. INSERT ... ON CONFLICT DO UPDATE keyed on the partial unique
  // index. Re-runs refresh fields without creating duplicates.
  await db
    .insert(manualDonation)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [manualDonation.locationId, manualDonation.ghlResourceId],
      targetWhere: sql`location_id IS NOT NULL AND ghl_resource_id IS NOT NULL`,
      set: {
        amount,
        currency,
        amountUsd: currency === "USD" ? amount : null,
        paymentDate,
        paymentMethod: record.paymentMethod ?? null,
        paymentStatus: status,
        referenceNumber: record.referenceNumber ?? null,
        notes: record.description ?? null,
        ghlPaymentMethod: record.paymentMethod ?? null,
        updatedAt: new Date(),
      },
    });

  return { didWrite: true };
}

/**
 * Look up the DonorHQ contact row id for a GHL contact id. If not found,
 * fetch the contact from GHL's API and upsert through the same path the
 * webhook handler uses. Returns the local contact.id or null on total
 * failure.
 */
async function resolveContactId(
  ghlContactId: string,
  locationId: string,
  companyId: string | undefined,
): Promise<number | null> {
  const [existing] = await db
    .select({ id: contactWithSync.id })
    .from(contactWithSync)
    .where(
      and(
        eq(contactWithSync.ghlContactId, ghlContactId),
        eq(contactWithSync.locationId, locationId),
      ),
    )
    .limit(1);

  if (existing) return existing.id;

  // Not in DonorHQ yet — pull from GHL.
  let full;
  try {
    full = await fetchContactFromGhl(locationId, ghlContactId, { companyId });
  } catch (err) {
    console.error(
      `[ghl-payments] fetchContactFromGhl threw for ${ghlContactId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
  if (!full) return null;

  // Reuse the webhook upsert path so the row gets the same enrichment,
  // tags, suppression record, etc. that an inbound webhook would produce.
  // We synthesize a minimal payload shape the handler accepts.
  try {
    const { contactId } = await upsertContactFromWebhook(
      {
        id: full.id,
        contactId: full.id,
        firstName: full.firstName ?? null,
        lastName: full.lastName ?? null,
        email: full.email ?? null,
        phone: full.phone ?? null,
        address1: full.address1 ?? null,
        city: full.city ?? null,
        state: full.state ?? null,
        postalCode: full.postalCode ?? null,
        country: full.country ?? null,
        companyName: full.companyName ?? null,
        dateOfBirth: full.dateOfBirth ?? null,
        source: full.source ?? null,
        tags: full.tags,
        dnd: full.dnd,
        customFields: full.customFields,
      } as Parameters<typeof upsertContactFromWebhook>[0],
      locationId,
    );
    return contactId;
  } catch (err) {
    console.error(
      `[ghl-payments] contact upsert from GHL failed for ${ghlContactId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

type CurrencyEnumValue =
  | "USD"
  | "ILS"
  | "EUR"
  | "JPY"
  | "GBP"
  | "AUD"
  | "CAD"
  | "ZAR";

const ALLOWED_CURRENCIES: ReadonlySet<CurrencyEnumValue> = new Set<CurrencyEnumValue>([
  "USD",
  "ILS",
  "EUR",
  "JPY",
  "GBP",
  "AUD",
  "CAD",
  "ZAR",
]);

function normalizeCurrency(c: string | null): CurrencyEnumValue {
  if (!c) return "USD";
  const upper = c.toUpperCase() as CurrencyEnumValue;
  return ALLOWED_CURRENCIES.has(upper) ? upper : "USD";
}

type PaymentStatusEnumValue =
  | "pending"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded"
  | "processing"
  | "expected";

function normalizeStatus(s: string | null): PaymentStatusEnumValue {
  if (!s) return "completed";
  const lower = s.toLowerCase();
  if (
    lower === "succeeded" ||
    lower === "success" ||
    lower === "paid" ||
    lower === "completed" ||
    lower === "active"
  )
    return "completed";
  if (lower === "pending") return "pending";
  if (lower === "processing") return "processing";
  if (lower === "failed" || lower === "declined") return "failed";
  if (lower === "cancelled" || lower === "canceled" || lower === "expired")
    return "cancelled";
  if (lower === "refunded") return "refunded";
  return "completed";
}

function pickDate(s: string | null): string {
  if (!s) return new Date().toISOString().slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}
