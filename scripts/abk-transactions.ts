// scripts/seed-transactions.ts
import 'dotenv/config';
import Papa from 'papaparse';

process.env.DATABASE_URL =  'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-late-term-a9gfvfb7-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require'

import { db } from '@/lib/db';
import {
  contact,
  campaign,
  manualDonation,
} from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

import * as fs from 'fs';
import * as path from 'path';

// ---------- Config ----------
const CSV_PATH = process.env.TRANSACTIONS_CSV || './data/transactions.csv';
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

  let candidate = input;
  // If no year found, assume 2025
  if (!/\b\d{4}\b/.test(candidate)) candidate = `${candidate} 2025`;

  const d = new Date(candidate);
  return isNaN(d.getTime()) ? todayIso : d.toISOString().slice(0, 10);
}

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

type TransactionRow = {
  'Location id'?: string;
  'Customer id'?: string;
  'Customer name'?: string;
  'Customer email'?: string;
  'Customer phone'?: string;
  'Payment Method'?: string;
  'Currency'?: string;
  'Total Amount'?: string;
  'Campaign'?: string;
  'Transaction date'?: string;
  [k: string]: any;
};

// ============ Pre-load data ============
async function preloadData() {
  console.log('📥 Pre-loading existing data into memory...');
  const start = Date.now();

  const [contacts, campaigns] = await Promise.all([
    db.select({
      id: contact.id,
      ghlContactId: contact.ghlContactId,
      locationId: contact.locationId,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      firstName: contact.firstName,
      lastName: contact.lastName,
    }).from(contact).execute(),
    db.select().from(campaign).execute(),
  ]);

  // Build lookup map by GHL Contact ID only
  const contactsByGhlId = new Map(
    contacts
      .filter(c => c.ghlContactId)
      .map(c => [c.ghlContactId!, c])
  );

  const campaignsByName = new Map(campaigns.map(c => [c.name, c]));

  console.log(`✓ Loaded in ${Date.now() - start}ms:`);
  console.log(`  - ${contacts.length} contacts`);
  console.log(`  - ${contactsByGhlId.size} with GHL ID`);
  console.log(`  - ${campaigns.length} campaigns\n`);

  return {
    contactsByGhlId,
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
      description: `Imported from transactions CSV: ${c.name}`,
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
  console.log('║     TRANSACTIONS SEEDER (FAST)         ║');
  console.log('╚════════════════════════════════════════╝\n');

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
  const allRows: TransactionRow[] = parseCSV(CSV_PATH);

  console.log(`📦 CSV: ${path.resolve(CSV_PATH)}`);
  console.log(`✓ Rows loaded: ${allRows.length}\n`);

  // ============ PHASE 0: Clean up existing data for location IDs in CSV ============
  console.log('🧹 Phase 0: Cleaning up existing data for location IDs in CSV...');

  const locationIds = new Set<string>();
  for (const row of allRows) {
    const locationId = (row['Location id'] || '').trim();
    if (locationId) locationIds.add(locationId);
  }

  if (locationIds.size > 0) {
    console.log(`  📍 Found ${locationIds.size} unique location IDs: ${Array.from(locationIds).join(', ')}`);

    const locIdArray = Array.from(locationIds);

    // Bulk delete manual donations for contacts in these locations
    await db.execute(sql`DELETE FROM manual_donation WHERE contact_id IN (SELECT id FROM contact WHERE location_id IN (${sql.join(locIdArray, sql`, `)}))`);
    console.log('  ✓ Deleted manual donations for contacts in specified locations');

    // Bulk delete campaigns
    await db.execute(sql`DELETE FROM campaign WHERE location_id IN (${sql.join(locIdArray, sql`, `)})`);
    console.log('  ✓ Deleted campaigns for specified locations');

    // Bulk delete contacts
    await db.execute(sql`DELETE FROM contact WHERE location_id IN (${sql.join(locIdArray, sql`, `)})`);
    console.log('  ✓ Deleted contacts for specified locations');
  } else {
    console.log('  ⚠️ No location IDs found in CSV, skipping cleanup');
  }

  console.log('✓ Cleanup complete\n');

  // ============ Reload caches after cleanup ============
  console.log('🔄 Reloading caches after cleanup...');
  const reloadedCaches = await preloadData();
  Object.assign(caches, reloadedCaches);

  // ============ PHASE 1: Analyze data ============
  console.log('🔍 Phase 1: Analyzing data...');

  const newCampaigns = new Map<string, string>(); // campaign name -> location id
  const newContactsMap = new Map<string, {
    ghlContactId: string;
    locationId: string;
    firstName: string;
    lastName: string;
    displayName?: string;
    email?: string;
    phone?: string;
  }>(); // Use GHL Contact ID as the key
  
  const transactionMetadata: Array<{
    row: TransactionRow;
    contactId?: number;
    ghlContactId?: string; // Track GHL contact ID for lookup
    campaignId?: number | null;
    amount: number;
    receivedDate: string;
    locationId: string;
    paymentMethod: string;
    currency: string;
  }> = [];

  for (const row of allRows) {
    const locationId = (row['Location id'] || '').trim();
    const customerId = (row['Customer id'] || '').trim();
    const customerName = (row['Customer name'] || '').trim();
    const customerEmail = (row['Customer email'] || '').trim();
    const customerPhone = (row['Customer phone'] || '').trim();
    const campaignName = (row['Campaign'] || '').trim();
    const amount = toNumber(row['Total Amount']);
    const receivedDate = normalizeDate(row['Transaction date']);
    const paymentMethod = (row['Payment Method'] || 'Credit Card').trim();
    const currency = (row['Currency'] || 'USD').trim();

    // Look up contact by GHL contact ID only
    let contactId: number | undefined;
    
    if (customerId && caches.contactsByGhlId.has(customerId)) {
      contactId = caches.contactsByGhlId.get(customerId)!.id;
    }

    // If not found and we have a GHL contact ID, prepare to create new contact
    if (!contactId && customerId && customerName) {
      // Only create if we haven't already planned to create this GHL contact ID
      if (!newContactsMap.has(customerId)) {
        const nameParts = customerName.split(' ');
        const firstName = nameParts[0] || 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || 'Unknown';
        const displayName = customerName;

        newContactsMap.set(customerId, {
          ghlContactId: customerId,
          locationId,
          firstName,
          lastName,
          displayName,
          email: customerEmail || undefined,
          phone: customerPhone || undefined,
        });
      }
    }

    // Look up or mark campaign for creation
    let campaignId: number | null = null;
    if (campaignName) {
      if (caches.campaignsByName.has(campaignName)) {
        campaignId = caches.campaignsByName.get(campaignName)!.id;
      } else if (!newCampaigns.has(campaignName)) {
        newCampaigns.set(campaignName, locationId);
      }
    }

    transactionMetadata.push({
      row,
      contactId,
      ghlContactId: customerId || undefined,
      campaignId,
      amount,
      receivedDate,
      locationId,
      paymentMethod,
      currency,
    });
  }

  const newContacts = Array.from(newContactsMap.values());

  console.log(`  📊 Analysis complete:`);
  console.log(`    - Transactions to process: ${transactionMetadata.length}`);
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
      const values = batch.map(c => ({
        ghlContactId: c.ghlContactId,
        locationId: c.locationId,
        firstName: c.firstName,
        lastName: c.lastName,
        displayName: c.displayName,
        email: c.email,
        phone: c.phone,
      }));

      const created = await db.insert(contact).values(values).returning();
      allCreatedContacts.push(...created);
      console.log(`    ✓ Created contacts batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
    }

    // Update cache with new contacts
    allCreatedContacts.forEach(c => {
      if (c.ghlContactId) caches.contactsByGhlId.set(c.ghlContactId, c);
    });

    // Update transactionMetadata with new contact IDs
    transactionMetadata.forEach(metadata => {
      if (!metadata.contactId && metadata.ghlContactId) {
        if (caches.contactsByGhlId.has(metadata.ghlContactId)) {
          metadata.contactId = caches.contactsByGhlId.get(metadata.ghlContactId)!.id;
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
        throw new Error('Contact not found - missing GHL Contact ID');
      }

      if (metadata.amount <= 0) {
        throw new Error('Invalid amount');
      }

      const exchangeRate = metadata.currency === 'USD' ? '1.00' : '1.00';
      const amountUsd = metadata.amount;

      manualDonationsToCreate.push({
        contactId: metadata.contactId,
        amount: metadata.amount.toFixed(2),
        currency: metadata.currency,
        amountUsd: amountUsd.toFixed(2),
        exchangeRate,
        paymentDate: metadata.receivedDate,
        receivedDate: metadata.receivedDate,
        checkDate: null,
        accountId: null,
        campaignId: metadata.campaignId,
        paymentMethod: metadata.paymentMethod,
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
        notes: `Imported from transactions CSV - Customer: ${row['Customer name'] || 'N/A'}`,
      });

      successLog.push({
        locationId: metadata.locationId,
        customerId: row['Customer id'] || '',
        customerName: row['Customer name'] || '',
        customerEmail: row['Customer email'] || '',
        customerPhone: row['Customer phone'] || '',
        campaign: row['Campaign'] || '',
        amount: metadata.amount.toFixed(2),
        currency: metadata.currency,
        paymentMethod: metadata.paymentMethod,
        transactionDate: metadata.receivedDate,
        contactId: metadata.contactId,
        campaignId: metadata.campaignId,
        status: 'success',
      });
    } catch (err: any) {
      const row = metadata.row;
      errorLog.push({
        locationId: metadata.locationId,
        customerId: row['Customer id'] || '',
        customerName: row['Customer name'] || '',
        customerEmail: row['Customer email'] || '',
        customerPhone: row['Customer phone'] || '',
        campaign: row['Campaign'] || '',
        amount: metadata.amount.toFixed(2),
        currency: metadata.currency,
        paymentMethod: metadata.paymentMethod,
        transactionDate: metadata.receivedDate,
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
  console.log(`📊 Total transactions:   ${allRows.length}`);
  console.log(`👤 Contacts created:     ${newContacts.length}`);
  console.log(`🎯 Campaigns created:    ${newCampaigns.size}`);
  console.log(`🧾 Manual donations:     ${manualDonationsToCreate.length}`);
  console.log(`✅ Successful imports:   ${successLog.length}`);
  console.log(`❌ Failed imports:       ${errorLog.length}`);

  // Write export CSVs
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve('./data/exports');
  const successPath = path.join(outDir, `transactions-success-${ts}.csv`);
  const failedPath = path.join(outDir, `transactions-failed-${ts}.csv`);

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