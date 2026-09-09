/**
 * One-off: import the 113 GHL contacts that have no DonorHQ counterpart
 * at all (per Nikhil's decision on the YLA contact-parity ticket).
 *
 * Reuses the exact same insert path as lib/ghl/backfill.ts (buildContactValues
 * shape + ON CONFLICT on the (ghl_contact_id, location_id) partial unique
 * index + syncContactTagsToNormalized) so these rows are indistinguishable
 * from ones created by the real backfill worker.
 *
 * Run with: npx tsx .tmp-yla/import-ghl-only-contacts.ts
 */
import fs from "fs";
import { db } from "@/lib/db";
import { contactWithSync, type NewContactWithSync } from "@/lib/db/schema-webhook";
import { sql } from "drizzle-orm";
import { fetchContactFromGhl, type GhlContactFull } from "@/lib/ghl/api-client";
import { syncContactTagsToNormalized } from "@/lib/ghl/sync-contact-tags";

const LOC = "THqkrbnBD2Eim1tdklWp";

function buildContactValues(contact: GhlContactFull, locationId: string): NewContactWithSync {
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

async function main() {
  const ids: string[] = JSON.parse(fs.readFileSync(".tmp-yla/ghl-import-ids.json", "utf8"));
  console.log(`Importing ${ids.length} GHL-only contacts into DonorHQ...`);

  let created = 0;
  let failed = 0;
  const results: { ghlId: string; status: string; contactId?: number; error?: string }[] = [];

  for (const ghlId of ids) {
    try {
      const contact = await fetchContactFromGhl(LOC, ghlId);
      if (!contact) throw new Error("fetchContactFromGhl returned null");

      const values = buildContactValues(contact, LOC);
      const [row] = await db
        .insert(contactWithSync)
        .values(values)
        .onConflictDoUpdate({
          target: [contactWithSync.ghlContactId, contactWithSync.locationId],
          targetWhere: sql`is_legacy_duplicate = FALSE AND ghl_contact_id IS NOT NULL AND location_id IS NOT NULL`,
          set: {
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

      if (row?.id && Array.isArray(contact.tags) && contact.tags.length > 0) {
        await syncContactTagsToNormalized(row.id, LOC, contact.tags);
      }

      created++;
      results.push({ ghlId, status: "created", contactId: row?.id });
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      results.push({ ghlId, status: "error", error: message });
      console.error(`  FAILED ${ghlId}: ${message}`);
    }
  }

  console.log(`\nDone. ${created} created/updated, ${failed} failed, ${ids.length} total.`);
  fs.writeFileSync(".tmp-yla/import-ghl-only-report.json", JSON.stringify(results, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
