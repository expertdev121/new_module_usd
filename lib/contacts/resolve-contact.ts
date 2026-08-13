/**
 * resolveContact — the ONE way to find-or-create a contact.
 *
 * Identity model (agreed 2026-08-14):
 *   - location_id is MANDATORY. Every lookup is tenant-scoped. Never
 *     match across locations.
 *   - Cascade, in strict order:
 *       0. location_id + ghl_contact_id       (when the caller has one)
 *       1. location_id + email
 *       2. location_id + phone  — ONLY when the incoming record has no
 *          email. If the incoming record HAS an email that didn't match,
 *          a phone hit is NOT a match ("same office phone, different
 *          person" rule) — we fall through.
 *       3. location_id + constituents_id      (external CRM id)
 *       4. No hit → INSERT a new contact.
 *   - Name / display_name are NEVER match keys (they caused
 *     cross-person merges in the old webhook handler).
 *
 * All matches ignore soft-deleted rows (deleted_at IS NULL).
 * On a match, the caller decides what to update; we optionally backfill
 * identifiers the matched row is missing (ghl id, constituents id,
 * email, phone) so the record converges instead of staying half-linked.
 */
import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contact } from "@/lib/db/schema";

export interface ResolveInput {
  locationId: string;
  email?: string | null;
  phone?: string | null;
  constituentsId?: string | null;
  ghlContactId?: string | null;
  /** Used only when we INSERT (never for matching). */
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  address?: string | null;
}

export interface ResolveOptions {
  /** When false, resolve() returns null instead of inserting. Default true. */
  createIfMissing?: boolean;
  /**
   * When true (default), a match gets its missing identifiers backfilled
   * (ghl_contact_id / constituents_id / email / phone that the row lacks
   * but the input has). Existing non-null values are never overwritten.
   */
  backfillIdentifiers?: boolean;
}

export type ResolveMatchType =
  | "ghl_contact_id"
  | "email"
  | "phone"
  | "constituents_id"
  | "created"
  | "not_found";

export interface ResolveResult {
  contactId: number | null;
  matchedBy: ResolveMatchType;
}

const normEmail = (s?: string | null) => (s ?? "").trim().toLowerCase() || null;
const normPhone = (s?: string | null) => {
  const digits = (s ?? "").replace(/\D+/g, "");
  return digits.length >= 7 ? digits : null;
};

type ContactHit = { id: number; email: string | null; phone: string | null; ghlContactId: string | null; constituentsId: string | null };

const hitCols = {
  id: contact.id,
  email: contact.email,
  phone: contact.phone,
  ghlContactId: contact.ghlContactId,
  constituentsId: contact.constituentsId,
};

const notDeleted = dsql`"contact"."deleted_at" IS NULL`;

export async function resolveContact(
  input: ResolveInput,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const { locationId } = input;
  if (!locationId) {
    throw new Error("resolveContact: locationId is mandatory");
  }
  const createIfMissing = opts.createIfMissing !== false;
  const backfill = opts.backfillIdentifiers !== false;

  const email = normEmail(input.email);
  const phone = normPhone(input.phone);
  const constituentsId = (input.constituentsId ?? "").trim() || null;
  const ghlContactId = (input.ghlContactId ?? "").trim() || null;

  let hit: ContactHit | null = null;
  let matchedBy: ResolveMatchType = "not_found";

  // 0. ghl_contact_id — tenant-scoped, unlike the old handler.
  if (ghlContactId) {
    const rows = await db.select(hitCols).from(contact)
      .where(and(eq(contact.ghlContactId, ghlContactId), eq(contact.locationId, locationId), notDeleted))
      .limit(1);
    if (rows[0]) { hit = rows[0]; matchedBy = "ghl_contact_id"; }
  }

  // 1. email
  if (!hit && email) {
    const rows = await db.select(hitCols).from(contact)
      .where(and(dsql`LOWER("contact"."email") = ${email}`, eq(contact.locationId, locationId), notDeleted))
      .limit(1);
    if (rows[0]) { hit = rows[0]; matchedBy = "email"; }
  }

  // 2. phone — only when the incoming record has NO email. A record with
  //    a (non-matching) email that shares a phone is a DIFFERENT person
  //    at the same number (office/household line).
  if (!hit && !email && phone) {
    const rows = await db.select(hitCols).from(contact)
      .where(and(
        dsql`REGEXP_REPLACE(COALESCE("contact"."phone", ''), '[^0-9]', '', 'g') = ${phone}`,
        eq(contact.locationId, locationId),
        notDeleted,
      ))
      .limit(1);
    if (rows[0]) { hit = rows[0]; matchedBy = "phone"; }
  }

  // 3. constituents_id
  if (!hit && constituentsId) {
    const rows = await db.select(hitCols).from(contact)
      .where(and(eq(contact.constituentsId, constituentsId), eq(contact.locationId, locationId), notDeleted))
      .limit(1);
    if (rows[0]) { hit = rows[0]; matchedBy = "constituents_id"; }
  }

  if (hit) {
    if (backfill) {
      const patch: Record<string, unknown> = {};
      if (ghlContactId && !hit.ghlContactId) patch.ghlContactId = ghlContactId;
      if (constituentsId && !hit.constituentsId) patch.constituentsId = constituentsId;
      if (email && !hit.email) patch.email = input.email?.trim();
      if (phone && !hit.phone) patch.phone = input.phone?.trim();
      if (Object.keys(patch).length) {
        patch.updatedAt = new Date();
        try {
          await db.update(contact).set(patch).where(eq(contact.id, hit.id));
        } catch {
          // Unique-index race (e.g. ghl id claimed concurrently) — the
          // match itself is still valid, so swallow and continue.
        }
      }
    }
    return { contactId: hit.id, matchedBy };
  }

  if (!createIfMissing) return { contactId: null, matchedBy: "not_found" };

  const [created] = await db.insert(contact).values({
    locationId,
    firstName: (input.firstName ?? "").trim() || "Unknown",
    lastName: (input.lastName ?? "").trim() || "Contact",
    displayName: input.displayName?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    ghlContactId: ghlContactId,
    constituentsId: constituentsId,
  }).returning({ id: contact.id });

  return { contactId: created.id, matchedBy: "created" };
}
