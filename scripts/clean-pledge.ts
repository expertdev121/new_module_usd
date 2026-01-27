// scripts/delete-pledges-and-payments.ts
import 'dotenv/config';
import { db } from '@/lib/db';
import {
  contact,
  pledge,
  payment,
  pledgeTags,
} from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

// Configuration
const LOCATION_ID = '4Nzcp3vUgVbOoN9uxu5F';
const DRY_RUN = false; // Set to true to see what would be deleted without actually deleting

interface DeletionStats {
  pledges: number;
  payments: number;
  pledgeTags: number;
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   DELETE PLEDGES AND PAYMENTS         ║');
  console.log('╚════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No data will be deleted\n');
  } else {
    console.log('⚠️  LIVE MODE - Data will be permanently deleted!\n');
  }

  console.log(`📍 Target Location ID: ${LOCATION_ID}\n`);

  // Test database connection
  try {
    await db.select().from(contact).limit(1).execute();
    console.log('✓ Database connected\n');
  } catch (e) {
    console.error('❌ Database connection failed:', e);
    process.exit(1);
  }

  const stats: DeletionStats = {
    pledges: 0,
    payments: 0,
    pledgeTags: 0,
  };

  try {
    // Step 1: Get all contacts for this location
    console.log('📥 Loading contacts for location...');
    const allContacts = await db
      .select({ id: contact.id })
      .from(contact)
      .where(eq(contact.locationId, LOCATION_ID))
      .execute();

    const contactIds = allContacts.map((c) => c.id);
    console.log(`✓ Found ${contactIds.length} contacts\n`);

    if (contactIds.length === 0) {
      console.log('⚠️  No contacts found for this location. Exiting.\n');
      return;
    }

    // Step 2: Get all pledges for these contacts
    console.log('📥 Loading pledges...');
    const allPledges = await db
      .select({ id: pledge.id })
      .from(pledge)
      .where(inArray(pledge.contactId, contactIds))
      .execute();

    const pledgeIds = allPledges.map((p) => p.id);
    stats.pledges = pledgeIds.length;
    console.log(`✓ Found ${stats.pledges} pledges\n`);

    if (pledgeIds.length === 0) {
      console.log('⚠️  No pledges found for this location. Exiting.\n');
      return;
    }

    // Step 3: Get all payments for these pledges
    console.log('📥 Loading payments for these pledges...');
    const allPayments = await db
      .select({ id: payment.id })
      .from(payment)
      .where(inArray(payment.pledgeId, pledgeIds))
      .execute();

    const paymentIds = allPayments.map((p) => p.id);
    stats.payments = paymentIds.length;
    console.log(`✓ Found ${stats.payments} payments\n`);

    // Step 4: Get pledge tags
    console.log('📥 Loading pledge tags...');
    const plgTags = await db
      .select({ id: pledgeTags.id })
      .from(pledgeTags)
      .where(inArray(pledgeTags.pledgeId, pledgeIds))
      .execute();

    stats.pledgeTags = plgTags.length;
    console.log(`✓ Found ${stats.pledgeTags} pledge tags\n`);

    // Display summary
    console.log('╔════════════════════════════════════════╗');
    console.log('║         DELETION SUMMARY               ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`📊 Items to be deleted:`);
    console.log(`   - Pledges: ${stats.pledges}`);
    console.log(`   - Payments (linked to pledges): ${stats.payments}`);
    console.log(`   - Pledge Tags: ${stats.pledgeTags}\n`);

    if (DRY_RUN) {
      console.log('✅ DRY RUN COMPLETE - No data was deleted\n');
      return;
    }

    // Confirm deletion
    console.log('⚠️  WARNING: This action cannot be undone!\n');
    console.log('Starting deletion in 3 seconds...\n');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Start deletion process
    console.log('╔════════════════════════════════════════╗');
    console.log('║      STARTING DELETION PROCESS         ║');
    console.log('╚════════════════════════════════════════╝\n');

    // Delete in reverse dependency order
    console.log('🗑️  Deleting pledge tags...');
    await db
      .delete(pledgeTags)
      .where(inArray(pledgeTags.pledgeId, pledgeIds))
      .execute();
    console.log(`✓ Deleted ${stats.pledgeTags} pledge tags\n`);

    if (paymentIds.length > 0) {
      console.log('🗑️  Deleting payments linked to pledges...');
      await db
        .delete(payment)
        .where(inArray(payment.pledgeId, pledgeIds))
        .execute();
      console.log(`✓ Deleted ${stats.payments} payments\n`);
    }

    console.log('🗑️  Deleting pledges...');
    await db
      .delete(pledge)
      .where(inArray(pledge.contactId, contactIds))
      .execute();
    console.log(`✓ Deleted ${stats.pledges} pledges\n`);

    console.log('╔════════════════════════════════════════╗');
    console.log('║         DELETION COMPLETE              ║');
    console.log('╚════════════════════════════════════════╝\n');

    console.log('✅ All pledges and their payments have been deleted successfully!\n');
    console.log('Note: Payment plans, installment schedules, and other related');
    console.log('data have been preserved and are NOT deleted.\n');
  } catch (error) {
    console.error('\n❌ Error during deletion:', error);
    throw error;
  }
}

main()
  .then(() => {
    console.log('✅ Script completed successfully\n');
    process.exit(0);
  })
  .catch((e) => {
    console.error('\n❌ FATAL ERROR:', e);
    process.exit(1);
  });