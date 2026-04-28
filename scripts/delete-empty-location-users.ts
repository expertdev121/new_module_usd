import 'dotenv/config';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

const BATCH_SIZE = 50;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function deleteEmptyLocationUsers() {
  console.log('Fetching users with role=user and empty/null locationId...');

  const targets = await db
    .select({ id: user.id, email: user.email, locationId: user.locationId })
    .from(user)
    .where(eq(user.role, 'user'));

  const toDelete = targets.filter(
    (u) => !u.locationId || u.locationId.trim() === ''
  );

  if (toDelete.length === 0) {
    console.log('No users found to delete.');
    return;
  }

  console.log(`Found ${toDelete.length} user(s) to delete:`);
  toDelete.forEach((u) =>
    console.log(`  id=${u.id}  email=${u.email}  locationId=${JSON.stringify(u.locationId)}`)
  );

  const confirm = process.argv.includes('--confirm');
  if (!confirm) {
    console.log('\nDry run — pass --confirm to actually delete.');
    return;
  }

  const batches = chunk(toDelete, BATCH_SIZE);
  let totalDeleted = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const ids = batch.map((u) => u.id);
    await db.delete(user).where(inArray(user.id, ids));
    totalDeleted += batch.length;
    console.log(`Batch ${i + 1}/${batches.length}: deleted ${batch.length} user(s) (total so far: ${totalDeleted})`);
  }

  console.log(`\nDone. Deleted ${totalDeleted} user(s) in ${batches.length} batch(es).`);
}

deleteEmptyLocationUsers().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
