// scripts/cmn-sync.ts — LIVE WRITE. Approved by user 2026-09-22 after backup
// (.tmp-cmn/backup-2026-09-18T13-24-04-536Z/) and Nikhil's sign-off.
//
// Executes the CMN sync:
//   1. Contacts + tags via the standard production backfill job queue
//      (safe: upserts only fill empty fields, tag sync is idempotent).
//   2. Immediately cancels the auto-queued payments_* backfill job that
//      step 1 triggers — the standard payments backfill has NO cross-source
//      dedup guard (unlike the live webhook path) and would recreate the
//      42 duplicate-payment clusters found in the dry run.
//   3. Inserts only the deduped missing payments directly, using the same
//      "first-source-wins" rule already validated in scripts/cmn-dryrun.ts.

import { config } from "dotenv";
config();
import { db } from "../lib/db";
import { contact, tag, contactTags, manualDonation } from "../lib/db/schema";
import { contactWithSync, ghlBackfillJobs } from "../lib/db/schema-webhook";
import { ghlOauthTokens } from "../lib/db/schema-oauth";
import { eq, and, inArray, sql } from "drizzle-orm";
import { enqueueContactBackfill, processNextChunk } from "../lib/ghl/backfill";
import {
  listTransactionsFromGhl,
  listSubscriptionsFromGhl,
  listInvoicesFromGhl,
  listOrdersFromGhl,
  fetchContactFromGhl,
  type GhlPaymentRecord,
  type GhlPaymentListPage,
} from "../lib/ghl/api-client";
import { upsertContactFromWebhook } from "../lib/ghl/webhook-handlers/contact-upsert";

const LOCATION_ID = "4Nzcp3vUgVbOoN9uxu5F";
const PAYMENT_KINDS = [
  "payments_transactions",
  "payments_invoices",
  "payments_orders",
  "payments_subscriptions",
];

type PaymentWithSource = GhlPaymentRecord & { __source: string };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function snapshot() {
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contact)
    .where(eq(contact.locationId, LOCATION_ID));
  const [t] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tag)
    .where(eq(tag.locationId, LOCATION_ID));
  const donations = await db
    .select()
    .from(manualDonation)
    .where(eq(manualDonation.locationId, LOCATION_ID));
  const total = donations.reduce((s, d) => s + Number(d.amount || 0), 0);
  const contacts = await db
    .select({ id: contact.id })
    .from(contact)
    .where(eq(contact.locationId, LOCATION_ID));
  const ids = contacts.map((c) => c.id);
  const ctRows = ids.length
    ? await db.select().from(contactTags).where(inArray(contactTags.contactId, ids))
    : [];
  return {
    contacts: c?.n ?? 0,
    tags: t?.n ?? 0,
    contactTagLinks: ctRows.length,
    payments: donations.length,
    paymentsTotalUsd: Math.round(total * 100) / 100,
  };
}

function dateOnly(s: string | null) {
  if (!s) return "unknown";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toISOString().slice(0, 10);
}
function normalizeCurrency(c: string | null) {
  const allowed = new Set(["USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR"]);
  if (!c) return "USD";
  const u = c.toUpperCase();
  return allowed.has(u) ? u : "USD";
}
function normalizeStatus(s: string | null) {
  if (!s) return "completed";
  const l = s.toLowerCase();
  if (["succeeded", "success", "paid", "completed", "active"].includes(l)) return "completed";
  if (l === "pending") return "pending";
  if (l === "processing") return "processing";
  if (l === "failed" || l === "declined") return "failed";
  if (["cancelled", "canceled", "expired"].includes(l)) return "cancelled";
  if (l === "refunded") return "refunded";
  return "completed";
}
function pickDate(s: string | null) {
  if (!s) return new Date().toISOString().slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

async function fetchAllPayments(
  fn: (locationId: string, opts: { limit?: number; cursor?: string | null }) => Promise<GhlPaymentListPage>,
  source: string,
): Promise<PaymentWithSource[]> {
  let out: PaymentWithSource[] = [];
  let cursor: string | null | undefined = undefined;
  for (;;) {
    const page = await fn(LOCATION_ID, { limit: 100, cursor });
    out = out.concat(page.records.map((r) => ({ ...r, __source: source })));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

async function main() {
  console.log("=== CMN SYNC — LIVE WRITE (approved by user + Nikhil, 2026-09-22) ===\n");
  const before = await snapshot();
  console.log("BEFORE:", before);

  // ---- Step 1: OAuth token lookup ----
  const [token] = await db
    .select()
    .from(ghlOauthTokens)
    .where(and(eq(ghlOauthTokens.locationId, LOCATION_ID), eq(ghlOauthTokens.resourceType, "Location")));
  if (!token) throw new Error("No Location-level OAuth token found for CMN — aborting.");
  const resourceId = token.resourceId;
  const companyId = token.companyId ?? null;

  // ---- Step 2: enqueue + drain contacts backfill (safe path) ----
  console.log("\n--- Step 1: contacts + tags backfill ---");
  const { job: contactsJob, created } = await enqueueContactBackfill({
    resourceId,
    resourceType: "Location",
    locationId: LOCATION_ID,
    companyId,
    triggeredBy: "manual",
  });
  console.log(
    created
      ? `Created contacts job ${contactsJob.id}`
      : `Reusing existing contacts job ${contactsJob.id} (status=${contactsJob.status})`,
  );

  let guard = 0;
  while (guard++ < 3000) {
    const [row] = await db.select().from(ghlBackfillJobs).where(eq(ghlBackfillJobs.id, contactsJob.id));
    if (!row) break;
    if (row.status === "completed" || row.status === "failed") {
      console.log(
        `Contacts job ${row.status}: processed=${row.processedCount} upserted=${row.upsertedCount} failed=${row.failedCount}`,
      );
      break;
    }
    const result = await processNextChunk();
    if (result.status === "no_jobs") {
      await sleep(800);
      continue;
    }
    if (result.jobId === contactsJob.id) {
      console.log(`  chunk: processed=${result.processed} upserted=${result.upserted} hasMore=${result.hasMore}`);
    }
  }

  // ---- Step 3: cancel any auto-queued payments_* jobs for CMN ----
  console.log("\n--- Step 2: cancelling auto-queued payments backfill jobs (avoids dedup bug) ---");
  const autoJobs = await db
    .select()
    .from(ghlBackfillJobs)
    .where(
      and(
        eq(ghlBackfillJobs.locationId, LOCATION_ID),
        inArray(ghlBackfillJobs.kind, PAYMENT_KINDS),
        inArray(ghlBackfillJobs.status, ["queued", "running"]),
      ),
    );
  for (const j of autoJobs) {
    await db
      .update(ghlBackfillJobs)
      .set({
        status: "completed",
        lastError:
          "cancelled by cmn-sync.ts — payments synced manually with cross-source dedup to avoid duplicate-payment bug in standard backfill",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ghlBackfillJobs.id, j.id));
    console.log(`  cancelled ${j.kind} job ${j.id}`);
  }
  if (autoJobs.length === 0) console.log("  none found (no race occurred)");

  // ---- Step 4: fetch fresh GHL payment data ----
  console.log("\n--- Step 3: fetching fresh GHL payment data ---");
  const transactions = await fetchAllPayments(listTransactionsFromGhl, "ghl_transaction");
  const invoices = await fetchAllPayments(listInvoicesFromGhl, "ghl_invoice");
  const orders = await fetchAllPayments(listOrdersFromGhl, "ghl_order");
  const subscriptions = await fetchAllPayments(listSubscriptionsFromGhl, "ghl_subscription");
  const allPayments = [...transactions, ...invoices, ...orders, ...subscriptions];
  console.log(`  total GHL payments fetched: ${allPayments.length}`);

  const existingDonations = await db
    .select({ ghlResourceId: manualDonation.ghlResourceId })
    .from(manualDonation)
    .where(eq(manualDonation.locationId, LOCATION_ID));
  const existingIds = new Set(existingDonations.map((d) => d.ghlResourceId).filter(Boolean) as string[]);

  const missing = allPayments.filter((p) => p.id && !existingIds.has(p.id));
  console.log(`  missing (not yet in DonorHQ): ${missing.length}`);

  // Cross-source dedup: group by contactId + amount(2dp) + date-only.
  const clusters = new Map<string, PaymentWithSource[]>();
  for (const p of missing) {
    const key = `${p.contactId ?? "none"}|${(p.amount ?? 0).toFixed(2)}|${dateOnly(p.paidAt)}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(p);
  }
  const toInsert: PaymentWithSource[] = [];
  const skippedAsDuplicate: PaymentWithSource[] = [];
  for (const [, group] of clusters) {
    const distinctSources = new Set(group.map((g) => g.__source));
    if (distinctSources.size > 1) {
      const sorted = [...group].sort(
        (a, b) => new Date(a.paidAt ?? 0).getTime() - new Date(b.paidAt ?? 0).getTime(),
      );
      toInsert.push(sorted[0]);
      skippedAsDuplicate.push(...sorted.slice(1));
    } else {
      toInsert.push(...group);
    }
  }
  console.log(`  to insert (post cross-source dedup): ${toInsert.length}`);
  console.log(`  skipped as cross-source duplicate: ${skippedAsDuplicate.length}`);

  // ---- Step 5: resolve contacts + insert deduped payments ----
  async function resolveContactId(ghlContactId: string): Promise<number | null> {
    const [existing] = await db
      .select({ id: contactWithSync.id })
      .from(contactWithSync)
      .where(and(eq(contactWithSync.ghlContactId, ghlContactId), eq(contactWithSync.locationId, LOCATION_ID)))
      .limit(1);
    if (existing) return existing.id;

    let full;
    try {
      full = await fetchContactFromGhl(LOCATION_ID, ghlContactId, { companyId: companyId ?? undefined });
    } catch (e) {
      console.error(`  fetchContactFromGhl failed for ${ghlContactId}:`, e instanceof Error ? e.message : e);
      return null;
    }
    if (!full) return null;

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
        LOCATION_ID,
      );
      return contactId;
    } catch (e) {
      console.error(`  upsertContactFromWebhook failed for ${ghlContactId}:`, e instanceof Error ? e.message : e);
      return null;
    }
  }

  console.log("\n--- Step 4: inserting deduped payments ---");
  let inserted = 0;
  let failed = 0;
  let newContactsForPayments = 0;
  for (const p of toInsert) {
    if (!p.id || !p.contactId) {
      failed++;
      continue;
    }
    const [preexisting] = await db
      .select({ id: contactWithSync.id })
      .from(contactWithSync)
      .where(and(eq(contactWithSync.ghlContactId, p.contactId), eq(contactWithSync.locationId, LOCATION_ID)))
      .limit(1);
    const contactId = await resolveContactId(p.contactId);
    if (!contactId) {
      failed++;
      console.warn(`  could not resolve contact for payment ${p.id}`);
      continue;
    }
    if (!preexisting) newContactsForPayments++;

    const currency = normalizeCurrency(p.currency);
    const amount = p.amount != null ? p.amount.toFixed(2) : "0.00";
    const paymentDate = pickDate(p.paidAt);
    const status = normalizeStatus(p.status);
    try {
      await db
        .insert(manualDonation)
        .values({
          contactId,
          amount,
          currency,
          amountUsd: currency === "USD" ? amount : null,
          paymentDate,
          paymentMethod: p.paymentMethod ?? null,
          methodDetail: p.description ?? null,
          paymentStatus: status,
          referenceNumber: p.referenceNumber ?? null,
          notes: p.description ?? null,
          ghlSource: p.__source,
          ghlResourceId: p.id,
          ghlPaymentMethod: p.paymentMethod ?? null,
          locationId: LOCATION_ID,
        } as typeof manualDonation.$inferInsert)
        .onConflictDoUpdate({
          target: [manualDonation.locationId, manualDonation.ghlResourceId],
          targetWhere: sql`location_id IS NOT NULL AND ghl_resource_id IS NOT NULL`,
          set: {
            amount,
            currency,
            amountUsd: currency === "USD" ? amount : null,
            paymentDate,
            paymentMethod: p.paymentMethod ?? null,
            paymentStatus: status,
            referenceNumber: p.referenceNumber ?? null,
            notes: p.description ?? null,
            ghlPaymentMethod: p.paymentMethod ?? null,
            updatedAt: new Date(),
          },
        });
      inserted++;
    } catch (e) {
      failed++;
      console.error(`  insert failed for payment ${p.id}:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`  inserted/updated: ${inserted}, failed: ${failed}, new contacts created just for payments: ${newContactsForPayments}`);

  // ---- Step 6: after snapshot + summary ----
  const after = await snapshot();
  console.log("\n=== SUMMARY ===");
  console.log("BEFORE:", before);
  console.log("AFTER: ", after);
  console.log(`Payments skipped as cross-source duplicates (intentionally left out): ${skippedAsDuplicate.length}`);
  console.log(`Payment insert failures: ${failed}`);
  console.log("\n=== END CMN SYNC ===\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("SYNC FAILED:", err);
    process.exit(1);
  });
