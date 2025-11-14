// scripts/duplicate-payment-checker.ts

import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { eq, and, sql } from 'drizzle-orm';
import { config } from 'dotenv';
import ws from 'ws';

// Load environment variables
config();

// Configure WebSocket constructor for Node.js environments
neonConfig.webSocketConstructor = ws;

import {
  payment,
  contact,
  pledge,
  manualDonation,
} from '../lib/db/schema';

// Configuration
const DATABASE_URL = process.env.DATABASE_URL!;

// Database connection check
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set');
  console.error('💡 Make sure you have a .env or .env.local file with:');
  console.error('   DATABASE_URL=your_connection_string_here');
  process.exit(1);
}

interface DuplicatePayment {
  contactId: number;
  contactName: string;
  receivedDate: string;
  amount: string;
  currency: string;
  paymentIds: number[];
  duplicateCount: number;
  type: 'payment' | 'manual_donation';
}

interface DuplicateSummary {
  totalDuplicateGroups: number;
  totalDuplicatePayments: number;
  totalDuplicateManualDonations: number;
  totalPaymentsToDelete: number;
  totalManualDonationsToDelete: number;
  affectedContacts: number;
  timestamp: string;
}

class DuplicatePaymentChecker {
  private db: ReturnType<typeof drizzle>;

  constructor() {
    const pool = new Pool({
      connectionString: DATABASE_URL
    });
    this.db = drizzle(pool, {
      logger: true
    });
  }

  async checkDatabaseConnection(): Promise<boolean> {
    try {
      console.log('Testing database connection...');
      const result = await this.db.execute(sql`SELECT 1 as test`);
      console.log('✅ Database connection successful');
      return true;
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      return false;
    }
  }

  /**
   * Find all duplicate payments within each contact
   * Duplicates are defined as: same contact, same received_date, same amount
   */
  async findDuplicatePayments(): Promise<DuplicatePayment[]> {
    console.log('🔍 Searching for duplicate payments...\n');

    const duplicates: DuplicatePayment[] = [];

    try {
      // Find duplicate regular payments
      console.log('📋 Checking regular payments...');
      const duplicatePaymentGroups = await this.db.execute(sql`
        SELECT 
          pl.contact_id,
          p.received_date,
          p.amount,
          p.currency,
          COUNT(*) as duplicate_count,
          ARRAY_AGG(p.id ORDER BY p.id) as payment_ids,
          c.first_name,
          c.last_name
        FROM payment p
        LEFT JOIN pledge pl ON p.pledge_id = pl.id
        LEFT JOIN contact c ON pl.contact_id = c.id
        WHERE p.received_date IS NOT NULL
          AND p.payment_status = 'completed'
          AND pl.contact_id IS NOT NULL
        GROUP BY pl.contact_id, p.received_date, p.amount, p.currency, c.first_name, c.last_name
        HAVING COUNT(*) > 1
        ORDER BY pl.contact_id, p.received_date
      `);

      for (const row of duplicatePaymentGroups.rows) {
        const contactId = Number(row.contact_id);
        const firstName = String(row.first_name || '');
        const lastName = String(row.last_name || '');
        const contactName = `${firstName} ${lastName}`.trim() || 'Unknown Contact';
        const receivedDate = String(row.received_date);
        const amount = String(row.amount);
        const currency = String(row.currency);
        const duplicateCount = Number(row.duplicate_count);
        
        // Parse payment IDs array from PostgreSQL
        const paymentIdsStr = String(row.payment_ids);
        const paymentIds = paymentIdsStr
          .replace(/[{}]/g, '')
          .split(',')
          .map(id => Number(id.trim()));

        duplicates.push({
          contactId,
          contactName,
          receivedDate,
          amount,
          currency,
          paymentIds,
          duplicateCount,
          type: 'payment',
        });

        console.log(`📋 Found ${duplicateCount} duplicate PAYMENTS:`);
        console.log(`   Contact: ${contactName} (ID: ${contactId})`);
        console.log(`   Date: ${receivedDate}`);
        console.log(`   Amount: ${amount} ${currency}`);
        console.log(`   Payment IDs: ${paymentIds.join(', ')}`);
        console.log(`   → Will keep payment ${paymentIds[0]}, delete ${duplicateCount - 1} duplicates\n`);
      }

      // Find duplicate manual donations
      console.log('💰 Checking manual donations...');
      const duplicateManualDonationGroups = await this.db.execute(sql`
        SELECT 
          md.contact_id,
          md.received_date,
          md.amount,
          md.currency,
          COUNT(*) as duplicate_count,
          ARRAY_AGG(md.id ORDER BY md.id) as donation_ids,
          c.first_name,
          c.last_name
        FROM manual_donation md
        LEFT JOIN contact c ON md.contact_id = c.id
        WHERE md.received_date IS NOT NULL
          AND md.payment_status = 'completed'
        GROUP BY md.contact_id, md.received_date, md.amount, md.currency, c.first_name, c.last_name
        HAVING COUNT(*) > 1
        ORDER BY md.contact_id, md.received_date
      `);

      for (const row of duplicateManualDonationGroups.rows) {
        const contactId = Number(row.contact_id);
        const firstName = String(row.first_name || '');
        const lastName = String(row.last_name || '');
        const contactName = `${firstName} ${lastName}`.trim() || 'Unknown Contact';
        const receivedDate = String(row.received_date);
        const amount = String(row.amount);
        const currency = String(row.currency);
        const duplicateCount = Number(row.duplicate_count);
        
        // Parse donation IDs array from PostgreSQL
        const donationIdsStr = String(row.donation_ids);
        const donationIds = donationIdsStr
          .replace(/[{}]/g, '')
          .split(',')
          .map(id => Number(id.trim()));

        duplicates.push({
          contactId,
          contactName,
          receivedDate,
          amount,
          currency,
          paymentIds: donationIds,
          duplicateCount,
          type: 'manual_donation',
        });

        console.log(`💰 Found ${duplicateCount} duplicate MANUAL DONATIONS:`);
        console.log(`   Contact: ${contactName} (ID: ${contactId})`);
        console.log(`   Date: ${receivedDate}`);
        console.log(`   Amount: ${amount} ${currency}`);
        console.log(`   Donation IDs: ${donationIds.join(', ')}`);
        console.log(`   → Will keep donation ${donationIds[0]}, delete ${duplicateCount - 1} duplicates\n`);
      }

      return duplicates;
    } catch (error) {
      console.error('Error finding duplicate payments:', error);
      throw error;
    }
  }

  /**
   * Delete duplicate payments, keeping only the first one (lowest ID)
   */
  async deleteDuplicatePayments(duplicates: DuplicatePayment[]): Promise<{
    deleted: number;
    failed: number;
    errors: string[];
  }> {
    console.log(`\n🗑️  Deleting duplicate payments and manual donations (keeping first occurrence)...\n`);

    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const duplicate of duplicates) {
      // Keep the first payment/donation (lowest ID), delete the rest
      const [keepId, ...deleteIds] = duplicate.paymentIds;

      const typeLabel = duplicate.type === 'payment' ? 'PAYMENT' : 'MANUAL DONATION';
      console.log(`Processing duplicate ${typeLabel} group for ${duplicate.contactName}:`);
      console.log(`  ✅ Keeping ${duplicate.type} ID: ${keepId}`);
      console.log(`  ❌ Deleting ${duplicate.type} IDs: ${deleteIds.join(', ')}`);

      for (const recordId of deleteIds) {
        try {
          if (duplicate.type === 'payment') {
            // Delete the duplicate payment
            await this.db
              .delete(payment)
              .where(eq(payment.id, recordId));
          } else {
            // Delete the duplicate manual donation
            await this.db
              .delete(manualDonation)
              .where(eq(manualDonation.id, recordId));
          }

          deleted++;
          console.log(`  ✓ Deleted ${duplicate.type} ${recordId}`);
        } catch (error) {
          failed++;
          const errorMsg = `Failed to delete ${duplicate.type} ${recordId}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          console.error(`  ✗ ${errorMsg}`);
        }
      }

      console.log('');
    }

    return { deleted, failed, errors };
  }

  /**
   * Recalculate pledge totals after deleting duplicates
   */
  async recalculatePledgeTotals(): Promise<void> {
    console.log('\n🔄 Recalculating pledge totals after duplicate removal...\n');

    try {
      // Get all pledges that had payments
      const pledgesWithPayments = await this.db
        .selectDistinct({
          pledgeId: payment.pledgeId,
        })
        .from(payment)
        .where(
          and(
            sql`${payment.pledgeId} IS NOT NULL`,
            sql`${payment.paymentStatus} = 'completed'`,
            sql`${payment.receivedDate} IS NOT NULL`,
            sql`${payment.amountInPledgeCurrency} IS NOT NULL`
          )
        );

      console.log(`Found ${pledgesWithPayments.length} pledges to recalculate\n`);

      for (const pledgeRow of pledgesWithPayments) {
        const pledgeId = pledgeRow.pledgeId;

        if (!pledgeId || isNaN(Number(pledgeId))) {
          continue;
        }

        try {
          // Sum payments for this pledge
          const paymentSum = await this.db
            .select({
              total: sql<number>`COALESCE(SUM(amount_in_pledge_currency), 0)`,
            })
            .from(payment)
            .where(
              and(
                eq(payment.pledgeId, pledgeId),
                sql`${payment.paymentStatus} = 'completed'`,
                sql`${payment.receivedDate} IS NOT NULL`,
                sql`${payment.amountInPledgeCurrency} IS NOT NULL`
              )
            );

          const pledgeData = await this.db
            .select({
              originalAmount: pledge.originalAmount,
            })
            .from(pledge)
            .where(eq(pledge.id, pledgeId))
            .limit(1);

          if (pledgeData.length > 0 && paymentSum.length > 0) {
            const actualTotalPaid = Number(paymentSum[0].total) || 0;
            const originalAmount = Number(pledgeData[0].originalAmount) || 0;
            const correctBalance = originalAmount - actualTotalPaid;

            // Update pledge totals
            await this.db.update(pledge)
              .set({
                totalPaid: actualTotalPaid.toFixed(2),
                balance: correctBalance.toFixed(2),
                updatedAt: new Date()
              })
              .where(eq(pledge.id, pledgeId));

            console.log(`  ✓ Updated pledge ${pledgeId}: paid=${actualTotalPaid.toFixed(2)}, balance=${correctBalance.toFixed(2)}`);
          }
        } catch (error) {
          console.error(`  ✗ Failed to update pledge ${pledgeId}:`, error instanceof Error ? error.message : String(error));
        }
      }
    } catch (error) {
      console.error('Error in recalculatePledgeTotals:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  displaySummary(summary: DuplicateSummary): void {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║          DUPLICATE PAYMENT CHECK SUMMARY                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`🕒 Date: ${new Date(summary.timestamp).toLocaleString()}`);
    console.log(`📊 Total Duplicate Groups: ${summary.totalDuplicateGroups}`);
    console.log(`📋 Duplicate Payments: ${summary.totalDuplicatePayments}`);
    console.log(`💰 Duplicate Manual Donations: ${summary.totalDuplicateManualDonations}`);
    console.log(`🗑️  Total Records to Delete: ${summary.totalPaymentsToDelete + summary.totalManualDonationsToDelete}`);
    console.log(`   - Payments: ${summary.totalPaymentsToDelete}`);
    console.log(`   - Manual Donations: ${summary.totalManualDonationsToDelete}`);
    console.log(`👥 Affected Contacts: ${summary.affectedContacts}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'check';

  const checker = new DuplicatePaymentChecker();

  try {
    const connected = await checker.checkDatabaseConnection();
    if (!connected) {
      throw new Error('Database connection failed');
    }

    switch (command) {
      case 'check':
        console.log('🔍 Running duplicate payment check (dry run)...\n');
        console.log('This will identify duplicate payments and manual donations based on:');
        console.log('  • Same contact');
        console.log('  • Same received date');
        console.log('  • Same amount and currency\n');

        const duplicates = await checker.findDuplicatePayments();

        if (duplicates.length === 0) {
          console.log('✅ No duplicate payments or manual donations found!');
          return;
        }

        const paymentDuplicates = duplicates.filter(d => d.type === 'payment');
        const donationDuplicates = duplicates.filter(d => d.type === 'manual_donation');
        
        const totalDuplicatePayments = paymentDuplicates.reduce((sum, d) => sum + d.duplicateCount, 0);
        const totalDuplicateManualDonations = donationDuplicates.reduce((sum, d) => sum + d.duplicateCount, 0);
        const totalPaymentsToDelete = paymentDuplicates.reduce((sum, d) => sum + (d.duplicateCount - 1), 0);
        const totalManualDonationsToDelete = donationDuplicates.reduce((sum, d) => sum + (d.duplicateCount - 1), 0);
        const affectedContacts = new Set(duplicates.map(d => d.contactId)).size;

        const summary: DuplicateSummary = {
          totalDuplicateGroups: duplicates.length,
          totalDuplicatePayments,
          totalDuplicateManualDonations,
          totalPaymentsToDelete,
          totalManualDonationsToDelete,
          affectedContacts,
          timestamp: new Date().toISOString()
        };

        checker.displaySummary(summary);

        console.log('💡 To delete these duplicates, run: npm run check:duplicates delete');
        break;

      case 'delete':
        console.log('🗑️  Running duplicate payment and manual donation deletion...\n');

        const duplicatesToDelete = await checker.findDuplicatePayments();

        if (duplicatesToDelete.length === 0) {
          console.log('✅ No duplicate payments or manual donations found!');
          return;
        }

        const result = await checker.deleteDuplicatePayments(duplicatesToDelete);

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║               DELETION RESULTS                             ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log(`✅ Successfully deleted: ${result.deleted} records`);
        console.log(`❌ Failed to delete: ${result.failed} records`);

        if (result.errors.length > 0) {
          console.log('\n⚠️  Errors encountered:');
          result.errors.forEach(error => console.log(`  • ${error}`));
        }

        const paymentsDeleted = duplicatesToDelete.filter(d => d.type === 'payment').length > 0;
        if (result.deleted > 0 && paymentsDeleted) {
          console.log('\n🔄 Recalculating pledge totals (for deleted payments only)...');
          await checker.recalculatePledgeTotals();
          console.log('✅ Pledge totals updated');
        }

        console.log('\n✨ Duplicate payment cleanup complete!');
        break;

      default:
        console.log(`
╔════════════════════════════════════════════════════════════╗
║          DUPLICATE PAYMENT CHECKER                         ║
╚════════════════════════════════════════════════════════════╝

This tool identifies and removes duplicate payments AND manual donations
within each contact.

🔍 Duplicate Detection Criteria:
  • Same contact
  • Same received date
  • Same amount and currency
  • Completed payment/donation status

🎯 What it does:
  • Checks both 'payment' and 'manual_donation' tables
  • Keeps the first record (lowest ID)
  • Deletes all duplicate records
  • Recalculates pledge totals automatically (for payments only)

📋 Commands:
  check     Show duplicate payments/donations (dry run, no changes)
  delete    Delete duplicates and update pledge totals

📝 Examples:
  npm run check:duplicates check   # View duplicates
  npm run check:duplicates delete  # Remove duplicates

⚠️  Warning: The 'delete' command permanently removes duplicate records.
   Always run 'check' first to review what will be deleted.
        `);
        break;
    }
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch(console.error);