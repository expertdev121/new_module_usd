import 'dotenv/config';
import Papa from 'papaparse';

process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-late-term-a9gfvfb7-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require'

import { db } from '@/lib/db';
import {
  contact,
  campaign,
  manualDonation,
} from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

import * as fs from 'fs';
import * as path from 'path';

// ---------- Config ----------
const CSV_PATH = process.env.PAYMENTS_CSV || './data/oberlin.csv';
const LOCATION_ID = 'sfhxVFajQpL7HedtX5NK';
const BATCH_SIZE = 500;

// ---------- CSV helpers ----------
function parseCSV(filePath: string): any[] {
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

  return parsed.data as any[];
}

// ---------- Utils ----------
function toNumber(moneyLike: string | number | null | undefined): number {
  if (typeof moneyLike === 'number') return moneyLike;
  if (!moneyLike) return 0;
  const cleaned = String(moneyLike).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(input?: string): string {
  const todayIso = new Date().toISOString().slice(0, 10);
  if (!input) return todayIso;

  try {
    // Parse format like "11/25/2025, 8:40 AM"
    const dateMatch = input.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateMatch) {
      const [, month, day, year] = dateMatch;
      const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      return isNaN(d.getTime()) ? todayIso : d.toISOString().slice(0, 10);
    }

    const d = new Date(input);
    return isNaN(d.getTime()) ? todayIso : d.toISOString().slice(0, 10);
  } catch {
    return todayIso;
  }
}

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

type PaymentRow = {
  'Payment Date (America/New_York)'?: string;
  'Total Amount'?: string;
  'Recurring Status'?: string;
  'First Name'?: string;
  'Last Name'?: string;
  'Email'?: string;
  'Address'?: string;
  'City'?: string;
  'State'?: string;
  'Postal Code'?: string;
  'Campaign'?: string;
  [k: string]: any;
};

// ============ Pre-load data ============
async function preloadData() {
  console.log('📥 Pre-loading existing data into memory...');
  const start = Date.now();

  const [contacts, campaigns] = await Promise.all([
    db.select({
      id: contact.id,
      locationId: contact.locationId,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      firstName: contact.firstName,
      lastName: contact.lastName,
    }).from(contact)
      .where(sql`${contact.locationId} = ${LOCATION_ID}`)
      .execute(),
    db.select().from(campaign)
      .where(sql`${campaign.locationId} = ${LOCATION_ID}`)
      .execute(),
  ]);

  // Build lookup by email (primary) and by full name (fallback)
  const contactsByEmail = new Map(
    contacts
      .filter(c => c.email)
      .map(c => [c.email!.toLowerCase(), c])
  );

  const contactsByName = new Map(
    contacts.map(c => {
      const fullName = `${c.firstName} ${c.lastName}`.toLowerCase().trim();
      return [fullName, c];
    })
  );

  const campaignsByName = new Map(campaigns.map(c => [c.name, c]));

  console.log(`✓ Loaded in ${Date.now() - start}ms:`);
  console.log(`  - ${contacts.length} contacts`);
  console.log(`  - ${contactsByEmail.size} with email`);
  console.log(`  - ${campaigns.length} campaigns\n`);

  return {
    contactsByEmail,
    contactsByName,
    campaignsByName,
  };
}

// ============ Batch create campaigns ============
async function batchCreateCampaigns(
  campaignData: Array<{ name: string; locationId: string }>
) {
  if (campaignData.length === 0) return [];

  const allCreated: any[] = [];
  const batchSize = 200;

  for (let i = 0; i < campaignData.length; i += batchSize) {
    const batch = campaignData.slice(i, i + batchSize);
    const values = batch.map(c => ({
      name: c.name,
      description: `Imported from payments CSV: ${c.name}`,
      status: 'active' as const,
      locationId: c.locationId,
    }));

    const created = await db.insert(campaign).values(values).returning();
    allCreated.push(...created);
    console.log(`  ✓ Created campaigns batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
  }

  return allCreated;
}

// ============ MAIN LOGIC ============
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       PAYMENTS SEEDER (FAST)           ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log(`📍 Location ID: ${LOCATION_ID}\n`);

  // Test DB connection
  await db
    .select()
    .from(contact)
    .limit(1)
    .execute()
    .catch((e) => {
      console.error('❌ Database connection failed:', e);
      process.exit(1);
    });

  const caches = await preloadData();
  const allRows: PaymentRow[] = parseCSV(CSV_PATH);

  console.log(`📦 CSV: ${path.resolve(CSV_PATH)}`);
  console.log(`✓ Rows loaded: ${allRows.length}\n`);

  // ============ PHASE 0: Clean up existing data for this location ============
  console.log('🧹 Phase 0: Cleaning up existing data for location...');

  // Bulk delete manual donations for contacts in this location
  await db.execute(
    sql`DELETE FROM manual_donation WHERE contact_id IN (SELECT id FROM contact WHERE location_id = ${LOCATION_ID})`
  );
  console.log('  ✓ Deleted manual donations for location');

  // Bulk delete campaigns
  await db.execute(
    sql`DELETE FROM campaign WHERE location_id = ${LOCATION_ID}`
  );
  console.log('  ✓ Deleted campaigns for location');

  // Bulk delete contacts
  await db.execute(
    sql`DELETE FROM contact WHERE location_id = ${LOCATION_ID}`
  );
  console.log('  ✓ Deleted contacts for location');

  console.log('✓ Cleanup complete\n');

  // ============ Reload caches after cleanup ============
  console.log('🔄 Reloading caches after cleanup...');
  const reloadedCaches = await preloadData();
  Object.assign(caches, reloadedCaches);

  // ============ PHASE 1: Analyze data ============
  console.log('🔍 Phase 1: Analyzing data...');

  const newCampaigns = new Map<string, string>(); // campaign name -> location id
  const newContactsMap = new Map<string, {
    locationId: string;
    firstName: string;
    lastName: string;
    displayName: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  }>();

  const transactionMetadata: Array<{
    row: PaymentRow;
    contactId?: number;
    contactKey?: string; // email or full name for lookup
    campaignId?: number | null;
    amount: number;
    receivedDate: string;
    isRecurring: boolean;
  }> = [];

  for (const row of allRows) {
    const firstName = (row['First Name'] || '').trim();
    const lastName = (row['Last Name'] || '').trim();
    const email = (row['Email'] || '').trim();
    const campaignName = (row['Campaign'] || '').trim();
    const amount = toNumber(row['Total Amount']);
    const receivedDate = normalizeDate(row['Payment Date (America/New_York)']);
    const isRecurring = (row['Recurring Status'] || '').trim().toLowerCase() === 'recurring';
    const address = (row['Address'] || '').trim();
    const city = (row['City'] || '').trim();
    const state = (row['State'] || '').trim();
    const postalCode = (row['Postal Code'] || '').trim();

    // Look up contact by email first, then by name
    let contactId: number | undefined;
    let contactKey: string | undefined;

    if (email && caches.contactsByEmail.has(email.toLowerCase())) {
      contactId = caches.contactsByEmail.get(email.toLowerCase())!.id;
      contactKey = email.toLowerCase();
    } else if (firstName && lastName) {
      const fullName = `${firstName} ${lastName}`.toLowerCase().trim();
      if (caches.contactsByName.has(fullName)) {
        contactId = caches.contactsByName.get(fullName)!.id;
        contactKey = fullName;
      } else {
        contactKey = email ? email.toLowerCase() : fullName;
      }
    }

    // If not found, prepare to create new contact
    if (!contactId && firstName && lastName) {
      const displayName = `${firstName} ${lastName}`;
      const key = email || `${firstName} ${lastName}`.toLowerCase();

      if (!newContactsMap.has(key)) {
        newContactsMap.set(key, {
          locationId: LOCATION_ID,
          firstName,
          lastName,
          displayName,
          email: email || undefined,
          address: address || undefined,
          city: city || undefined,
          state: state || undefined,
          postalCode: postalCode || undefined,
        });
      }
    }

    // Look up or mark campaign for creation
    let campaignId: number | null = null;
    if (campaignName) {
      if (caches.campaignsByName.has(campaignName)) {
        campaignId = caches.campaignsByName.get(campaignName)!.id;
      } else if (!newCampaigns.has(campaignName)) {
        newCampaigns.set(campaignName, LOCATION_ID);
      }
    }

    transactionMetadata.push({
      row,
      contactId,
      contactKey,
      campaignId,
      amount,
      receivedDate,
      isRecurring,
    });
  }

  const newContacts = Array.from(newContactsMap.entries());

  console.log(`  📊 Analysis complete:`);
  console.log(`    - Payments to process: ${transactionMetadata.length}`);
  console.log(`    - New campaigns needed: ${newCampaigns.size}`);
  console.log(`    - New contacts needed: ${newContacts.length}`);
  console.log(`    - Contacts found: ${transactionMetadata.filter(t => t.contactId).length}`);
  console.log(`    - Contacts missing: ${transactionMetadata.filter(t => !t.contactId).length}\n`);

  // ============ PHASE 2: Create missing campaigns ============
  console.log('🏗️  Phase 2: Creating missing records...');

  if (newCampaigns.size > 0) {
    console.log(`  🎯 Creating ${newCampaigns.size} campaigns...`);
    const campaignData = Array.from(newCampaigns.entries()).map(([name, locationId]) => ({
      name,
      locationId,
    }));
    const createdCampaigns = await batchCreateCampaigns(campaignData);
    createdCampaigns.forEach(c => caches.campaignsByName.set(c.name, c));
  }

  // ============ PHASE 2.5: Create missing contacts ============
  if (newContacts.length > 0) {
    console.log(`  👤 Creating ${newContacts.length} contacts...`);
    const batchSize = 200;
    const allCreatedContacts: any[] = [];

    for (let i = 0; i < newContacts.length; i += batchSize) {
      const batch = newContacts.slice(i, i + batchSize);
      const values = batch.map(([key, c]) => ({
        locationId: c.locationId,
        firstName: c.firstName,
        lastName: c.lastName,
        displayName: c.displayName,
        email: c.email,
        address: c.address,
        city: c.city,
        state: c.state,
        postalCode: c.postalCode,
      }));

      const created = await db.insert(contact).values(values).returning();
      allCreatedContacts.push(...created);
      console.log(`    ✓ Created contacts batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
    }

    // Update cache with new contacts
    allCreatedContacts.forEach(c => {
      if (c.email) caches.contactsByEmail.set(c.email.toLowerCase(), c);
      const fullName = `${c.firstName} ${c.lastName}`.toLowerCase().trim();
      caches.contactsByName.set(fullName, c);
    });

    // Update transactionMetadata with new contact IDs
    transactionMetadata.forEach(metadata => {
      if (!metadata.contactId && metadata.contactKey) {
        if (caches.contactsByEmail.has(metadata.contactKey)) {
          metadata.contactId = caches.contactsByEmail.get(metadata.contactKey)!.id;
        } else if (caches.contactsByName.has(metadata.contactKey)) {
          metadata.contactId = caches.contactsByName.get(metadata.contactKey)!.id;
        }
      }
    });
  }

  // ============ PHASE 3: Resolve campaign IDs ============
  console.log('\n🔗 Phase 3: Resolving campaign relationships...');

  for (const metadata of transactionMetadata) {
    const campaignName = (metadata.row['Campaign'] || '').trim();
    if (campaignName && !metadata.campaignId) {
      metadata.campaignId = caches.campaignsByName.get(campaignName)?.id || null;
    }
  }

  console.log('✓ All relationships resolved\n');

  // ============ PHASE 4: Create manual donations ============
  console.log('💰 Phase 4: Creating manual donations...');

  const manualDonationsToCreate: any[] = [];
  const successLog: any[] = [];
  const errorLog: any[] = [];

  for (const metadata of transactionMetadata) {
    try {
      const row = metadata.row;

      if (!metadata.contactId) {
        throw new Error('Contact not found');
      }

      if (metadata.amount <= 0) {
        throw new Error('Invalid amount');
      }

      const exchangeRate = '1.00';
      const amountUsd = metadata.amount;

      manualDonationsToCreate.push({
        contactId: metadata.contactId,
        amount: metadata.amount.toFixed(2),
        currency: 'USD',
        amountUsd: amountUsd.toFixed(2),
        exchangeRate,
        paymentDate: metadata.receivedDate,
        receivedDate: metadata.receivedDate,
        checkDate: null,
        accountId: null,
        campaignId: metadata.campaignId,
        paymentMethod: 'Credit Card',
        methodDetail: metadata.isRecurring ? 'Recurring' : null,
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
        notes: `Imported from payments CSV${metadata.isRecurring ? ' - Recurring payment' : ''}`,
      });

      successLog.push({
        locationId: LOCATION_ID,
        firstName: row['First Name'] || '',
        lastName: row['Last Name'] || '',
        email: row['Email'] || '',
        campaign: row['Campaign'] || '',
        amount: metadata.amount.toFixed(2),
        paymentDate: metadata.receivedDate,
        recurringStatus: row['Recurring Status'] || '',
        contactId: metadata.contactId,
        campaignId: metadata.campaignId,
        status: 'success',
      });
    } catch (err: any) {
      const row = metadata.row;
      errorLog.push({
        locationId: LOCATION_ID,
        firstName: row['First Name'] || '',
        lastName: row['Last Name'] || '',
        email: row['Email'] || '',
        campaign: row['Campaign'] || '',
        amount: metadata.amount.toFixed(2),
        paymentDate: metadata.receivedDate,
        recurringStatus: row['Recurring Status'] || '',
        error: String(err?.message || err),
      });
    }
  }

  // Batch insert manual donations
  console.log(`  🧾 Inserting ${manualDonationsToCreate.length} manual donations in batches...`);
  for (let i = 0; i < manualDonationsToCreate.length; i += BATCH_SIZE) {
    const batch = manualDonationsToCreate.slice(i, i + BATCH_SIZE);
    await db.insert(manualDonation).values(batch);
    console.log(`    ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} donations`);
  }

  // Summary
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║              SEED SUMMARY              ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`📊 Total payments:       ${allRows.length}`);
  console.log(`👤 Contacts created:     ${newContacts.length}`);
  console.log(`🎯 Campaigns created:    ${newCampaigns.size}`);
  console.log(`🧾 Manual donations:     ${manualDonationsToCreate.length}`);
  console.log(`✅ Successful imports:   ${successLog.length}`);
  console.log(`❌ Failed imports:       ${errorLog.length}`);

  // Write export CSVs
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve('./data/exports');
  const successPath = path.join(outDir, `payments-success-${ts}.csv`);
  const failedPath = path.join(outDir, `payments-failed-${ts}.csv`);

  try {
    if (successLog.length > 0) {
      writeCsv(successPath, successLog);
      console.log(`📤 Success log written: ${successPath} (${successLog.length} rows)`);
    }

    if (errorLog.length > 0) {
      writeCsv(failedPath, errorLog);
      console.log(`📤 Error log written:   ${failedPath} (${errorLog.length} rows)`);
    }
  } catch (e) {
    console.error('⚠️ Failed to write export CSVs:', e);
  }

  console.log('✅ Done.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});