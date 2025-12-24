// scripts/update-received-dates.ts
// Updates received dates for manual donations by adding 1 day
// Run with: npx tsx scripts/update-received-dates.ts [--apply]

import 'dotenv/config';
import { db } from '@/lib/db';
import { manualDonation, contact } from '@/lib/db/schema';
import { eq, isNotNull } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

// Configuration
const LOCATION_ID = process.env.LOCATION_ID || 'asI8eHkRqF8RpX1VXhHz';
const OUTPUT_DIR = './data/exports';
const BATCH_SIZE = 100;

interface UpdateRecord {
  id: number;
  contactId: number;
  contactName?: string;
  amount: string;
  paymentDate: string;
  oldReceivedDate: string;
  newReceivedDate: string;
}

/**
 * Add one day to a date string
 */
function addOneDay(dateStr: string): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + 1);
  
  // Format as YYYY-MM-DD
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Write CSV report
 */
function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

/**
 * Main update function
 */
async function updateReceivedDates(dryRun: boolean = true) {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   UPDATE RECEIVED DATES (+1 DAY)       ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (No changes)' : '⚡ LIVE EXECUTION'}`);
  console.log(`Location ID: ${LOCATION_ID}\n`);

  // Test database connection
  await db
    .select()
    .from(contact)
    .limit(1)
    .execute()
    .catch((e) => {
      console.error('❌ Database connection failed:', e);
      process.exit(1);
    });

  console.log('✓ Database connected\n');

  // Load all manual donations with received dates
  console.log('📥 Loading manual donations with received dates...');
  
  const donations = await db
    .select({
      id: manualDonation.id,
      contactId: manualDonation.contactId,
      amount: manualDonation.amount,
      paymentDate: manualDonation.paymentDate,
      receivedDate: manualDonation.receivedDate,
      contactFirstName: contact.firstName,
      contactLastName: contact.lastName,
      contactDisplayName: contact.displayName,
    })
    .from(manualDonation)
    .innerJoin(contact, eq(manualDonation.contactId, contact.id))
    .where(eq(contact.locationId, LOCATION_ID))
    .execute();

  // Filter only donations that have a received date
  const donationsWithReceivedDate = donations.filter(d => d.receivedDate);

  console.log(`✓ Found ${donations.length} total donations`);
  console.log(`✓ Found ${donationsWithReceivedDate.length} donations with received dates\n`);

  if (donationsWithReceivedDate.length === 0) {
    console.log('✅ No donations with received dates found. Nothing to update.\n');
    return [];
  }

  // Prepare update records
  const updateRecords: UpdateRecord[] = [];

  for (const donation of donationsWithReceivedDate) {
    const oldDate = donation.receivedDate!;
    const newDate = addOneDay(oldDate);
    
    updateRecords.push({
      id: donation.id,
      contactId: donation.contactId,
      contactName: donation.contactDisplayName || `${donation.contactFirstName} ${donation.contactLastName}`,
      amount: donation.amount,
      paymentDate: donation.paymentDate,
      oldReceivedDate: oldDate,
      newReceivedDate: newDate,
    });
  }

  // Show sample of changes
  console.log('📋 Sample of changes (first 10):');
  console.log('='.repeat(100));
  console.log(`${'ID'.padEnd(8)} ${'Contact'.padEnd(25)} ${'Amount'.padEnd(10)} ${'Old Received'.padEnd(15)} → ${'New Received'.padEnd(15)}`);
  console.log('-'.repeat(100));
  
  const sampleSize = Math.min(10, updateRecords.length);
  for (let i = 0; i < sampleSize; i++) {
    const record = updateRecords[i];
    const contactName = (record.contactName || 'Unknown').substring(0, 23);
    console.log(
      `${String(record.id).padEnd(8)} ` +
      `${contactName.padEnd(25)} ` +
      `$${record.amount.padEnd(9)} ` +
      `${formatDate(record.oldReceivedDate).padEnd(15)} → ` +
      `${formatDate(record.newReceivedDate).padEnd(15)}`
    );
  }
  
  if (updateRecords.length > sampleSize) {
    console.log(`... and ${updateRecords.length - sampleSize} more`);
  }
  console.log('='.repeat(100) + '\n');

  // Execute updates if not dry run
  let updatedCount = 0;
  if (!dryRun) {
    console.log('⚡ Executing updates in batches...\n');
    
    for (let i = 0; i < updateRecords.length; i += BATCH_SIZE) {
      const batch = updateRecords.slice(i, i + BATCH_SIZE);
      
      try {
        // Update each donation in the batch
        for (const record of batch) {
          await db
            .update(manualDonation)
            .set({
              receivedDate: record.newReceivedDate,
              updatedAt: new Date(),
            })
            .where(eq(manualDonation.id, record.id));
          
          updatedCount++;
        }
        
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(updateRecords.length / BATCH_SIZE);
        console.log(`  ✓ Batch ${batchNum}/${totalBatches}: Updated ${batch.length} donations`);
        
      } catch (err: any) {
        console.error(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, err.message);
      }
    }
    
    console.log(`\n✓ Updated ${updatedCount} donations\n`);
  }

  // Generate report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(
    OUTPUT_DIR, 
    `received-dates-update-${dryRun ? 'preview' : 'completed'}-${timestamp}.csv`
  );
  
  const reportData = updateRecords.map(record => ({
    'Donation ID': record.id,
    'Contact ID': record.contactId,
    'Contact Name': record.contactName,
    'Amount': record.amount,
    'Payment Date': record.paymentDate,
    'Old Received Date': record.oldReceivedDate,
    'New Received Date': record.newReceivedDate,
    'Old (Formatted)': formatDate(record.oldReceivedDate),
    'New (Formatted)': formatDate(record.newReceivedDate),
    'Status': dryRun ? 'Preview' : 'Updated',
  }));
  
  writeCsv(reportPath, reportData);

  // Summary
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║              SUMMARY                   ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n  Total donations reviewed:    ${donations.length}`);
  console.log(`  With received dates:         ${donationsWithReceivedDate.length}`);
  console.log(`  To be updated:               ${updateRecords.length}`);
  
  if (!dryRun) {
    console.log(`  Successfully updated:        ${updatedCount}`);
  }
  
  console.log(`\n  📄 Report saved to: ${reportPath}`);

  if (dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No changes were made to the database');
    console.log('   Run with --apply flag to execute changes:');
    console.log('   npx tsx scripts/update-received-dates.ts --apply');
  } else {
    console.log('\n✅ Changes have been applied to the database!');
  }

  console.log('\n' + '='.repeat(100) + '\n');

  return updateRecords;
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const applyChanges = args.includes('--apply');
  const dryRun = !applyChanges;

  try {
    await updateReceivedDates(dryRun);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error during update:', error);
    process.exit(1);
  }
}

main();