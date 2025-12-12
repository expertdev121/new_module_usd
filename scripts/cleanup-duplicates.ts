// cleanup-duplicates-enhanced.ts
// Run this file with: npx tsx cleanup-duplicates-enhanced.ts [--apply]

import { db } from '@/lib/db';
import { manualDonation } from '@/lib/db/schema';
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
 * Find duplicate manual donations
 * Duplicates are defined as:
 * - Same contact
 * - Same amount
 * - Within 2 days of each other
 * - Within the same year
 */
async function findDuplicateDonations(): Promise<DuplicateGroup[]> {
  console.log('📊 Fetching all donations...');
  
  const allDonations = await db
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
    .orderBy(manualDonation.contactId, manualDonation.amount, manualDonation.paymentDate);

  console.log(`✓ Loaded ${allDonations.length} donations`);
  console.log('🔄 Analyzing for duplicates...\n');

  const duplicateGroups: DuplicateGroup[] = [];
  const processed = new Set<number>();
  let progressCounter = 0;
  const totalDonations = allDonations.length;

  // Find clusters of donations that are actually close together
  for (let i = 0; i < allDonations.length; i++) {
    if (processed.has(allDonations[i].id)) continue;

    // Progress indicator every 100 donations
    progressCounter++;
    if (progressCounter % 100 === 0) {
      process.stdout.write(`\r   Processed ${progressCounter}/${totalDonations} donations...`);
    }

    const cluster: typeof allDonations = [allDonations[i]];
    processed.add(allDonations[i].id);

    // Look for donations with same contact + amount within 2 days
    for (let j = i + 1; j < allDonations.length; j++) {
      if (processed.has(allDonations[j].id)) continue;

      const current = allDonations[i];
      const candidate = allDonations[j];

      // Must match contact and amount
      if (current.contactId !== candidate.contactId || 
          current.amount !== candidate.amount) {
        // Optimization: since sorted by contactId and amount, 
        // if we've moved to different contact/amount, stop looking
        if (current.contactId !== candidate.contactId) {
          break;
        }
        continue;
      }

      const date1 = new Date(current.paymentDate);
      const date2 = new Date(candidate.paymentDate);

      // Must be same year
      if (date1.getFullYear() !== date2.getFullYear()) {
        continue;
      }

      // Check if within 2 days of ANY donation already in cluster
      let withinRange = false;
      for (const clusterDonation of cluster) {
        const clusterDate = new Date(clusterDonation.paymentDate);
        const daysDiff = Math.abs(
          (clusterDate.getTime() - date2.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysDiff <= 2) {
          withinRange = true;
          break;
        }
      }

      if (withinRange) {
        cluster.push(candidate);
        processed.add(candidate.id);
      }
    }

    // Only add if we found actual duplicates (cluster size > 1)
    if (cluster.length > 1) {
      duplicateGroups.push({
        contactId: cluster[0].contactId,
        amount: cluster[0].amount,
        donations: cluster.map(d => ({
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

  if (progressCounter >= 100) {
    console.log(`\r   Processed ${totalDonations}/${totalDonations} donations... Done!`);
  }

  return duplicateGroups;
}

/**
 * Score a donation record to determine which should be kept
 * Higher score = better record to keep
 */
function scoreDonation(donation: DuplicateGroup['donations'][0]): number {
  let score = 0;
  
  // Prefer records with campaign info
  if (donation.campaignId !== null) score += 100;
  
  // Prefer records with notes
  if (donation.notes) score += 50;
  
  // Prefer records with payment method
  if (donation.paymentMethod) score += 25;
  
  // Prefer records with reference number
  if (donation.referenceNumber) score += 25;
  
  // Use date as tiebreaker (prefer later dates slightly)
  const dateScore = new Date(donation.paymentDate).getTime() / 1000000000;
  score += dateScore;
  
  return score;
}

/**
 * Merge duplicate donations with improved logic
 * Strategy:
 * - Score each donation based on completeness of data
 * - Keep the highest scoring donation
 * - Merge missing information from other duplicates
 * - Delete the rest
 */
async function mergeDuplicates(
  duplicateGroup: DuplicateGroup,
  dryRun: boolean = true
): Promise<{
  kept: number;
  deleted: number[];
  updates: any;
}> {
  const { donations } = duplicateGroup;

  // Score and sort donations (highest score first)
  const scored = donations.map(d => ({
    donation: d,
    score: scoreDonation(d)
  }));
  
  scored.sort((a, b) => b.score - a.score);
  
  const toKeep = scored[0].donation;
  const toDelete = scored.slice(1).map(s => s.donation);

  // Collect missing information from duplicates
  let campaignId = toKeep.campaignId;
  let mergedNotes = toKeep.notes || '';
  let paymentMethod = toKeep.paymentMethod;
  let referenceNumber = toKeep.referenceNumber;

  for (const older of toDelete) {
    // Merge campaign ID if we don't have one
    if (!campaignId && older.campaignId) {
      campaignId = older.campaignId;
    }
    
    // Merge payment method if we don't have one
    if (!paymentMethod && older.paymentMethod) {
      paymentMethod = older.paymentMethod;
    }
    
    // Merge reference number if we don't have one
    if (!referenceNumber && older.referenceNumber) {
      referenceNumber = older.referenceNumber;
    }
    
    // Merge notes
    if (older.notes && !mergedNotes.includes(older.notes)) {
      mergedNotes = mergedNotes
        ? `${mergedNotes}\n[Merged from ID ${older.id}]: ${older.notes}`
        : older.notes;
    }
  }

  // Build updates object
  const updates: any = {};
  if (campaignId !== toKeep.campaignId) updates.campaignId = campaignId;
  if (mergedNotes !== toKeep.notes) updates.notes = mergedNotes;
  if (paymentMethod !== toKeep.paymentMethod) updates.paymentMethod = paymentMethod;
  if (referenceNumber !== toKeep.referenceNumber) updates.referenceNumber = referenceNumber;

  if (!dryRun) {
    if (Object.keys(updates).length > 0) {
      // Update the donation we're keeping
      await db
        .update(manualDonation)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(manualDonation.id, toKeep.id));
    }

    // Delete the duplicates
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
  console.log('🔍 Finding duplicate manual donations...');
  console.log('⏳ Loading donations from database...\n');

  const duplicates = await findDuplicateDonations();
  
  console.log('✓ Duplicate detection complete\n');

  console.log(`Found ${duplicates.length} groups with potential duplicates\n`);

  if (duplicates.length === 0) {
    console.log('✅ No duplicates found!');
    return [];
  }

  const results = [];
  let totalDeleted = 0;
  let totalUpdated = 0;

  for (const group of duplicates) {
    console.log(`\n📋 Contact ID: ${group.contactId}, Amount: $${group.amount}`);
    console.log('   Donations:');

    group.donations.forEach((d) => {
      const score = scoreDonation(d);
      console.log(
        `   - ID ${d.id}: ${d.paymentDate} | Campaign: ${d.campaignId || 'none'} | Score: ${score.toFixed(2)}`
      );
    });

    const result = await mergeDuplicates(group, dryRun);
    results.push(result);
    totalDeleted += result.deleted.length;
    if (Object.keys(result.updates).length > 0) totalUpdated++;

    console.log(`   ✅ Will keep: ID ${result.kept}`);
    console.log(`   ❌ Will delete: IDs ${result.deleted.join(', ')}`);
    if (Object.keys(result.updates).length > 0) {
      console.log(`   🔄 Updates to apply:`, result.updates);
    }
  }

  console.log('\n' + '='.repeat(60));
  if (dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No changes were made to the database');
    console.log('   Run with --apply flag to execute changes:');
    console.log('   npx tsx cleanup-duplicates-enhanced.ts --apply');
  } else {
    console.log('\n✅ Cleanup completed!');
    console.log(`   Kept ${results.length} donations`);
    console.log(`   Updated ${totalUpdated} donations with merged data`);
    console.log(`   Deleted ${totalDeleted} duplicates`);
  }
  console.log('\n' + '='.repeat(60));

  return results;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const applyChanges = args.includes('--apply');

  try {
    await cleanupDuplicateDonations(!applyChanges);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error during cleanup:', error);
    process.exit(1);
  }
}

main();