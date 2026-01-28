// scripts/import-donations-from-csv.ts
import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '@/lib/db';
import { 
  contact, 
  manualDonation, 
  campaign, 
  paymentMethods,
  pledge,
  payment,
  paymentPlan,
  installmentSchedule
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

// Configuration
const CSV_PATH = './data/donation-hq.csv';
const OUTPUT_DIR = './data/exports';
const BATCH_SIZE = 100;
const DRY_RUN = false;
const DEFAULT_LOCATION_ID = 'NikJ6tAcHSe8UCLgYMqM';
const CLEANUP_BEFORE_IMPORT = true; // Set to true to clean location data first

interface DonationRow {
  'First Name': string;
  'Last Name': string;
  'Phone': string;
  'Email': string;
  'donation date': string;
  'Amount': string;
  'campaign': string;
  'payment method': string;
  'Pledge Payment?': string;
  'Check Number': string;
  'Notes': string;
  'Street Address': string;
  'City': string;
  'State': string;
  'Postal Code': string;
}

interface ProcessedDonation {
  row: DonationRow;
  contactId?: number;
  campaignId?: number;
  paymentMethodId?: number;
  isPledgePayment: boolean;
  status: 'success' | 'error';
  message?: string;
  createdPledgeId?: number;
  createdPaymentId?: number;
  createdDonationId?: number;
}

// Utility functions
function parseCSV(filePath: string): DonationRow[] {
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

  return parsed.data as DonationRow[];
}

function normalizeDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  
  // Handle MM/DD/YY or MM/DD/YYYY formats
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    let [month, day, year] = parts;
    
    // Handle 2-digit year
    if (year.length === 2) {
      const yearNum = parseInt(year);
      year = yearNum >= 50 ? `19${year}` : `20${year}`;
    }
    
    const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }
  
  console.warn(`Invalid date: ${dateStr}, using today`);
  return new Date().toISOString().slice(0, 10);
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

function cleanPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const cleaned = phone.replace(/[^0-9]/g, '');
  return cleaned.length >= 10 ? cleaned : undefined;
}

function buildAddress(row: DonationRow): string | undefined {
  const parts = [
    row['Street Address'],
    row['City'],
    row['State'],
    row['Postal Code']
  ].filter(Boolean);
  
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

async function cleanupLocationData(locationId: string) {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       CLEANUP LOCATION DATA            ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log(`🧹 Cleaning up location: ${locationId}\n`);

  try {
    // Get all contacts for this location
    const locationContacts = await db
      .select({ id: contact.id })
      .from(contact)
      .where(eq(contact.locationId, locationId))
      .execute();

    const contactIds = locationContacts.map(c => c.id);
    console.log(`📊 Found ${contactIds.length} contacts for this location`);

    if (contactIds.length === 0) {
      console.log('✓ No data to clean - location is already empty\n');
      return;
    }

    // Get all pledges for these contacts
    const locationPledges = await db
      .select({ id: pledge.id })
      .from(pledge)
      .where(inArray(pledge.contactId, contactIds))
      .execute();

    const pledgeIds = locationPledges.map(p => p.id);
    console.log(`📊 Found ${pledgeIds.length} pledges for this location`);

    // Get all payment plans for these pledges
    let paymentPlanIds: number[] = [];
    if (pledgeIds.length > 0) {
      const locationPaymentPlans = await db
        .select({ id: paymentPlan.id })
        .from(paymentPlan)
        .where(inArray(paymentPlan.pledgeId, pledgeIds))
        .execute();
      paymentPlanIds = locationPaymentPlans.map(pp => pp.id);
      console.log(`📊 Found ${paymentPlanIds.length} payment plans for this location`);
    }

    // Delete in order (respecting foreign keys)
    let deletedCount = 0;

    // 1. Delete installment schedules (references paymentPlanId)
    if (paymentPlanIds.length > 0) {
      const installmentsResult = await db
        .delete(installmentSchedule)
        .where(inArray(installmentSchedule.paymentPlanId, paymentPlanIds))
        .execute();
      console.log(`   ✓ Deleted installment schedules`);
      deletedCount++;
    }

    // 2. Delete payment plans
    if (pledgeIds.length > 0) {
      const plansResult = await db
        .delete(paymentPlan)
        .where(inArray(paymentPlan.pledgeId, pledgeIds))
        .execute();
      console.log(`   ✓ Deleted payment plans`);
      deletedCount++;
    }

    // 3. Delete payments
    if (pledgeIds.length > 0) {
      const paymentsResult = await db
        .delete(payment)
        .where(inArray(payment.pledgeId, pledgeIds))
        .execute();
      console.log(`   ✓ Deleted payments`);
      deletedCount++;
    }

    // 4. Delete pledges
    if (pledgeIds.length > 0) {
      const pledgesResult = await db
        .delete(pledge)
        .where(inArray(pledge.contactId, contactIds))
        .execute();
      console.log(`   ✓ Deleted pledges`);
      deletedCount++;
    }

    // 5. Delete manual donations
    const donationsResult = await db
      .delete(manualDonation)
      .where(inArray(manualDonation.contactId, contactIds))
      .execute();
    console.log(`   ✓ Deleted manual donations`);
    deletedCount++;

    // 6. Delete contacts
    const contactsResult = await db
      .delete(contact)
      .where(eq(contact.locationId, locationId))
      .execute();
    console.log(`   ✓ Deleted contacts`);
    deletedCount++;

    // 7. Delete campaigns
    const campaignsResult = await db
      .delete(campaign)
      .where(eq(campaign.locationId, locationId))
      .execute();
    console.log(`   ✓ Deleted campaigns`);
    deletedCount++;

    // 8. Delete payment methods
    const paymentMethodsResult = await db
      .delete(paymentMethods)
      .where(eq(paymentMethods.locationId, locationId))
      .execute();
    console.log(`   ✓ Deleted payment methods`);
    deletedCount++;

    console.log(`\n✅ Cleanup complete! Deleted data from ${deletedCount} tables\n`);

  } catch (err: any) {
    console.error('\n❌ Cleanup failed:', err.message);
    throw err;
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║      CSV DONATION IMPORT SCRIPT        ║');
  console.log('╚════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Test database connection
  await db.select().from(contact).limit(1).execute().catch((e) => {
    console.error('❌ Database connection failed:', e);
    process.exit(1);
  });
  console.log('✓ Database connected\n');

  // Cleanup location data if enabled
  if (CLEANUP_BEFORE_IMPORT && !DRY_RUN) {
    await cleanupLocationData(DEFAULT_LOCATION_ID);
  }

  // Parse CSV
  console.log(`📂 Reading CSV: ${path.resolve(CSV_PATH)}`);
  const rows = parseCSV(CSV_PATH);
  console.log(`✓ Loaded ${rows.length} rows\n`);

  // Pre-load existing data (FILTERED BY LOCATION)
  console.log('📥 Loading existing data for this location...');
  const existingContacts = await db
    .select()
    .from(contact)
    .where(eq(contact.locationId, DEFAULT_LOCATION_ID))
    .execute();
  
  const existingCampaigns = await db
    .select()
    .from(campaign)
    .where(eq(campaign.locationId, DEFAULT_LOCATION_ID))
    .execute();
  
  const existingPaymentMethods = await db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.locationId, DEFAULT_LOCATION_ID))
    .execute();

  const contactsByEmail = new Map(
    existingContacts
      .filter(c => c.email)
      .map(c => [c.email!.toLowerCase(), c])
  );
  const contactsByName = new Map(
    existingContacts.map(c => [
      `${c.firstName} ${c.lastName}`.toLowerCase().trim(),
      c
    ])
  );
  const campaignsByName = new Map(
    existingCampaigns.map(c => [c.name.toLowerCase().trim(), c])
  );
  const paymentMethodsByName = new Map(
    existingPaymentMethods.map(pm => [pm.name.toLowerCase().trim(), pm])
  );

  console.log(`✓ Loaded ${existingContacts.length} contacts`);
  console.log(`✓ Loaded ${existingCampaigns.length} campaigns`);
  console.log(`✓ Loaded ${existingPaymentMethods.length} payment methods\n`);

  // Track new items to create
  const newContacts = new Map<string, any>();
  const newCampaigns = new Map<string, any>();
  const newPaymentMethods = new Map<string, any>();
  const results: ProcessedDonation[] = [];

  // First pass: identify what needs to be created
  console.log('🔍 Analyzing data...\n');
  
  for (const row of rows) {
    const email = cleanEmail(row.Email);
    const phone = cleanPhone(row.Phone);
    const fullName = `${row['First Name']} ${row['Last Name']}`.trim();
    const campaignName = row.campaign.trim();
    const paymentMethodName = row['payment method'].trim();
    const isPledgePayment = row['Pledge Payment?']?.toLowerCase() === 'yes';

    // Check/create contact
    let foundContact = null;
    if (email && contactsByEmail.has(email)) {
      foundContact = contactsByEmail.get(email)!;
    } else if (contactsByName.has(fullName.toLowerCase())) {
      foundContact = contactsByName.get(fullName.toLowerCase())!;
    } else {
      // Need to create contact
      const contactKey = email || fullName.toLowerCase();
      if (!newContacts.has(contactKey)) {
        newContacts.set(contactKey, {
          firstName: row['First Name'] || 'Unknown',
          lastName: row['Last Name'] || '',
          displayName: fullName,
          email: email,
          phone: phone,
          address: buildAddress(row),
          locationId: DEFAULT_LOCATION_ID,
        });
      }
    }

    // Check/create campaign
    if (campaignName && !campaignsByName.has(campaignName.toLowerCase())) {
      if (!newCampaigns.has(campaignName.toLowerCase())) {
        newCampaigns.set(campaignName.toLowerCase(), {
          name: campaignName,
          description: `Auto-created from CSV import`,
          status: 'active' as const,
          locationId: DEFAULT_LOCATION_ID,
        });
      }
    }

    // Check/create payment method
    if (paymentMethodName && !paymentMethodsByName.has(paymentMethodName.toLowerCase())) {
      if (!newPaymentMethods.has(paymentMethodName.toLowerCase())) {
        newPaymentMethods.set(paymentMethodName.toLowerCase(), {
          name: paymentMethodName,
          description: `Auto-created from CSV import`,
          locationId: DEFAULT_LOCATION_ID,
          isActive: true,
        });
      }
    }
  }

  console.log(`📊 Analysis complete:`);
  console.log(`   Contacts to create: ${newContacts.size}`);
  console.log(`   Campaigns to create: ${newCampaigns.size}`);
  console.log(`   Payment methods to create: ${newPaymentMethods.size}\n`);

  if (DRY_RUN) {
    console.log('✅ Dry run complete - no changes made\n');
    return;
  }

  // Create new contacts
  if (newContacts.size > 0) {
    console.log(`👤 Creating ${newContacts.size} contacts...`);
    const contactValues = Array.from(newContacts.values());
    const createdContacts = await db.insert(contact).values(contactValues).returning();
    
    createdContacts.forEach(c => {
      if (c.email) contactsByEmail.set(c.email.toLowerCase(), c);
      contactsByName.set(`${c.firstName} ${c.lastName}`.toLowerCase().trim(), c);
    });
    console.log(`✓ Created ${createdContacts.length} contacts\n`);
  }

  // Create new campaigns
  if (newCampaigns.size > 0) {
    console.log(`🎯 Creating ${newCampaigns.size} campaigns...`);
    const campaignValues = Array.from(newCampaigns.values());
    const createdCampaigns = await db.insert(campaign).values(campaignValues).returning();
    
    createdCampaigns.forEach(c => {
      campaignsByName.set(c.name.toLowerCase().trim(), c);
    });
    console.log(`✓ Created ${createdCampaigns.length} campaigns\n`);
  }

  // Create new payment methods
  if (newPaymentMethods.size > 0) {
    console.log(`💳 Creating ${newPaymentMethods.size} payment methods...`);
    const pmValues = Array.from(newPaymentMethods.values());
    const createdPMs = await db.insert(paymentMethods).values(pmValues).returning();
    
    createdPMs.forEach(pm => {
      paymentMethodsByName.set(pm.name.toLowerCase().trim(), pm);
    });
    console.log(`✓ Created ${createdPMs.length} payment methods\n`);
  }

  // Process donations in batches
  console.log(`💰 Processing ${rows.length} donations in batches...\n`);
  
  const pledgesToCreate: any[] = [];
  const paymentsToCreate: any[] = [];
  const manualDonationsToCreate: any[] = [];
  
  let processed = 0;
  for (const row of rows) {
    processed++;
    if (processed % 500 === 0) {
      process.stdout.write(`\r  Preparing: ${processed}/${rows.length} (${Math.round(processed/rows.length*100)}%)`);
    }
    
    try {
      const email = cleanEmail(row.Email);
      const fullName = `${row['First Name']} ${row['Last Name']}`.trim();
      const amount = normalizeAmount(row.Amount);
      const donationDate = normalizeDate(row['donation date']);
      const campaignName = row.campaign.trim();
      const paymentMethodName = row['payment method'].trim();
      const isPledgePayment = row['Pledge Payment?']?.toLowerCase() === 'yes';
      const checkNumber = row['Check Number']?.trim() || null;
      const notes = row.Notes?.trim() || null;

      // Find contact
      let foundContact = null;
      if (email && contactsByEmail.has(email)) {
        foundContact = contactsByEmail.get(email)!;
      } else if (contactsByName.has(fullName.toLowerCase())) {
        foundContact = contactsByName.get(fullName.toLowerCase())!;
      }

      if (!foundContact) {
        results.push({
          row,
          status: 'error',
          message: 'Contact not found',
          isPledgePayment,
        });
        continue;
      }

      // Find campaign
      const foundCampaign = campaignName 
        ? campaignsByName.get(campaignName.toLowerCase()) 
        : null;

      if (isPledgePayment) {
        // Prepare pledge data
        pledgesToCreate.push({
          _row: row,
          _contactId: foundContact.id,
          _campaignId: foundCampaign?.id,
          contactId: foundContact.id,
          pledgeDate: donationDate,
          description: `Pledge for ${campaignName}`,
          originalAmount: amount,
          currency: 'USD' as const,
          totalPaid: amount,
          balance: '0.00',
          originalAmountUsd: amount,
          totalPaidUsd: amount,
          balanceUsd: '0.00',
          exchangeRate: '1.00',
          campaignCode: foundCampaign?.id?.toString() || null,
          isActive: true,
          notes: notes,
          _paymentData: {
            amount: amount,
            currency: 'USD' as const,
            amountUsd: amount,
            exchangeRate: '1.00',
            amountInPledgeCurrency: amount,
            pledgeCurrencyExchangeRate: '1.00',
            paymentDate: donationDate,
            receivedDate: donationDate,
            checkDate: checkNumber ? donationDate : null,
            paymentMethod: paymentMethodName,
            paymentStatus: 'completed' as const,
            checkNumber: checkNumber,
            receiptIssued: false,
            notes: notes,
          }
        });

      } else {
        // Prepare manual donation
        manualDonationsToCreate.push({
          _row: row,
          _contactId: foundContact.id,
          _campaignId: foundCampaign?.id,
          contactId: foundContact.id,
          amount: amount,
          currency: 'USD' as const,
          amountUsd: amount,
          exchangeRate: '1.00',
          paymentDate: donationDate,
          receivedDate: donationDate,
          checkDate: checkNumber ? donationDate : null,
          campaignId: foundCampaign?.id || null,
          paymentMethod: paymentMethodName,
          paymentStatus: 'completed' as const,
          checkNumber: checkNumber,
          receiptIssued: false,
          notes: notes,
        });
      }

    } catch (err: any) {
      console.error(`\n❌ Error preparing row ${processed}:`, err.message);
      results.push({
        row,
        isPledgePayment: row['Pledge Payment?']?.toLowerCase() === 'yes',
        status: 'error',
        message: err.message,
      });
    }
  }

  console.log(`\n\n📊 Prepared:`);
  console.log(`   Pledges: ${pledgesToCreate.length}`);
  console.log(`   Manual donations: ${manualDonationsToCreate.length}\n`);

  // Insert manual donations in batches
  if (manualDonationsToCreate.length > 0) {
    console.log(`💰 Inserting ${manualDonationsToCreate.length} manual donations in batches...`);
    let totalCreated = 0;
    
    for (let i = 0; i < manualDonationsToCreate.length; i += BATCH_SIZE) {
      const batch = manualDonationsToCreate.slice(i, i + BATCH_SIZE);
      const batchToInsert = batch.map(d => {
        const { _row, _contactId, _campaignId, ...rest } = d;
        return rest;
      });
      
      try {
        const created = await db.insert(manualDonation).values(batchToInsert).returning();
        totalCreated += created.length;
        
        batch.forEach((d, idx) => {
          results.push({
            row: d._row,
            contactId: d._contactId,
            campaignId: d._campaignId,
            isPledgePayment: false,
            status: 'success',
            createdDonationId: created[idx].id,
          });
        });
        
        process.stdout.write(`\r  Progress: ${totalCreated}/${manualDonationsToCreate.length} (${Math.round(totalCreated/manualDonationsToCreate.length*100)}%)`);
      } catch (err: any) {
        console.error(`\n  ❌ Batch failed:`, err.message);
        batch.forEach(d => {
          results.push({
            row: d._row,
            isPledgePayment: false,
            status: 'error',
            message: err.message,
          });
        });
      }
    }
    console.log(`\n  ✓ Created ${totalCreated} manual donations\n`);
  }

  // Insert pledges and their payments (must be done sequentially due to foreign key)
  if (pledgesToCreate.length > 0) {
    console.log(`🎯 Creating ${pledgesToCreate.length} pledges with payments...`);
    let pledgeCount = 0;
    
    for (const pledgeData of pledgesToCreate) {
      pledgeCount++;
      if (pledgeCount % 10 === 0) {
        process.stdout.write(`\r  Progress: ${pledgeCount}/${pledgesToCreate.length} (${Math.round(pledgeCount/pledgesToCreate.length*100)}%)`);
      }
      
      try {
        const { _row, _contactId, _campaignId, _paymentData, ...pledgeInsert } = pledgeData;
        
        const [createdPledge] = await db.insert(pledge).values(pledgeInsert).returning();
        
        const paymentInsert = {
          ..._paymentData,
          pledgeId: createdPledge.id,
        };
        
        const [createdPayment] = await db.insert(payment).values(paymentInsert).returning();
        
        results.push({
          row: _row,
          contactId: _contactId,
          campaignId: _campaignId,
          isPledgePayment: true,
          status: 'success',
          createdPledgeId: createdPledge.id,
          createdPaymentId: createdPayment.id,
        });
      } catch (err: any) {
        console.error(`\n  ❌ Pledge creation failed:`, err.message);
        results.push({
          row: pledgeData._row,
          isPledgePayment: true,
          status: 'error',
          message: err.message,
        });
      }
    }
    console.log(`\n  ✓ Created ${pledgeCount} pledges with payments\n`);
  }

  // Summary
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'error');
  const pledgePayments = successful.filter(r => r.isPledgePayment);
  const manualDonations = successful.filter(r => !r.isPledgePayment);

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║           IMPORT SUMMARY               ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`✅ Successful: ${successful.length}`);
  console.log(`   - Pledge payments: ${pledgePayments.length}`);
  console.log(`   - Manual donations: ${manualDonations.length}`);
  console.log(`❌ Failed: ${failed.length}\n`);

  // Export results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultPath = path.join(OUTPUT_DIR, `import-results-${timestamp}.csv`);
  
  const exportData = results.map(r => ({
    'First Name': r.row['First Name'],
    'Last Name': r.row['Last Name'],
    'Email': r.row.Email,
    'Amount': r.row.Amount,
    'Date': r.row['donation date'],
    'Campaign': r.row.campaign,
    'Pledge Payment': r.row['Pledge Payment?'],
    'Status': r.status,
    'Contact ID': r.contactId || '',
    'Campaign ID': r.campaignId || '',
    'Pledge ID': r.createdPledgeId || '',
    'Payment ID': r.createdPaymentId || '',
    'Donation ID': r.createdDonationId || '',
    'Message': r.message || '',
  }));

  writeCsv(resultPath, exportData);
  console.log(`📤 Results exported to: ${resultPath}\n`);
  console.log('✅ Import complete!\n');
}

main().catch((e) => {
  console.error('\n❌ FATAL ERROR:', e);
  process.exit(1);
});