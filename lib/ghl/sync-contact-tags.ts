/**
 * Synchronise an array of tag names onto a contact in the NORMALIZED
 * `tag` + `contact_tags` tables.
 *
 * The webhook handlers store tags in two places:
 *   1. contact.tags JSONB column — fast, denormalized cache (already done
 *      by mapGhlContactToDonor / handleContactTagUpdate).
 *   2. The normalized model — `tag` (find-or-create per name + locationId)
 *      and `contact_tags` (link). The Financial Module + Manage Tags page
 *      both read from this model, so without it the GHL-sync'd tags would
 *      be invisible in the UI.
 *
 * This helper does (2). It's called by:
 *   - handleContactTagUpdate (when GHL fires the dedicated tag event)
 *   - upsertContactFromWebhook (when the contact payload includes tags
 *     alongside other fields, e.g. ContactCreate / ContactUpdate)
 *
 * Semantics:
 *   - The incoming tag array is the AUTHORITATIVE set. Any contact_tags
 *     for this contact whose tag name is NOT in the new array gets removed.
 *   - Tag matching is case-insensitive within the location's scope.
 *   - If no tag with that name exists for this location, we create one.
 *   - Re-running with the same input is a no-op (idempotent).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tag, contactTags } from "@/lib/db/schema";

export async function syncContactTagsToNormalized(
  contactId: number,
  locationId: string,
  tagNames: string[],
): Promise<void> {
  // Normalize: trim, drop empties, dedupe case-insensitively.
  const cleaned = Array.from(
    new Map(
      tagNames
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .map((t) => [t.toLowerCase(), t]),
    ).values(),
  );

  if (cleaned.length === 0) {
    // No tags incoming — wipe the contact's normalized tags entirely.
    await db.delete(contactTags).where(eq(contactTags.contactId, contactId));
    return;
  }

  // For each incoming name, find an existing tag for this location
  // (case-insensitive) OR create one. Returns the list of tag ids that
  // should be linked to this contact.
  const tagIds: number[] = [];
  for (const name of cleaned) {
    // Case-insensitive lookup, scoped to this location.
    const matches = await db
      .select({ id: tag.id })
      .from(tag)
      .where(
        and(
          sql`LOWER(${tag.name}) = ${name.toLowerCase()}`,
          eq(tag.locationId, locationId),
        ),
      )
      .limit(1);

    if (matches.length > 0) {
      tagIds.push(matches[0].id);
      continue;
    }

    // No existing tag — create one.
    const [inserted] = await db
      .insert(tag)
      .values({
        name,
        locationId,
        isActive: true,
      })
      .returning({ id: tag.id });
    if (inserted) tagIds.push(inserted.id);
  }

  // Replace the contact's tag links. We do this in two steps:
  //   1. Delete contact_tags rows whose tag is NOT in the new set
  //   2. Insert links for each new tag (onConflictDoNothing handles repeats)
  if (tagIds.length === 0) {
    await db.delete(contactTags).where(eq(contactTags.contactId, contactId));
    return;
  }

  // Step 1 — delete rows for tags that aren't in the new set.
  await db
    .delete(contactTags)
    .where(
      and(
        eq(contactTags.contactId, contactId),
        sql`${contactTags.tagId} NOT IN (${sql.join(
          tagIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );

  // Step 2 — insert links for the new set (skip duplicates via unique index).
  for (const tagId of tagIds) {
    await db
      .insert(contactTags)
      .values({ contactId, tagId })
      .onConflictDoNothing({
        target: [contactTags.contactId, contactTags.tagId],
      });
  }
}
