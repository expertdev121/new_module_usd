// scripts/import-missing-donations.ts
import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '@/lib/db';
import { contact, manualDonation, campaign, paymentMethods } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// Configuration
const MISSING_CSV_PATH = process.env.MISSING_CSV_PATH || './data/mp.csv';
const OUTPUT_DIR = './data/exports';
const LOCATION_ID = 'KVgMIrEYRkKRcfeicJBm';
const BATCH_SIZE = 100;

interface MissingRow {
  'Customer ID': string;
  'Customer Name': string;
  'Customer Email': string;
  'Customer Phone': string;
  'Payment Method': string;
  'Amount': string;
  'Transactions Date': string; // Note: "Transactions" not "Transaction"
}

// Utility functions
function parseCSV(filePath: string): MissingRow[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = Papa.parse(raw, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0) {
    console.error('CSV Parse Error:', parsed.errors[0]);
    throw new Error(parsed.errors[0].message);
  }

  return parsed.data as MissingRow[];
}

function normalizeDate(dateStr: string): string {
  // Handle ISO dates like "2025-12-17"
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    console.warn(`Invalid date: ${dateStr}, using today`);
    return new Date().toISOString().slice(0, 10);
  }
  
  // Format as YYYY-MM-DD in local timezone
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

function normalizeAmount(amount: string | number): string {
  if (typeof amount === 'number') return amount.toFixed(2);
  const cleaned = String(amount).replace(/[^0-9.\-]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function cleanEmail(email?: string): string | undefined {
  if (!email) return undefined;
  const cleaned = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : undefined;
}

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

// Main logic
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   IMPORT MISSING MANUAL DONATIONS      ║');
  console.log('╚════════════════════════════════════════╝\n');

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

  // Parse CSV
  console.log(`📂 Reading CSV: ${path.resolve(MISSING_CSV_PATH)}`);
  const missingRows = parseCSV(MISSING_CSV_PATH);
  console.log(`✓ Loaded ${missingRows.length} rows\n`);

  // Pre-load all contacts (filtered by location)
  console.log(`📥 Loading contacts for location: ${LOCATION_ID}...`);
  const allContacts = await db
    .select()
    .from(contact)
    .where(eq(contact.locationId, LOCATION_ID))
    .execute();
  
  const contactsByGhlId = new Map(
    allContacts
      .filter(c => c.ghlContactId)
      .map(c => [c.ghlContactId!, c])
  );
  const contactsByEmail = new Map(
    allContacts
      .filter(c => c.email)
      .map(c => [c.email!.toLowerCase(), c])
  );
  const contactsByDisplayName = new Map(
    allContacts.map(c => [c.displayName?.toLowerCase() || '', c])
  );

  console.log(`✓ Loaded ${allContacts.length} contacts`);
  console.log(`  - By GHL ID: ${contactsByGhlId.size}`);
  console.log(`  - By Email: ${contactsByEmail.size}`);
  console.log(`  - By Display Name: ${contactsByDisplayName.size}\n`);

  // Pre-load campaigns and payment methods for location
  console.log(`📥 Loading campaigns and payment methods for location: ${LOCATION_ID}...`);
  const [allCampaigns, allPaymentMethods] = await Promise.all([
    db.select().from(campaign).where(eq(campaign.locationId, LOCATION_ID)).execute(),
    db.select().from(paymentMethods).where(eq(paymentMethods.locationId, LOCATION_ID)).execute(),
  ]);

  const campaignsByName = new Map(allCampaigns.map(c => [c.name.toLowerCase(), c]));
  const paymentMethodsByName = new Map(allPaymentMethods.map(pm => [pm.name.toLowerCase(), pm]));

  console.log(`✓ Loaded ${allCampaigns.length} campaigns`);
  console.log(`✓ Loaded ${allPaymentMethods.length} payment methods\n`);

  // Track new campaigns and payment methods to create
  const newCampaignsToCreate = new Set<string>();
  const newPaymentMethodsToCreate = new Set<string>();

  // First pass: identify what needs to be created
  console.log('🔍 Analyzing data for missing campaigns and payment methods...\n');
  for (const row of missingRows) {
    const paymentMethod = (row['Payment Method'] || 'Credit Card').trim();
    
    if (paymentMethod && !paymentMethodsByName.has(paymentMethod.toLowerCase())) {
      newPaymentMethodsToCreate.add(paymentMethod);
    }
  }

  // Create missing payment methods
  if (newPaymentMethodsToCreate.size > 0) {
    console.log(`💳 Creating ${newPaymentMethodsToCreate.size} new payment methods...`);
    const paymentMethodValues = Array.from(newPaymentMethodsToCreate).map(name => ({
      name,
      description: `Auto-created from import: ${name}`,
      locationId: LOCATION_ID,
      isActive: true,
    }));

    const createdPaymentMethods = await db.insert(paymentMethods).values(paymentMethodValues).returning();
    createdPaymentMethods.forEach(pm => {
      paymentMethodsByName.set(pm.name.toLowerCase(), pm);
    });
    console.log(`  ✓ Created ${createdPaymentMethods.length} payment methods\n`);
  }

  // Process each row
  console.log('🔍 Processing donations...\n');
  
  const donationsToCreate: any[] = [];
  const successLog: any[] = [];
  const errorLog: any[] = [];

  let processed = 0;
  for (const row of missingRows) {
    processed++;
    if (processed % 10 === 0) {
      process.stdout.write(`\r  Progress: ${processed}/${missingRows.length}`);
    }

    try {
      const customerId = row['Customer ID'];
      const customerEmail = cleanEmail(row['Customer Email']);
      const customerName = (row['Customer Name'] || '').trim();
      const amount = normalizeAmount(row['Amount']);
      const paymentDate = normalizeDate(row['Transactions Date']);
      const paymentMethod = (row['Payment Method'] || 'Credit Card').trim();

      // Get payment method ID
      const paymentMethodRecord = paymentMethodsByName.get(paymentMethod.toLowerCase());
      const paymentMethodId = paymentMethodRecord?.id || null;

      // Try to find contact
      let foundContact = null;
      let matchedBy: 'ghlContactId' | 'email' | 'displayName' | 'notFound' = 'notFound';

      // 1. Try by GHL Contact ID
      if (customerId && contactsByGhlId.has(customerId)) {
        foundContact = contactsByGhlId.get(customerId)!;
        matchedBy = 'ghlContactId';
      }
      // 2. Try by email
      else if (customerEmail && contactsByEmail.has(customerEmail)) {
        foundContact = contactsByEmail.get(customerEmail)!;
        matchedBy = 'email';
      }
      // 3. Try by display name
      else if (customerName && contactsByDisplayName.has(customerName.toLowerCase())) {
        foundContact = contactsByDisplayName.get(customerName.toLowerCase())!;
        matchedBy = 'displayName';
      }

      // If no contact found, log error
      if (!foundContact) {
        errorLog.push({
          ...row,
          error: 'Contact not found in database',
          matchedBy: 'notFound',
        });
        continue;
      }

      // Prepare donation data
      donationsToCreate.push({
        contactId: foundContact.id,
        amount: amount,
        currency: 'USD',
        amountUsd: amount,
        exchangeRate: '1.00',
        paymentDate: paymentDate,
        receivedDate: paymentDate,
        checkDate: null,
        accountId: null,
        campaignId: null,
        paymentMethod: paymentMethod,
        methodDetail: null,
        paymentStatus: 'completed',
        referenceNumber: null,
        checkNumber: null,
        receiptNumber: null,
        receiptType: null,
        receiptIssued: false,
        solicitorId: null,
        bonusPercentage: null,
        bonusAmount: null,
        bonusRuleId: null,
        notes: `Imported from missing donations CSV - ${customerName}`,
        _originalRow: row,
        _matchedBy: matchedBy,
      });

      successLog.push({
        'Customer ID': customerId,
        'Customer Name': customerName,
        'Customer Email': customerEmail,
        'Amount': amount,
        'Payment Date': paymentDate,
        'Payment Method': paymentMethod,
        'Contact ID': foundContact.id,
        'Matched By': matchedBy,
        'Status': 'ready_to_import',
      });

    } catch (err: any) {
      errorLog.push({
        ...row,
        error: String(err?.message || err),
      });
    }
  }

  console.log('\n');

  // Insert donations in batches
  if (donationsToCreate.length > 0) {
    console.log(`\n💰 Inserting ${donationsToCreate.length} manual donations in batches...`);
    
    let totalCreated = 0;
    for (let i = 0; i < donationsToCreate.length; i += BATCH_SIZE) {
      const batch = donationsToCreate.slice(i, i + BATCH_SIZE);
      const batchToInsert = batch.map(d => {
        const { _originalRow, _matchedBy, ...rest } = d;
        return rest;
      });
      
      try {
        const created = await db.insert(manualDonation).values(batchToInsert).returning();
        totalCreated += created.length;
        
        // Update success log with actual donation IDs
        batch.forEach((d, idx) => {
          const successIndex = successLog.findIndex(
            s => s['Customer ID'] === d._originalRow['Customer ID'] && 
                 s['Amount'] === d.amount
          );
          if (successIndex >= 0) {
            successLog[successIndex]['Donation ID'] = created[idx].id;
            successLog[successIndex]['Status'] = 'imported';
          }
        });
        
        console.log(`  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${created.length} donations`);
      } catch (err: any) {
        console.error(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, err.message);
        
        // Move failed batch to error log
        batch.forEach(d => {
          errorLog.push({
            ...d._originalRow,
            error: `Database insert failed: ${err.message}`,
          });
        });
      }
    }
    
    console.log(`\n✓ Total created: ${totalCreated} donations`);
  }

  // Generate reports
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║           IMPORT SUMMARY               ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`📊 Total rows processed:     ${missingRows.length}`);
  console.log(`✅ Successfully imported:    ${successLog.filter(s => s.Status === 'imported').length}`);
  console.log(`❌ Failed imports:           ${errorLog.length}`);

  // Write success log CSV
  if (successLog.length > 0) {
    const successPath = path.join(OUTPUT_DIR, `imported-donations-${timestamp}.csv`);
    writeCsv(successPath, successLog);
    console.log(`\n📤 Import log: ${successPath}`);
  }

  // Write error log CSV
  if (errorLog.length > 0) {
    const errorPath = path.join(OUTPUT_DIR, `import-errors-${timestamp}.csv`);
    writeCsv(errorPath, errorLog);
    console.log(`📤 Error log: ${errorPath}`);
  }

  console.log('\n✅ Import complete!\n');
}

main().catch((e) => {
  console.error('\n❌ FATAL ERROR:', e);
  process.exit(1);
});