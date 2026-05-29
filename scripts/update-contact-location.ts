import 'dotenv/config';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { db } from '@/lib/db';
import { contact } from '@/lib/db/schema';
import { eq, and, inArray, not } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_LOCATION_ID = 'e1i5fw5avU3c49UGOChV';
const CSV_PATH = path.resolve(__dirname, '../data/update-ghl-id.csv');
const BATCH_SIZE = 200;

function loadContactIds(): string[] {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && line !== 'Contact Id');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  const allIds = loadContactIds();
  console.log(`\nLoaded ${allIds.length} GHL contact IDs from CSV`);

  const allIdSet = new Set(allIds);
  const foundIds = new Set<string>();
  const alreadyCorrectIds: string[] = [];
  let updatedCount = 0;
  let errorCount = 0;

  const batches = chunk(allIds, BATCH_SIZE);
  console.log(`Processing in ${batches.length} batches of up to ${BATCH_SIZE}...\n`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`Batch ${i + 1}/${batches.length}: querying...`);

    try {
      // Find contacts in this batch that need updating (location_id !== target)
      const toUpdate = await db
        .select({ id: contact.id, ghlContactId: contact.ghlContactId })
        .from(contact)
        .where(
          and(
            inArray(contact.ghlContactId, batch),
            not(eq(contact.locationId, TARGET_LOCATION_ID))
          )
        );

      // Find contacts already on the correct location
      const alreadyCorrect = await db
        .select({ ghlContactId: contact.ghlContactId })
        .from(contact)
        .where(
          and(
            inArray(contact.ghlContactId, batch),
            eq(contact.locationId, TARGET_LOCATION_ID)
          )
        );

      for (const r of alreadyCorrect) {
        if (r.ghlContactId) {
          foundIds.add(r.ghlContactId);
          alreadyCorrectIds.push(r.ghlContactId);
        }
      }

      for (const r of toUpdate) {
        if (r.ghlContactId) foundIds.add(r.ghlContactId);
      }

      if (toUpdate.length > 0) {
        const ids = toUpdate.map(r => r.id);
        await db
          .update(contact)
          .set({ locationId: TARGET_LOCATION_ID })
          .where(inArray(contact.id, ids));
        updatedCount += toUpdate.length;
        process.stdout.write(` updated ${toUpdate.length}, skipped ${alreadyCorrect.length}\n`);
      } else {
        process.stdout.write(` nothing to update, skipped ${alreadyCorrect.length}\n`);
      }
    } catch (err) {
      errorCount++;
      process.stdout.write(` ERROR: ${(err as Error).message}\n`);
    }
  }

  const notFoundIds = allIds.filter(id => !foundIds.has(id));

  console.log('\n=== SUMMARY ===');
  console.log(`Total IDs in CSV:        ${allIds.length}`);
  console.log(`Already correct (skip):  ${alreadyCorrectIds.length}`);
  console.log(`Updated:                 ${updatedCount}`);
  console.log(`Not found in DB:         ${notFoundIds.length}`);
  console.log(`Batch errors:            ${errorCount}`);

  if (notFoundIds.length > 0) {
    console.log('\nNot found GHL IDs:');
    notFoundIds.forEach(id => console.log(' ', id));
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
