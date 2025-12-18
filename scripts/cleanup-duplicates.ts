// cleanup-duplicates-enhanced.ts
// Run this file with: npx tsx cleanup-duplicates-enhanced.ts [--apply]

import { db } from '@/lib/db';
import { manualDonation, contact } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

interface DuplicateGroup {
  contactId: number;
  amount: string;
  donations: Array<{
    id: number;
    paymentDate: string;
    campaignId: number | null;
    notes: string | null;
    paymentMethod: string | null;
    referenceNumber: string | null;
  }>;
}

/**
 * Batch-friendly version of duplicate finder
 * Uses the SAME clustering logic but processes contacts one-by-one
 */
async function findDuplicateDonations(): Promise<DuplicateGroup[]> {
  console.log("📊 Fetching contacts...");

  const contacts = await db
    .select({ id: contact.id })
    .from(contact)
    .where(eq(contact.locationId, "KVgMIrEYRkKRcfeicJBm"));

  console.log(`✓ Found ${contacts.length} contacts\n`);

  const BATCH_SIZE = 200;
  const duplicateGroups: DuplicateGroup[] = [];

  // Helper: load donations for a single contact
  async function loadDonationsForContact(contactId: number) {
    return db
      .select({
        id: manualDonation.id,
        contactId: manualDonation.contactId,
        amount: manualDonation.amount,
        paymentDate: manualDonation.paymentDate,
        campaignId: manualDonation.campaignId,
        notes: manualDonation.notes,
        paymentMethod: manualDonation.paymentMethod,
        referenceNumber: manualDonation.referenceNumber,
      })
      .from(manualDonation)
      .where(eq(manualDonation.contactId, contactId))
      .orderBy(manualDonation.amount, manualDonation.paymentDate);
  }

  // Helper: original duplicate-detecting logic reused per contact
  function findDuplicatesInList(donations: any[]) {
    const groups: DuplicateGroup[] = [];

    // 1️⃣ Group by amount + year
    const buckets = new Map<string, any[]>();

    for (const d of donations) {
      const year = new Date(d.paymentDate).getFullYear();
      const key = `${d.amount}-${year}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(d);
    }

    // 2️⃣ Process each bucket separately (dramatically reduces size)
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;

      const processed = new Set<number>();

      // Sort the bucket correctly
      bucket.sort((a, b) => {
        if (a.amount !== b.amount) return a.amount.localeCompare(b.amount);
        return new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime();
      });

      for (let i = 0; i < bucket.length; i++) {
        if (processed.has(bucket[i].id)) continue;

        const cluster = [bucket[i]];
        processed.add(bucket[i].id);

        for (let j = i + 1; j < bucket.length; j++) {
          if (processed.has(bucket[j].id)) continue;

          const current = bucket[i];
          const candidate = bucket[j];

          if (current.amount !== candidate.amount) break;

          const d1 = new Date(current.paymentDate).getTime();
          const d2 = new Date(candidate.paymentDate).getTime();

          const diffDays = Math.abs((d1 - d2) / (1000 * 60 * 60 * 24));

          if (diffDays <= 2) {
            cluster.push(candidate);
            processed.add(candidate.id);
          }
        }

        if (cluster.length > 1) {
          groups.push({
            contactId: cluster[0].contactId,
            amount: cluster[0].amount,
            donations: cluster.map((d) => ({
              id: d.id,
              paymentDate: d.paymentDate,
              campaignId: d.campaignId,
              notes: d.notes,
              paymentMethod: d.paymentMethod,
              referenceNumber: d.referenceNumber,
            })),
          });
        }
      }
    }

    return groups;
  }


  // Process contacts in batches
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    console.log(
      `🔄 Processing contact batch ${i / BATCH_SIZE + 1} (${batch.length} contacts)`
    );

    for (const c of batch) {
      const donations = await loadDonationsForContact(c.id);
      if (donations.length < 2) continue;

      const groups = findDuplicatesInList(donations);
      duplicateGroups.push(...groups);
    }
  }

  console.log("\n✓ Duplicate detection complete\n");
  return duplicateGroups;
}

/**
 * Score a donation record to determine which should be kept
 * Higher score = better record to keep
 */
function scoreDonation(donation: DuplicateGroup['donations'][0]): number {
  let score = 0;

  if (donation.campaignId !== null) score += 100;
  if (donation.notes) score += 50;
  if (donation.paymentMethod) score += 25;
  if (donation.referenceNumber) score += 25;

  const dateScore = new Date(donation.paymentDate).getTime() / 1000000000;
  score += dateScore;

  return score;
}

/**
 * Merge duplicate donations with improved logic
 */
async function mergeDuplicates(
  duplicateGroup: DuplicateGroup,
  dryRun: boolean = true
) {
  const { donations } = duplicateGroup;

  const scored = donations.map((d) => ({
    donation: d,
    score: scoreDonation(d),
  }));

  scored.sort((a, b) => b.score - a.score);

  const toKeep = scored[0].donation;
  const toDelete = scored.slice(1).map((s) => s.donation);

  let campaignId = toKeep.campaignId;
  let mergedNotes = toKeep.notes || "";
  let paymentMethod = toKeep.paymentMethod;
  let referenceNumber = toKeep.referenceNumber;

  for (const older of toDelete) {
    if (!campaignId && older.campaignId) campaignId = older.campaignId;
    if (!paymentMethod && older.paymentMethod)
      paymentMethod = older.paymentMethod;
    if (!referenceNumber && older.referenceNumber)
      referenceNumber = older.referenceNumber;

    if (older.notes && !mergedNotes.includes(older.notes)) {
      mergedNotes = mergedNotes
        ? `${mergedNotes}\n[Merged from ID ${older.id}]: ${older.notes}`
        : older.notes;
    }
  }

  const updates: any = {};
  if (campaignId !== toKeep.campaignId) updates.campaignId = campaignId;
  if (mergedNotes !== toKeep.notes) updates.notes = mergedNotes;
  if (paymentMethod !== toKeep.paymentMethod)
    updates.paymentMethod = paymentMethod;
  if (referenceNumber !== toKeep.referenceNumber)
    updates.referenceNumber = referenceNumber;

  if (!dryRun) {
    if (Object.keys(updates).length > 0) {
      await db
        .update(manualDonation)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(manualDonation.id, toKeep.id));
    }

    for (const duplicate of toDelete) {
      await db
        .delete(manualDonation)
        .where(eq(manualDonation.id, duplicate.id));
    }
  }

  return {
    kept: toKeep.id,
    deleted: toDelete.map((d) => d.id),
    updates,
  };
}

/**
 * Main cleanup function
 */
async function cleanupDuplicateDonations(dryRun: boolean = true) {
  console.log("🔍 Finding duplicate manual donations...");
  console.log("⏳ Loading donations from database...\n");

  const duplicates = await findDuplicateDonations();

  console.log(`Found ${duplicates.length} groups with potential duplicates\n`);

  if (duplicates.length === 0) {
    console.log("✅ No duplicates found!");
    return [];
  }

  const results = [];
  let totalDeleted = 0;
  let totalUpdated = 0;

  for (const group of duplicates) {
    console.log(
      `\n📋 Contact ID: ${group.contactId}, Amount: $${group.amount}`
    );
    console.log("   Donations:");

    group.donations.forEach((d) => {
      const score = scoreDonation(d);
      console.log(
        `   - ID ${d.id}: ${d.paymentDate} | Campaign: ${d.campaignId || "none"
        } | Score: ${score.toFixed(2)}`
      );
    });

    const result = await mergeDuplicates(group, dryRun);
    results.push(result);
    totalDeleted += result.deleted.length;
    if (Object.keys(result.updates).length > 0) totalUpdated++;

    console.log(`   ✅ Will keep: ID ${result.kept}`);
    console.log(`   ❌ Will delete: IDs ${result.deleted.join(", ")}`);
    if (Object.keys(result.updates).length > 0) {
      console.log(`   🔄 Updates to apply:`, result.updates);
    }
  }

  console.log("\n" + "=".repeat(60));
  if (dryRun) {
    console.log("\n⚠️  DRY RUN MODE - No changes were made to the database");
    console.log("   Run with --apply flag to execute changes:");
    console.log("   npx tsx cleanup-duplicates-enhanced.ts --apply");
  } else {
    console.log("\n✅ Cleanup completed!");
    console.log(`   Kept ${results.length} donations`);
    console.log(`   Updated ${totalUpdated} donations with merged data`);
    console.log(`   Deleted ${totalDeleted} duplicates`);
  }
  console.log("\n" + "=".repeat(60));

  return results;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const applyChanges = args.includes("--apply");

  try {
    await cleanupDuplicateDonations(!applyChanges);
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error during cleanup:", error);
    process.exit(1);
  }
}

main();
