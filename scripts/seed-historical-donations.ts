// Set the environment variable directly
process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-delicate-smoke-a9zveme7-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require';

import { db } from "@/lib/db";
import { 
  contact, 
  pledge, 
  payment, 
  manualDonation,
  paymentPlan,
  installmentSchedule
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as fs from 'fs';

/**
 * Parse CSV file and convert to JSON array
 */
function parseCSV(filePath: string): any[] {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');
    
    if (lines.length === 0) {
      throw new Error('CSV file is empty');
    }
    
    // Get headers from first line
    const headers = lines[0].split(',').map(h => h.trim());
    
    const data: any[] = [];
    
    // Parse each line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines
      
      const values = line.split(',').map(v => v.trim());
      const row: any = {};
      
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      
      data.push(row);
    }
    
    return data;
  } catch (error) {
    console.error('Error parsing CSV:', error);
    throw error;
  }
}

/**
 * Parse date string to ISO format (YYYY-MM-DD)
 */
function parseDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${dateStr}`);
    }
    return date.toISOString().split('T')[0];
  } catch (error) {
    console.error(`Date parse error for "${dateStr}":`, error);
    // Fallback to current date
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Main seed function
 */
async function seed() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   DONATION DATA SEEDER - STARTING     ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    // Path to your CSV file - UPDATE THIS PATH
    const csvFilePath = './data/donations.csv';
    
    console.log(`📂 Reading CSV file: ${csvFilePath}`);
    
    // Check if file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at: ${csvFilePath}`);
    }
    
    // Parse CSV file
    const rows = parseCSV(csvFilePath);
    console.log(`✓ Found ${rows.length} rows to process\n`);
    
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];
    
    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because of header and 0-index
      
      try {
        // Extract data from CSV columns
        const customerId = row['Customer id'];
        const customerName = row['Customer name'];
        const currency = row['Currency'];
        const totalAmountStr = row['Total Amount'];
        const status = row['Status'];
        const sourceName = row['Source name'];
        const paymentProvider = row['Payment provider'];
        const transactionDate = row['Transaction date'];
        const paymentMethod = row['Payment Method'];

        // Validate required fields
        if (!customerId) {
          console.log(`⊘ Row ${rowNum}: Skipped - No customer ID`);
          skippedCount++;
          continue;
        }

        if (!totalAmountStr || isNaN(parseFloat(totalAmountStr))) {
          console.log(`⊘ Row ${rowNum}: Skipped - Invalid amount`);
          skippedCount++;
          continue;
        }

        const totalAmount = parseFloat(totalAmountStr);

        // Find contact by ghl_contact_id
        const foundContact = await db
          .select()
          .from(contact)
          .where(eq(contact.ghlContactId, customerId))
          .limit(1);

        if (foundContact.length === 0) {
          const errorMsg = `Row ${rowNum}: Contact not found for ID ${customerId} (${customerName})`;
          console.warn(`❌ ${errorMsg}`);
          errors.push(errorMsg);
          errorCount++;
          continue;
        }

        const contactId = foundContact[0].id;
        const paymentDate = parseDate(transactionDate);

        // ============================================
        // AUTHORIZE-NET: Create Pledge and Payment
        // ============================================
        if (paymentProvider === "authorize-net") {
          
          // 1. Create Pledge
          const [createdPledge] = await db.insert(pledge).values({
            contactId: contactId,
            pledgeDate: paymentDate,
            description: sourceName || 'Donation',
            originalAmount: totalAmount.toFixed(2),
            currency: currency as any,
            totalPaid: totalAmount.toFixed(2),
            balance: "0.00",
            originalAmountUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            totalPaidUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            balanceUsd: "0.00",
            isActive: true,
            notes: `Imported from CSV - ${sourceName || 'Payment'}`,
          }).returning();

          // 2. Create Payment Plan
          const [createdPlan] = await db.insert(paymentPlan).values({
            pledgeId: createdPledge.id,
            planName: `One-time - ${sourceName || 'Payment'}`,
            frequency: "one_time",
            distributionType: "fixed",
            totalPlannedAmount: totalAmount.toFixed(2),
            currency: currency as any,
            totalPlannedAmountUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            installmentAmount: totalAmount.toFixed(2),
            installmentAmountUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            numberOfInstallments: 1,
            startDate: paymentDate,
            nextPaymentDate: paymentDate,
            installmentsPaid: 1,
            totalPaid: totalAmount.toFixed(2),
            totalPaidUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            remainingAmount: "0.00",
            remainingAmountUsd: "0.00",
            planStatus: "completed",
            isActive: true,
          }).returning();

          // 3. Create Installment Schedule
          const [createdSchedule] = await db.insert(installmentSchedule).values({
            paymentPlanId: createdPlan.id,
            installmentDate: paymentDate,
            installmentAmount: totalAmount.toFixed(2),
            currency: currency as any,
            installmentAmountUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            status: "paid",
            paidDate: paymentDate,
            notes: `Paid via ${paymentMethod || 'Credit Card'}`,
          }).returning();

          // 4. Create Payment
          await db.insert(payment).values({
            pledgeId: createdPledge.id,
            paymentPlanId: createdPlan.id,
            installmentScheduleId: createdSchedule.id,
            amount: totalAmount.toFixed(2),
            currency: currency as any,
            amountUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            amountInPledgeCurrency: totalAmount.toFixed(2),
            paymentDate: paymentDate,
            receivedDate: paymentDate,
            paymentMethod: paymentMethod || 'Credit Card',
            paymentStatus: status === "succeeded" ? "completed" : "failed",
            receiptIssued: false,
            notes: `Imported from CSV - ${paymentProvider}`,
          });

          console.log(`✓ Row ${rowNum}: Pledge & Payment created for ${customerName} - ${currency} ${totalAmount}`);
          successCount++;
          
        } 
        // ============================================
        // MANUAL: Create Manual Donation
        // ============================================
        else if (paymentProvider === "manual") {
          
          await db.insert(manualDonation).values({
            contactId: contactId,
            amount: totalAmount.toFixed(2),
            currency: currency as any,
            amountUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            paymentDate: paymentDate,
            receivedDate: paymentDate,
            paymentMethod: paymentMethod || 'Cash',
            paymentStatus: status === "succeeded" ? "completed" : "failed",
            receiptIssued: false,
            notes: `Imported from CSV - ${sourceName || 'Manual Payment'}`,
          });

          console.log(`✓ Row ${rowNum}: Manual donation created for ${customerName} - ${currency} ${totalAmount}`);
          successCount++;
          
        } else {
          console.log(`⊘ Row ${rowNum}: Skipped - Unknown payment provider: ${paymentProvider}`);
          skippedCount++;
        }
        
      } catch (error) {
        const errorMsg = `Row ${rowNum}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        errorCount++;
      }
    }

    // Print summary
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║           SEED SUMMARY                 ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`📊 Total rows in CSV:     ${rows.length}`);
    console.log(`✓  Successfully processed: ${successCount}`);
    console.log(`❌ Errors:                 ${errorCount}`);
    console.log(`⊘  Skipped:                ${skippedCount}`);
    console.log('════════════════════════════════════════\n');

    // Show detailed errors if any
    if (errors.length > 0) {
      console.log('📋 Detailed Errors:');
      errors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err}`);
      });
      console.log('');
    }

    console.log('✅ Seeding completed!\n');

  } catch (error) {
    console.error('\n💥 FATAL ERROR:');
    console.error(error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the seeder
seed();
