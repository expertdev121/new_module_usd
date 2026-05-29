import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { db } from '@/lib/db';
import { contact, tag, contactTags } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCATION_ID = 'THqkrbnBD2Eim1tdklWp';
const TAG_NAME = 'Annual Year End';
const CSV_PATH = path.resolve(__dirname, '../data/YLA Contacts/Annual Year End.csv');
const INSERT_BATCH = 200;
const UPDATE_CONCURRENCY = 25;
const DRY_RUN = process.argv.includes('--dry-run');

interface Row {
  'First Name': string;
  Last: string;
  Street: string;
  City: string;
  State: string;
  Zip: string;
  tag: string;
  location: string;
}

function normalizeZip(raw: string): string {
  const z = (raw || '').trim();
  if (!z) return '';
  if (z.includes('-')) {
    const [prefix, suffix] = z.split('-');
    return `${prefix.padStart(5, '0')}-${suffix}`;
  }
  return z.padStart(5, '0');
}

function buildAddress(r: Row): string {
  const line = (r.Street || '').trim();
  const city = (r.City || '').trim();
  const state = (r.State || '').trim();
  const zip = normalizeZip(r.Zip);
  const stateZip = [state, zip].filter(Boolean).join(' ');
  const tail = [city, stateZip].filter(Boolean).join(', ');
  return [line, tail].filter(Boolean).join(', ');
}

function nameKey(first: string, last: string): string {
  return `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}`;
}

function parseCSV(): Row[] {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const parsed = Papa.parse<Row>(raw, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  if (parsed.errors.length) {
    console.error('CSV parse errors:', parsed.errors.slice(0, 3));
    throw new Error(parsed.errors[0].message);
  }
  return parsed.data.filter(
    (r) => (r['First Name'] || '').trim() && (r.Last || '').trim()
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getOrCreateTag(): Promise<number> {
  const existing = await db
    .select({ id: tag.id })
    .from(tag)
    .where(and(eq(tag.locationId, LOCATION_ID), eq(tag.name, TAG_NAME)))
    .limit(1);
  if (existing[0]) {
    console.log(`Found existing "${TAG_NAME}" tag (id=${existing[0].id})`);
    return existing[0].id;
  }
  if (DRY_RUN) {
    console.log(`[DRY_RUN] Would create tag "${TAG_NAME}" for location ${LOCATION_ID}`);
    return -1;
  }
  const [created] = await db
    .insert(tag)
    .values({ name: TAG_NAME, locationId: LOCATION_ID })
    .returning({ id: tag.id });
  console.log(`Created tag "${TAG_NAME}" (id=${created.id})`);
  return created.id;
}

async function main() {
  const rows = parseCSV();
  console.log(`\nLoaded ${rows.length} contacts from CSV`);
  console.log(`Location:  ${LOCATION_ID}`);
  console.log(`Tag:       ${TAG_NAME}`);
  console.log(`Dry run:   ${DRY_RUN}\n`);

  const tagId = await getOrCreateTag();

  console.log(`Fetching existing contacts for location...`);
  const existingContacts = await db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
    })
    .from(contact)
    .where(eq(contact.locationId, LOCATION_ID));
  console.log(`Found ${existingContacts.length} existing contacts in this location`);

  const existingByName = new Map<string, number>();
  for (const c of existingContacts) {
    existingByName.set(nameKey(c.firstName, c.lastName), c.id);
  }

  const toUpdate: { id: number; address: string }[] = [];
  const toInsert: {
    firstName: string;
    lastName: string;
    displayName: string;
    address: string;
    locationId: string;
  }[] = [];
  const seenKeys = new Set<string>();

  for (const r of rows) {
    const firstName = r['First Name'].trim();
    const lastName = r.Last.trim();
    const key = nameKey(firstName, lastName);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const address = buildAddress(r);
    const existingId = existingByName.get(key);
    if (existingId) {
      toUpdate.push({ id: existingId, address });
    } else {
      toInsert.push({
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`,
        address,
        locationId: LOCATION_ID,
      });
    }
  }

  console.log(`\nPlanned:`);
  console.log(`  Updates: ${toUpdate.length}`);
  console.log(`  Inserts: ${toInsert.length}\n`);

  if (toUpdate.length > 0) {
    console.log(`Updating addresses...`);
    const updateChunks = chunk(toUpdate, UPDATE_CONCURRENCY);
    for (let i = 0; i < updateChunks.length; i++) {
      const batch = updateChunks[i];
      if (!DRY_RUN) {
        await Promise.all(
          batch.map((u) =>
            db
              .update(contact)
              .set({ address: u.address, updatedAt: new Date() })
              .where(eq(contact.id, u.id))
          )
        );
      }
      console.log(`  Batch ${i + 1}/${updateChunks.length}: ${batch.length} rows`);
    }
  }

  const insertedIds: number[] = [];
  if (toInsert.length > 0) {
    console.log(`\nInserting new contacts...`);
    const insertChunks = chunk(toInsert, INSERT_BATCH);
    for (let i = 0; i < insertChunks.length; i++) {
      const batch = insertChunks[i];
      if (!DRY_RUN) {
        const created = await db
          .insert(contact)
          .values(batch)
          .returning({ id: contact.id });
        insertedIds.push(...created.map((c) => c.id));
      }
      console.log(`  Batch ${i + 1}/${insertChunks.length}: ${batch.length} rows`);
    }
  }

  let tagsLinked = 0;
  if (!DRY_RUN && tagId > 0) {
    const allIds = [...toUpdate.map((u) => u.id), ...insertedIds];
    console.log(`\nLinking "${TAG_NAME}" tag to ${allIds.length} contacts...`);
    const tagChunks = chunk(
      allIds.map((contactId) => ({ contactId, tagId })),
      INSERT_BATCH
    );
    for (let i = 0; i < tagChunks.length; i++) {
      const batch = tagChunks[i];
      const linked = await db
        .insert(contactTags)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: contactTags.id });
      tagsLinked += linked.length;
      console.log(
        `  Batch ${i + 1}/${tagChunks.length}: linked ${linked.length}/${batch.length} (rest already linked)`
      );
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`CSV rows:           ${rows.length}`);
  console.log(`Unique by name:     ${seenKeys.size}`);
  console.log(`Updated existing:   ${toUpdate.length}`);
  console.log(`Inserted new:       ${toInsert.length}`);
  console.log(`New tag links:      ${tagsLinked}`);
  console.log(DRY_RUN ? '\nDRY RUN — no DB writes.\n' : '\nDone.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
