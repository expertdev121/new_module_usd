// scripts/delete-2025-donations.ts
import 'dotenv/config';
import { db } from '@/lib/db';
import { contact, manualDonation } from '@/lib/db/schema';
import { and, gte, lt, inArray, eq } from 'drizzle-orm';

// Configuration
const LOCATION_ID = 'KVgMIrEYRkKRcfeicJBm';
const YEAR_TO_DELETE = 2025;

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   DELETE 2025 MANUAL DONATIONS         ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('⚠️  LIVE MODE - Records WILL BE DELETED\n');
  console.log('⚠️  This action cannot be undone!\n');

  console.log(`📍 Location ID: ${LOCATION_ID}`);
  console.log(`📅 Year: ${YEAR_TO_DELETE}\n`);

  // Test database connection
  try {
    await db.select().from(contact).limit(1).execute();
    console.log('✓ Database connected\n');
  } catch (e) {
    console.error('❌ Database connection failed:', e);
    process.exit(1);
  }

  // Step 1: Get all contacts for this location
  console.log(`📥 Loading contacts for location ${LOCATION_ID}...`);
  const locationContacts = await db
    .select()
    .from(contact)
    .where(eq(contact.locationId, LOCATION_ID))
    .execute();
  
  console.log(`✓ Found ${locationContacts.length} contacts\n`);

  if (locationContacts.length === 0) {
    console.log('⚠️  No contacts found for this location. Exiting.\n');
    process.exit(0);
  }

  const contactIds = locationContacts.map(c => c.id);

  // Step 2: Find donations for 2025
  console.log(`🔍 Finding manual donations for ${YEAR_TO_DELETE}...`);
  const startDate = `${YEAR_TO_DELETE}-01-01`;
  const endDate = `${YEAR_TO_DELETE + 1}-01-01`;

  let donations2025: Array<typeof manualDonation.$inferSelect> = [];
  
  // Load in batches to avoid query size limits
  const BATCH_SIZE = 500;
  for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
    const batchContactIds = contactIds.slice(i, i + BATCH_SIZE);
    
    const batchDonations = await db
      .select()
      .from(manualDonation)
      .where(
        and(
          inArray(manualDonation.contactId, batchContactIds),
          gte(manualDonation.receivedDate, startDate),
          lt(manualDonation.receivedDate, endDate)
        )
      )
      .execute();
    
    donations2025.push(...batchDonations);
    
    if (contactIds.length > BATCH_SIZE) {
      process.stdout.write(`\r  Progress: ${Math.min(i + BATCH_SIZE, contactIds.length)}/${contactIds.length} contacts...`);
    }
  }
  
  if (contactIds.length > BATCH_SIZE) {
    console.log('');
  }
  
  console.log(`✓ Found ${donations2025.length} manual donations for ${YEAR_TO_DELETE}\n`);

  if (donations2025.length === 0) {
    console.log('⚠️  No donations found to delete. Exiting.\n');
    process.exit(0);
  }

  // Step 3: Show summary statistics
  console.log('╔════════════════════════════════════════╗');
  console.log('║           DELETION SUMMARY             ║');
  console.log('╚════════════════════════════════════════╝');
  
  const totalAmount = donations2025.reduce((sum, d) => {
    return sum + parseFloat(d.amount || '0');
  }, 0);

  const campaignCounts = donations2025.reduce((acc, d) => {
    const key = d.campaignId ? `Campaign ${d.campaignId}` : 'No Campaign';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`📊 Total donations to delete: ${donations2025.length}`);
  console.log(`💰 Total amount: $${totalAmount.toFixed(2)}`);
  console.log(`📅 Date range: ${startDate} to ${endDate}`);
  console.log(`\n📋 Breakdown by campaign:`);
  
  Object.entries(campaignCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([campaign, count]) => {
      console.log(`   ${campaign}: ${count} donations`);
    });

  // Show sample of donations
  console.log('\n📋 Sample donations (first 10):');
  console.log('─'.repeat(80));
  donations2025.slice(0, 10).forEach(d => {
    console.log(`  ID: ${d.id} | Contact: ${d.contactId} | Amount: $${d.amount} | Date: ${d.receivedDate} | Campaign: ${d.campaignId || 'None'}`);
  });
  if (donations2025.length > 10) {
    console.log(`  ... and ${donations2025.length - 10} more`);
  }

  // Step 4: Execute deletion
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       EXECUTING DELETION PROCESS       ║');
  console.log('╚════════════════════════════════════════╝\n');

  const donationIds = donations2025.map(d => d.id);
  const DELETE_BATCH_SIZE = 100;
  let deletedCount = 0;

  for (let i = 0; i < donationIds.length; i += DELETE_BATCH_SIZE) {
    const batch = donationIds.slice(i, i + DELETE_BATCH_SIZE);
    
    try {
      const deleted = await db
        .delete(manualDonation)
        .where(inArray(manualDonation.id, batch))
        .returning();
      
      deletedCount += deleted.length;
      console.log(`  ✓ Batch ${Math.floor(i / DELETE_BATCH_SIZE) + 1}: ${deleted.length} donations deleted`);
    } catch (err: any) {
      console.error(`  ❌ Batch ${Math.floor(i / DELETE_BATCH_SIZE) + 1} failed:`, err.message);
    }
  }

  console.log(`\n✅ Deletion complete!`);
  console.log(`   Total deleted: ${deletedCount} donations`);

  console.log('\n💡 TIP: Regarding campaigns:');
  console.log('   Yes, campaigns are linked by ID (campaignId in manual_donation table)');
  console.log('   Changing the campaign name in the campaign table will automatically');
  console.log('   reflect everywhere that campaign is referenced.');
  console.log('   The relationship is: manual_donation.campaignId → campaign.id\n');
}

main().catch((e) => {
  console.error('\n❌ FATAL ERROR:', e);
  process.exit(1);
});