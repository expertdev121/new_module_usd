/**
 * Loop prevention for the two-way sync.
 *
 * When DonorHQ pushes a contact change to GHL, GHL fires a webhook back
 * to us within ~1–5 seconds. Without protection, that webhook would
 * re-apply the same change to DonorHQ (no real damage but wasted writes)
 * AND, if GHL slightly normalized something, would silently "win" over
 * the user's typed value.
 *
 * Strategy: before every outbound write, record a row in `ghl_sync_writes`
 * with TTL = WRITE_SUPPRESSION_SECONDS. The webhook handler checks this
 * table first; if a matching unexpired row exists, skip processing.
 *
 * The `ghl_sync_writes` table already exists (migration 0018) — we're just
 * giving it a clear write-side + read-side API.
 */
import { sql, eq, and, gt, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { ghlSyncWrites } from "@/lib/db/schema-webhook";

const WRITE_SUPPRESSION_SECONDS = 30;

/**
 * Record an outbound write so incoming webhooks for this contact (within
 * the suppression window) get skipped. Safe to call even if you're not
 * sure the write will succeed — at worst we suppress one inbound webhook
 * that we'd have processed identically anyway.
 */
export async function recordOutboundWrite(
  locationId: string,
  ghlContactId: string,
): Promise<void> {
  if (!locationId || !ghlContactId) return;
  const expiresAt = new Date(Date.now() + WRITE_SUPPRESSION_SECONDS * 1000);
  await db.insert(ghlSyncWrites).values({
    locationId,
    ghlContactId,
    expiresAt,
  });
}

/**
 * Returns TRUE if there's an unexpired outbound-write record for this
 * (location, contact) pair — meaning the incoming webhook is just GHL
 * echoing our own write back to us.
 */
export async function isOutboundWriteSuppressed(
  locationId: string,
  ghlContactId: string,
): Promise<boolean> {
  if (!locationId || !ghlContactId) return false;
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
 * Garbage-collect expired suppression rows. Best-effort; called opportunistically
 * from the cron worker so we don't accumulate forever. Safe to call any time.
 */
export async function cleanupExpiredSuppression(): Promise<number> {
  const result = await db
    .delete(ghlSyncWrites)
    .where(lte(ghlSyncWrites.expiresAt, new Date()))
    .returning({ id: ghlSyncWrites.id });
  return result.length;
}

// Mark intentional unused import — kept for parity with other modules.
void sql;
