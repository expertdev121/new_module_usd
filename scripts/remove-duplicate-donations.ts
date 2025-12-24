// scripts/remove-duplicate-donations.ts
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
import { db } from '@/lib/db';
import { manualDonation } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

// Configuration
const LOCATION_ID = 'KVgMIrEYRkKRcfeicJBm';
const OUTPUT_DIR = './data/exports';
const DATE_TOLERANCE_DAYS = 2; // Consider donations within 2 days as potential duplicates
const DRY_RUN = false; // Set to true to preview changes without deleting

interface DonationRecord {
  id: number;
  contactId: number;
  amount: string;
  receivedDate: string | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  createdAt: Date | null;
}

interface DuplicateGroup {
  contactId: number;
  amount: string;
  dateRange: string;
  donations: DonationRecord[];
  keepId: number;
  removeIds: number[];
}

// Utility functions
function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

function daysDifference(date1: Date, date2: Date): number {
  const diffTime = Math.abs(date2.getTime() - date1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function areDatesWithinTolerance(date1: Date | null, date2: Date | null, tolerance: number): boolean {
  if (!date1 || !date2) return false;
  return daysDifference(date1, date2) <= tolerance;
}

// Main logic
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   REMOVE DUPLICATE MANUAL DONATIONS    ║');
  console.log('╚════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
    console.log('   Set DRY_RUN=false to actually delete duplicates\n');
  } else {
    console.log('⚠️  LIVE MODE - Duplicates will be permanently deleted!');
    console.log('   Press Ctrl+C within 5 seconds to cancel...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Test database connection
  await db
    .select()
    .from(manualDonation)
    .limit(1)
    .execute()
    .catch((e) => {
      console.error('❌ Database connection failed:', e);
      process.exit(1);
    });

  console.log('✓ Database connected\n');

  // Fetch all manual donations for the location
  console.log(`📥 Loading manual donations for location: ${LOCATION_ID}...`);
  
  // Note: Assuming manualDonation has a locationId field or is linked through contact
  // Adjust the query based on your schema structure
  const allDonations = await db
    .select()
    .from(manualDonation)
    .execute();

  console.log(`✓ Loaded ${allDonations.length} manual donations\n`);

  // Group donations by contact and identify duplicates
  console.log('🔍 Analyzing donations for duplicates...\n');

  const donationsByContact = new Map<number, DonationRecord[]>();

  for (const donation of allDonations) {
    const contactId = donation.contactId;
    if (!donationsByContact.has(contactId)) {
      donationsByContact.set(contactId, []);
    }
    donationsByContact.get(contactId)!.push(donation as DonationRecord);
  }

  console.log(`📊 Found donations for ${donationsByContact.size} unique contacts\n`);

  // Find duplicate groups
  const duplicateGroups: DuplicateGroup[] = [];
  
  for (const [contactId, donations] of donationsByContact.entries()) {
    if (donations.length < 2) continue;

    // Sort by creation date (newest first) so we keep the most recent one
    const sortedDonations = [...donations].sort((a, b) => {
      const dateA = a.createdAt?.getTime() || 0;
      const dateB = b.createdAt?.getTime() || 0;
      return dateB - dateA; // Reversed to keep newest
    });

    // Check for duplicates: same amount and date within tolerance
    const processed = new Set<number>();
    
    for (let i = 0; i < sortedDonations.length; i++) {
      if (processed.has(sortedDonations[i].id)) continue;

      const current = sortedDonations[i];
      const currentDate = parseDate(current.receivedDate || current.paymentDate);
      if (!currentDate) continue;

      const duplicates: DonationRecord[] = [current];
      processed.add(current.id);

      // Find all donations with same amount and similar date
      for (let j = i + 1; j < sortedDonations.length; j++) {
        if (processed.has(sortedDonations[j].id)) continue;

        const candidate = sortedDonations[j];
        const candidateDate = parseDate(candidate.receivedDate || candidate.paymentDate);

        // Check if amounts match and dates are within tolerance
        if (
          current.amount === candidate.amount &&
          areDatesWithinTolerance(currentDate, candidateDate, DATE_TOLERANCE_DAYS)
        ) {
          duplicates.push(candidate);
          processed.add(candidate.id);
        }
      }

      // If we found duplicates, add to group
      if (duplicates.length > 1) {
        const dates = duplicates.map(d => d.receivedDate || d.paymentDate).filter(Boolean);
        const minDate = dates.sort()[0];
        const maxDate = dates.sort()[dates.length - 1];
        
        duplicateGroups.push({
          contactId,
          amount: current.amount,
          dateRange: minDate === maxDate ? minDate! : `${minDate} to ${maxDate}`,
          donations: duplicates,
          keepId: duplicates[0].id, // Keep the oldest (first created)
          removeIds: duplicates.slice(1).map(d => d.id),
        });
      }
    }
  }

  console.log(`🔍 Found ${duplicateGroups.length} duplicate groups\n`);

  if (duplicateGroups.length === 0) {
    console.log('✅ No duplicates found! Your data is clean.\n');
    return;
  }

  // Calculate totals
  const totalDuplicateDonations = duplicateGroups.reduce((sum, g) => sum + g.donations.length, 0);
  const totalToRemove = duplicateGroups.reduce((sum, g) => sum + g.removeIds.length, 0);

  console.log('╔════════════════════════════════════════╗');
  console.log('║         DUPLICATE ANALYSIS             ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`📊 Duplicate groups:           ${duplicateGroups.length}`);
  console.log(`📊 Total duplicate donations:  ${totalDuplicateDonations}`);
  console.log(`🗑️  Donations to remove:        ${totalToRemove}`);
  console.log(`✅ Donations to keep:          ${duplicateGroups.length}`);
  console.log('');

  // Prepare detailed report
  const reportRows = duplicateGroups.flatMap(group => {
    return group.donations.map((donation, idx) => ({
      'Contact ID': group.contactId,
      'Amount': group.amount,
      'Received Date': donation.receivedDate,
      'Payment Date': donation.paymentDate,
      'Payment Method': donation.paymentMethod,
      'Status': donation.paymentStatus,
      'Created At': donation.createdAt?.toISOString(),
      'Donation ID': donation.id,
      'Action': idx === 0 ? 'KEEP' : 'REMOVE',
      'Duplicate Group': `${group.contactId}-${group.amount}-${group.dateRange}`,
    }));
  });

  // Write report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `duplicate-donations-report-${timestamp}.csv`);
  writeCsv(reportPath, reportRows);
  console.log(`📤 Detailed report: ${reportPath}\n`);

  // Delete duplicates if not in dry run mode
  if (!DRY_RUN && totalToRemove > 0) {
    console.log('🗑️  Deleting duplicate donations...\n');

    const allIdsToRemove = duplicateGroups.flatMap(g => g.removeIds);
    const BATCH_SIZE = 100;
    let totalDeleted = 0;

    for (let i = 0; i < allIdsToRemove.length; i += BATCH_SIZE) {
      const batch = allIdsToRemove.slice(i, i + BATCH_SIZE);
      
      try {
        await db
          .delete(manualDonation)
          .where(inArray(manualDonation.id, batch))
          .execute();
        
        totalDeleted += batch.length;
        console.log(`  ✓ Deleted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} donations`);
      } catch (err: any) {
        console.error(`  ❌ Failed to delete batch ${Math.floor(i / BATCH_SIZE) + 1}:`, err.message);
      }
    }

    console.log(`\n✅ Total deleted: ${totalDeleted} duplicate donations\n`);
  } else if (DRY_RUN) {
    console.log('ℹ️  DRY RUN: No deletions performed\n');
    console.log('   To actually delete duplicates, run:');
    console.log('   DRY_RUN=false npm run remove-duplicates\n');
  }

  // Summary
  console.log('╔════════════════════════════════════════╗');
  console.log('║           CLEANUP SUMMARY              ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`📊 Duplicate groups found:     ${duplicateGroups.length}`);
  console.log(`🗑️  Duplicates removed:         ${DRY_RUN ? 0 : totalToRemove}`);
  console.log(`✅ Donations remaining:        ${allDonations.length - (DRY_RUN ? 0 : totalToRemove)}`);
  console.log('');
  console.log('✅ Cleanup complete!\n');
}

main().catch((e) => {
  console.error('\n❌ FATAL ERROR:', e);
  process.exit(1);
});