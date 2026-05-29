import 'dotenv/config';
import { db } from '@/lib/db';
import { contact } from '@/lib/db/schema';
import { eq, and, isNull, inArray } from 'drizzle-orm';

const LOCATION_ID = 'THqkrbnBD2Eim1tdklWp';
const UPDATE_CONCURRENCY = 25;
const DRY_RUN = process.argv.includes('--dry-run');

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log(`\nBackfilling displayName for location ${LOCATION_ID}`);
  console.log(`Dry run: ${DRY_RUN}\n`);

  const rows = await db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
    })
    .from(contact)
    .where(and(eq(contact.locationId, LOCATION_ID), isNull(contact.displayName)));

  console.log(`Found ${rows.length} contacts at this location with displayName = null`);

  if (rows.length === 0) {
    console.log('Nothing to do.\n');
    process.exit(0);
  }

  // Group by intended displayName so identical values can update in batches via inArray.
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const name = `${r.firstName.trim()} ${r.lastName.trim()}`.trim();
    if (!name) continue;
    const ids = buckets.get(name) ?? [];
    ids.push(r.id);
    buckets.set(name, ids);
  }

  console.log(`Grouped into ${buckets.size} distinct displayName values\n`);

  let updated = 0;
  const entries = Array.from(buckets.entries());
  const concurrentBatches = chunk(entries, UPDATE_CONCURRENCY);

  for (let i = 0; i < concurrentBatches.length; i++) {
    const batch = concurrentBatches[i];
    if (!DRY_RUN) {
      await Promise.all(
        batch.map(([name, ids]) =>
          db
            .update(contact)
            .set({ displayName: name, updatedAt: new Date() })
            .where(inArray(contact.id, ids))
        )
      );
    }
    updated += batch.reduce((sum, [, ids]) => sum + ids.length, 0);
    console.log(`  Batch ${i + 1}/${concurrentBatches.length}: ${batch.length} distinct names, ${updated}/${rows.length} contacts so far`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Contacts updated: ${updated}`);
  console.log(DRY_RUN ? '\nDRY RUN — no DB writes.\n' : '\nDone.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
