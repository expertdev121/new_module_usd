// scripts/seed-pledges-payments.ts
import 'dotenv/config';
import Papa from 'papaparse';

process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-late-term-a9gfvfb7-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require'

import { db } from '@/lib/db';
import {
  user,
  contact,
  category,
  pledge,
  payment,
  solicitor,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcryptjs';

// ---------- Config ----------
const LOCATION_ID = '4Nzcp3vUgVbOoN9uxu5F';
const CSV_PATH = process.env.PLEDGES_PAYMENTS_CSV || './data/church.csv';
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
  // Handle M/D/YYYY format
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(candidate)) {
    const [month, day, year] = candidate.split('/');
    candidate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const d = new Date(candidate);
  return isNaN(d.getTime()) ? todayIso : d.toISOString().slice(0, 10);
}

function cleanEmail(raw?: string): string | undefined {
  if (!raw) return undefined;

  let e = raw.replace(/\s+/g, '').trim();

  if (e.includes(',')) e = e.split(',')[0];
  if (e.includes(';')) e = e.split(';')[0];

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return e.toLowerCase();
  }

  return undefined;
}

function normalizeCurrency(curr?: string): 'USD' | 'ILS' | 'EUR' | 'JPY' | 'GBP' | 'AUD' | 'CAD' | 'ZAR' {
  const normalized = (curr || 'USD').toUpperCase().trim();
  const validCurrencies = ['USD', 'ILS', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'ZAR'];
  return validCurrencies.includes(normalized) ? normalized as any : 'USD';
}

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

// ============ Pre-load data ============
async function preloadData() {
  console.log('📥 Pre-loading existing data into memory...');
  const start = Date.now();

  const [contacts, categories, solicitors, users] = await Promise.all([
    db.select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      displayName: contact.displayName,
      phone: contact.phone,
    }).from(contact).execute(),
    db.select().from(category).execute(),
    db.select().from(solicitor).execute(),
    db.select().from(user).execute(),
  ]);

  const contactsByEmail = new Map(contacts.filter(c => c.email).map(c => [c.email!, c]));
  const contactsByPhone = new Map(contacts.filter(c => c.phone).map(c => [c.phone!, c]));
  const contactsByName = new Map(
    contacts.map(c => [`${c.firstName}|||${c.lastName}`, c])
  );
  const categoriesByName = new Map(categories.map(c => [c.name, c]));
  const solicitorsByContactId = new Map(solicitors.map(s => [s.contactId, s]));
  const usersByEmail = new Map(users.map(u => [u.email, u]));

  console.log(`✓ Loaded in ${Date.now() - start}ms:`);
  console.log(`  - ${contacts.length} contacts`);
  console.log(`  - ${categories.length} categories`);
  console.log(`  - ${solicitors.length} solicitors`);
  console.log(`  - ${users.length} users\n`);

  return {
    contactsByEmail,
    contactsByPhone,
    contactsByName,
    categoriesByName,
    solicitorsByContactId,
    usersByEmail,
  };
}

// ============ Batch creators ============
async function batchCreateUsers(emails: string[]) {
  if (emails.length === 0) return [];

  const allCreated: any[] = [];
  const batchSize = 100;

  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);
    const values = await Promise.all(
      batch.map(async (email) => ({
        email,
        passwordHash: await bcrypt.hash(email, 10),
        role: 'user' as const,
        status: 'active' as const,
        isActive: true,
        locationId: LOCATION_ID,
      }))
    );

    const created = await db.insert(user).values(values).returning();
    allCreated.push(...created);
    console.log(`  ✓ Created users batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
  }

  return allCreated;
}

async function batchCreateContacts(contactData: Array<{
  email?: string;
  phone?: string;
  firstName: string;
  lastName: string;
  displayName: string;
}>) {
  if (contactData.length === 0) return [];

  const allCreated: any[] = [];
  const batchSize = 200;

  for (let i = 0; i < contactData.length; i += batchSize) {
    const batch = contactData.slice(i, i + batchSize);
    const values = batch.map(c => ({
      ghlContactId: undefined,
      locationId: LOCATION_ID,
      firstName: c.firstName,
      lastName: c.lastName,
      displayName: c.displayName,
      email: c.email,
      phone: c.phone,
    }));

    const created = await db.insert(contact).values(values).returning();
    allCreated.push(...created);
    console.log(`  ✓ Created contacts batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
  }

  return allCreated;
}

async function batchCreateCategories(categoryNames: string[]) {
  if (categoryNames.length === 0) return [];

  const allCreated: any[] = [];
  const batchSize = 200;

  for (let i = 0; i < categoryNames.length; i += batchSize) {
    const batch = categoryNames.slice(i, i + batchSize);
    const values = batch.map(name => ({
      name,
      description: `Imported from CSV: ${name}`,
      locationId: LOCATION_ID,
      isActive: true,
    }));

    const created = await db.insert(category).values(values).returning();
    allCreated.push(...created);
    console.log(`  ✓ Created categories batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
  }

  return allCreated;
}

async function batchCreateSolicitors(solicitorData: Array<{ contactId: number }>) {
  if (solicitorData.length === 0) return [];

  const allCreated: any[] = [];
  const batchSize = 100;

  for (let i = 0; i < solicitorData.length; i += batchSize) {
    const batch = solicitorData.slice(i, i + batchSize);
    const values = batch.map(s => ({
      contactId: s.contactId,
      solicitorCode: `SOL-${Date.now()}-${s.contactId}`,
      status: 'active' as const,
      commissionRate: '0.00',
      hireDate: new Date().toISOString().slice(0, 10),
      locationId: LOCATION_ID,
      notes: 'Created from pledges payments import',
    }));

    const created = await db.insert(solicitor).values(values).returning();
    allCreated.push(...created);
    console.log(`  ✓ Created solicitors batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
  }

  return allCreated;
}

// ============ Cleanup existing data ============
async function cleanupExistingData() {
  console.log('🧹 Checking for existing data for location...');

  // Check if any contacts exist for this location
  const existingContacts = await db
    .select({ id: contact.id })
    .from(contact)
    .where(eq(contact.locationId, LOCATION_ID))
    .limit(1)
    .execute();

  if (existingContacts.length === 0) {
    console.log('✓ No existing data found, proceeding with fresh import\n');
    return;
  }

  console.log('⚠️  Found existing contacts for this location');
  console.log('🗑️  Deleting all related data...\n');

  // Get all contact IDs for this location
  const contactIds = await db
    .select({ id: contact.id })
    .from(contact)
    .where(eq(contact.locationId, LOCATION_ID))
    .execute();

  const ids = contactIds.map(c => c.id);

  if (ids.length === 0) {
    console.log('✓ No contacts to clean up\n');
    return;
  }

  console.log(`  Found ${ids.length} contacts to clean up`);

  // Delete in reverse order of dependencies
  try {
    // 1. Delete payments
    const deletedPayments = await db
      .delete(payment)
      .where(eq(payment.payerContactId, ids[0]))
      .execute();
    console.log(`  ✓ Cleaned payments`);

    // 2. Delete pledges
    const deletedPledges = await db
      .delete(pledge)
      .where(eq(pledge.contactId, ids[0]))
      .execute();
    console.log(`  ✓ Cleaned pledges`);

    // 3. Delete categories for this location
    const deletedCategories = await db
      .delete(category)
      .where(eq(category.locationId, LOCATION_ID))
      .execute();
    console.log(`  ✓ Cleaned categories`);

    // 4. Delete users for this location
    const deletedUsers = await db
      .delete(user)
      .where(eq(user.locationId, LOCATION_ID))
      .execute();
    console.log(`  ✓ Cleaned users`);

    // 5. Delete contacts (this will CASCADE to solicitors and other related records)
    const deletedContacts = await db
      .delete(contact)
      .where(eq(contact.locationId, LOCATION_ID))
      .execute();
    console.log(`  ✓ Cleaned contacts and related records (solicitors, etc.)`);

    console.log('\n✅ Cleanup complete! Starting fresh import...\n');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  }
}

// ============ Main ============
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   PLEDGES PAYMENTS SEEDER              ║');
  console.log('╚════════════════════════════════════════╝\n');

  await db
    .select()
    .from(user)
    .limit(1)
    .execute()
    .catch((e) => {
      console.error('❌ Database connection failed:', e);
      process.exit(1);
    });

  // Clean up existing data first
  await cleanupExistingData();

  const caches = await preloadData();
  const allRows = parseCSV(CSV_PATH);

  console.log(`📦 CSV: ${path.resolve(CSV_PATH)}`);
  console.log(`✓ Rows loaded: ${allRows.length}\n`);

  // ============ Phase 1: Analyze data ============
  console.log('🔍 Phase 1: Analyzing data...');

  const newUsers = new Set<string>();
  const newContacts = new Map<string, {
    email?: string;
    phone?: string;
    firstName: string;
    lastName: string;
    displayName: string;
  }>();
  const newCategories = new Set<string>();
  const newSolicitorContacts = new Map<string, {
    firstName: string;
    lastName: string;
    displayName: string;
  }>();

  const pledgePaymentMetadata: Array<{
    contactId?: number;
    categoryId?: number;
    solicitorId?: number;
    amount: number;
    currency: string;
    receivedDate: string;
    paymentMethod: string;
    notes?: string;
    row: any;
  }> = [];

  for (const row of allRows) {
    const firstName = (row['First Name'] || '').trim();
    const lastName = (row['Last Name'] || '').trim();
    const phone = (row['Phone'] || '').trim();
    const email = cleanEmail(row['Email']);
    const categoryName = (row['Category'] || '').trim() || 'general donation';
    const notes = (row['Payment Method'] || '').trim();
    const amount = toNumber(row['Amount']);
    const currency = normalizeCurrency('USD'); // Assuming USD
    const receivedDate = normalizeDate(row['Date']);

    // Find or mark contact for creation
    let contactId: number | undefined;
    if (email && caches.contactsByEmail.has(email)) {
      contactId = caches.contactsByEmail.get(email)!.id;
    } else if (phone && caches.contactsByPhone.has(phone)) {
      contactId = caches.contactsByPhone.get(phone)!.id;
    } else if (firstName || lastName) {
      const nameKey = `${firstName}|||${lastName}`;
      if (caches.contactsByName.has(nameKey)) {
        contactId = caches.contactsByName.get(nameKey)!.id;
      }
    }

    if (!contactId) {
      const contactKey = email || phone || `${firstName}|||${lastName}`;
      const displayName = `${firstName} ${lastName}`.trim() || 'Unknown';

      if (!newContacts.has(contactKey)) {
        newContacts.set(contactKey, {
          email,
          phone: phone || undefined,
          firstName: firstName || 'Unknown',
          lastName: lastName || '',
          displayName,
        });

        if (email && !caches.usersByEmail.has(email)) {
          newUsers.add(email);
        }
      }
    }

    // Find or mark category for creation
    let categoryId: number | undefined;
    if (categoryName) {
      if (caches.categoriesByName.has(categoryName)) {
        categoryId = caches.categoriesByName.get(categoryName)!.id;
      } else if (!newCategories.has(categoryName)) {
        newCategories.add(categoryName);
      }
    }

    pledgePaymentMetadata.push({
      contactId,
      categoryId,
      solicitorId: undefined,
      amount,
      currency,
      receivedDate,
      paymentMethod: 'card', // Default to card
      notes: notes || `Imported pledge and payment`,
      row,
    });
  }

  console.log(`  📊 Analysis complete:`);
  console.log(`    - New users needed: ${newUsers.size}`);
  console.log(`    - New contacts needed: ${newContacts.size}`);
  console.log(`    - New categories needed: ${newCategories.size}`);
  console.log(`    - New solicitor contacts needed: ${newSolicitorContacts.size}\n`);

  // ============ Phase 2: Create missing records ============
  console.log('🏗️  Phase 2: Creating missing records...');

  if (newUsers.size > 0) {
    console.log(`  👤 Creating ${newUsers.size} users...`);
    const createdUsers = await batchCreateUsers(Array.from(newUsers));
    createdUsers.forEach(u => caches.usersByEmail.set(u.email, u));
  }

  if (newContacts.size > 0) {
    console.log(`  📇 Creating ${newContacts.size} contacts...`);
    const createdContacts = await batchCreateContacts(Array.from(newContacts.values()));
    createdContacts.forEach(c => {
      if (c.email) caches.contactsByEmail.set(c.email, c);
      if (c.phone) caches.contactsByPhone.set(c.phone, c);
      caches.contactsByName.set(`${c.firstName}|||${c.lastName}`, c);
    });
  }

  if (newCategories.size > 0) {
    console.log(`  🎯 Creating ${newCategories.size} categories...`);
    const createdCategories = await batchCreateCategories(Array.from(newCategories));
    createdCategories.forEach(c => caches.categoriesByName.set(c.name, c));
  }

  // ============ Phase 3: Resolve relationships ============
  console.log('\n🔗 Phase 3: Resolving relationships...');

  for (const metadata of pledgePaymentMetadata) {
    const row = metadata.row;
    const firstName = (row['First Name'] || '').trim();
    const lastName = (row['Last Name'] || '').trim();
    const phone = (row['Phone'] || '').trim();
    const email = cleanEmail(row['Email']);
    const categoryName = (row['Category'] || '').trim() || 'general donation';

    // Resolve contact
    if (!metadata.contactId) {
      if (email && caches.contactsByEmail.has(email)) {
        metadata.contactId = caches.contactsByEmail.get(email)!.id;
      } else if (phone && caches.contactsByPhone.has(phone)) {
        metadata.contactId = caches.contactsByPhone.get(phone)!.id;
      } else {
        const nameKey = `${firstName}|||${lastName}`;
        if (caches.contactsByName.has(nameKey)) {
          metadata.contactId = caches.contactsByName.get(nameKey)!.id;
        }
      }
    }

    // Resolve category
    if (categoryName && !metadata.categoryId) {
      metadata.categoryId = caches.categoriesByName.get(categoryName)?.id;
    }
  }

  console.log('✓ All relationships resolved\n');

  // ============ Phase 4: Create pledges and payments ============
  console.log('💰 Phase 4: Creating pledges and payments...');

  const pledgesToCreate: any[] = [];
  const paymentsToCreate: any[] = [];
  let successLog: any[] = [];
  let errorLog: any[] = [];

  for (const metadata of pledgePaymentMetadata) {
    try {
      if (!metadata.contactId) {
        throw new Error('Contact ID not resolved');
      }

      const row = metadata.row;

      // Calculate USD amount (exchange rate is 1 for USD)
      const exchangeRate = 1.0;
      const amountUsd = metadata.amount * exchangeRate;

      // Create pledge
      const pledgeData = {
        contactId: metadata.contactId,
        categoryId: metadata.categoryId || null,
        pledgeDate: metadata.receivedDate,
        description: metadata.notes,
        originalAmount: metadata.amount.toFixed(2),
        currency: metadata.currency,
        totalPaid: metadata.amount.toFixed(2),
        balance: '0.00',
        originalAmountUsd: amountUsd.toFixed(2),
        totalPaidUsd: amountUsd.toFixed(2),
        exchangeRate: exchangeRate.toFixed(4),
        balanceUsd: '0.00',
        isActive: true,
        notes: metadata.notes,
      };

      pledgesToCreate.push(pledgeData);

      // Create payment
      const paymentData = {
        pledgeId: undefined, // Will set after pledge creation
        payerContactId: metadata.contactId,
        amount: metadata.amount.toFixed(2),
        currency: metadata.currency,
        amountUsd: amountUsd.toFixed(2),
        exchangeRate: exchangeRate.toFixed(4),
        paymentDate: metadata.receivedDate,
        receivedDate: metadata.receivedDate,
        paymentMethod: metadata.paymentMethod,
        paymentStatus: 'completed',
        notes: metadata.notes,
      };

      paymentsToCreate.push(paymentData);

      successLog.push({
        firstName: row['First Name'],
        lastName: row['Last Name'],
        email: row['Email'],
        phone: row['Phone'],
        category: row['Category'] || 'general donation',
        amount: metadata.amount.toFixed(2),
        currency: metadata.currency,
        amountUsd: amountUsd.toFixed(2),
        date: metadata.receivedDate,
        paymentMethod: metadata.paymentMethod,
        contactId: metadata.contactId,
        categoryId: metadata.categoryId,
      });
    } catch (err: any) {
      const row = metadata.row;
      errorLog.push({
        firstName: row['First Name'],
        lastName: row['Last Name'],
        email: row['Email'],
        phone: row['Phone'],
        category: row['Category'] || 'general donation',
        amount: metadata.amount.toFixed(2),
        currency: metadata.currency,
        date: metadata.receivedDate,
        error: String(err?.message || err),
      });
    }
  }

  // Batch insert pledges
  console.log(`  🧾 Inserting ${pledgesToCreate.length} pledges in batches...`);
  const createdPledges: any[] = [];
  for (let i = 0; i < pledgesToCreate.length; i += BATCH_SIZE) {
    const batch = pledgesToCreate.slice(i, i + BATCH_SIZE);
    const created = await db.insert(pledge).values(batch).returning();
    createdPledges.push(...created);
    console.log(`    ✓ Pledges batch ${Math.floor(i / BATCH_SIZE) + 1}: ${created.length} records`);
  }

  // Set pledgeId in payments
  paymentsToCreate.forEach((payment, index) => {
    payment.pledgeId = createdPledges[index].id;
  });

  // Batch insert payments
  console.log(`  💳 Inserting ${paymentsToCreate.length} payments in batches...`);
  for (let i = 0; i < paymentsToCreate.length; i += BATCH_SIZE) {
    const batch = paymentsToCreate.slice(i, i + BATCH_SIZE);
    await db.insert(payment).values(batch);
    console.log(`    ✓ Payments batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} records`);
  }

  // Summary
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║              SEED SUMMARY              ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`📊 Total rows processed: ${allRows.length}`);
  console.log(`🧾 Pledges:     ${pledgesToCreate.length}`);
  console.log(`💳 Payments:   ${paymentsToCreate.length}`);
  console.log(`✅ Successful imports:   ${successLog.length}`);
  console.log(`❌ Failed imports:       ${errorLog.length}`);

  // Write export CSVs
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve('./data/exports');
  const successPath = path.join(outDir, `success-pledges-payments-${ts}.csv`);
  const failedPath = path.join(outDir, `failed-pledges-payments-${ts}.csv`);

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
