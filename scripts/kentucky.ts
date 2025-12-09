// scripts/seed-donor-data.ts
import 'dotenv/config';
import Papa from 'papaparse';

process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-late-term-a9gfvfb7-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require'

import { db } from '@/lib/db';
import {
  user,
  contact,
  campaign,
  manualDonation,
  pledge,
  payment,
  category,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcryptjs';

// ---------- Config ----------
const LOCATION_ID = 'dGBms4fIfi6WTZbCJeHR';
const CSV_PATH = process.env.DONOR_CSV || './data/kentucky.csv';
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

  let candidate = input.trim();
  
  // Handle "DD Month YYYY" format (e.g., "21 February 2023")
  if (/^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/.test(candidate)) {
    const monthMap: { [key: string]: string } = {
      january: '01', february: '02', march: '03', april: '04',
      may: '05', june: '06', july: '07', august: '08',
      september: '09', october: '10', november: '11', december: '12'
    };
    
    const parts = candidate.split(/\s+/);
    const day = parts[0].padStart(2, '0');
    const month = monthMap[parts[1].toLowerCase()];
    const year = parts[2];
    
    if (month) {
      candidate = `${year}-${month}-${day}`;
    }
  }
  
  // Handle M/D/YYYY format
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(candidate)) {
    const [month, day, year] = candidate.split('/');
    candidate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const d = new Date(candidate);
  return isNaN(d.getTime()) ? todayIso : d.toISOString().slice(0, 10);
}

function cleanEmail(raw?: string): string[] {
  if (!raw) return [];

  // Split by newline or comma to handle multiple emails
  const emails = raw.split(/[\n,]/).map(e => e.trim()).filter(Boolean);
  
  const cleaned: string[] = [];
  for (const email of emails) {
    let e = email.replace(/\s+/g, '').trim();
    
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      cleaned.push(e.toLowerCase());
    }
  }
  
  return cleaned;
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

  const [contacts, campaigns, categories, users] = await Promise.all([
    db.select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      email2: contact.email2,
      displayName: contact.displayName,
      phone: contact.phone,
    }).from(contact).execute(),
    db.select().from(campaign).execute(),
    db.select().from(category).execute(),
    db.select().from(user).execute(),
  ]);

  const contactsByEmail = new Map(contacts.filter(c => c.email).map(c => [c.email!, c]));
  const contactsByEmail2 = new Map(contacts.filter(c => c.email2).map(c => [c.email2!, c]));
  const contactsByPhone = new Map(contacts.filter(c => c.phone).map(c => [c.phone!, c]));
  const contactsByName = new Map(
    contacts.map(c => [`${c.firstName}|||${c.lastName}`, c])
  );
  const campaignsByName = new Map(campaigns.map(c => [c.name, c]));
  const categoriesByName = new Map(categories.map(c => [c.name, c]));
  const usersByEmail = new Map(users.map(u => [u.email, u]));

  console.log(`✓ Loaded in ${Date.now() - start}ms:`);
  console.log(`  - ${contacts.length} contacts`);
  console.log(`  - ${campaigns.length} campaigns`);
  console.log(`  - ${categories.length} categories`);
  console.log(`  - ${users.length} users\n`);

  return {
    contactsByEmail,
    contactsByEmail2,
    contactsByPhone,
    contactsByName,
    campaignsByName,
    categoriesByName,
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
  email2?: string;
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
      email2: c.email2,
      phone: c.phone,
    }));

    const created = await db.insert(contact).values(values).returning();
    allCreated.push(...created);
    console.log(`  ✓ Created contacts batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
  }

  return allCreated;
}

async function batchCreateCampaigns(campaignNames: string[]) {
  if (campaignNames.length === 0) return [];

  const allCreated: any[] = [];
  const batchSize = 200;

  for (let i = 0; i < campaignNames.length; i += batchSize) {
    const batch = campaignNames.slice(i, i + batchSize);
    const values = batch.map(name => ({
      name,
      description: `Imported from CSV: ${name}`,
      status: 'active' as const,
      locationId: LOCATION_ID,
    }));

    const created = await db.insert(campaign).values(values).returning();
    allCreated.push(...created);
    console.log(`  ✓ Created campaigns batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
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
      isActive: true,
      locationId: LOCATION_ID,
    }));

    const created = await db.insert(category).values(values).returning();
    allCreated.push(...created);
    console.log(`  ✓ Created categories batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
  }

  return allCreated;
}

// ============ Cleanup existing data ============
async function cleanupExistingData() {
  console.log('🧹 Checking for existing data for location...');
  
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

  try {
    await db.delete(manualDonation).where(eq(manualDonation.contactId, existingContacts[0].id));
    console.log(`  ✓ Cleaned manual donations`);

    await db.delete(payment).execute();
    console.log(`  ✓ Cleaned payments`);

    await db.delete(pledge).execute();
    console.log(`  ✓ Cleaned pledges`);

    await db.delete(campaign).where(eq(campaign.locationId, LOCATION_ID));
    console.log(`  ✓ Cleaned campaigns`);

    await db.delete(category).where(eq(category.locationId, LOCATION_ID));
    console.log(`  ✓ Cleaned categories`);

    await db.delete(user).where(eq(user.locationId, LOCATION_ID));
    console.log(`  ✓ Cleaned users`);

    await db.delete(contact).where(eq(contact.locationId, LOCATION_ID));
    console.log(`  ✓ Cleaned contacts and related records`);

    console.log('\n✅ Cleanup complete! Starting fresh import...\n');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  }
}

// ============ Main ============
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║      DONOR DATA SEEDER                 ║');
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
    email2?: string;
    phone?: string;
    firstName: string;
    lastName: string;
    displayName: string;
  }>();
  const newCampaigns = new Set<string>();
  const newCategories = new Set<string>();

  const donorMetadata: Array<{
    contactId?: number;
    campaignId?: number;
    categoryId?: number;
    pledgedAmount: number;
    paidAmount: number;
    manualDonation: number;
    receivedDate: string;
    currency: string;
    row: any;
  }> = [];

  for (const row of allRows) {
    const donorName = (row['Donor Name'] || '').trim();
    const emailsRaw = row['Email'] || '';
    const phone = (row['Phone'] || '').trim();
    const receivedDate = normalizeDate(row['received date']);
    const pledgedAmount = toNumber(row['Pledged']);
    const paidAmount = toNumber(row['Amount Paid On Pledge']);
    const manualDonation = toNumber(row['Manual donation']);
    const campaignName = (row['Campaign'] || '').trim();
    const currency = normalizeCurrency(row['Currency']);

    // Parse donor name (handle "Rabbi and Mrs. FirstName & LastName" format)
    let firstName = '';
    let lastName = '';
    
    if (donorName) {
      // Remove titles and honorifics
      let cleanName = donorName
        .replace(/^(Rabbi and Mrs\.|Rabbi|Mrs\.|Mr\.|Ms\.|Dr\.)\s*/i, '')
        .trim();
      
      // Handle "FirstName & LastName" or "FirstName LastName" format
      const parts = cleanName.split(/\s+/);
      
      if (parts.length >= 2) {
        // Find the last part as lastName
        lastName = parts[parts.length - 1];
        // Everything before (excluding &) as firstName
        firstName = parts.slice(0, -1).filter((p: string) => p !== '&').join(' ');
      } else {
        firstName = cleanName;
      }
    }

    const emails = cleanEmail(emailsRaw);
    const email = emails[0];
    const email2 = emails[1];

    // Find or mark contact for creation
    let contactId: number | undefined;
    if (email && caches.contactsByEmail.has(email)) {
      contactId = caches.contactsByEmail.get(email)!.id;
    } else if (email2 && caches.contactsByEmail2.has(email2)) {
      contactId = caches.contactsByEmail2.get(email2)!.id;
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
      const displayName = donorName || `${firstName} ${lastName}`.trim() || 'Unknown';
      
      if (!newContacts.has(contactKey)) {
        newContacts.set(contactKey, {
          email,
          email2,
          phone: phone || undefined,
          firstName: firstName || 'Unknown',
          lastName: lastName || '',
          displayName,
        });

        // Create users for all emails
        if (email && !caches.usersByEmail.has(email)) {
          newUsers.add(email);
        }
        if (email2 && !caches.usersByEmail.has(email2)) {
          newUsers.add(email2);
        }
      }
    }

    // Find or mark campaign for creation
    let campaignId: number | undefined;
    if (campaignName) {
      if (caches.campaignsByName.has(campaignName)) {
        campaignId = caches.campaignsByName.get(campaignName)!.id;
      } else if (!newCampaigns.has(campaignName)) {
        newCampaigns.add(campaignName);
      }
    }

    // Use default "Pledge" category for all pledges
    let categoryId: number | undefined;
    const defaultCategoryName = 'Pledge';
    if (caches.categoriesByName.has(defaultCategoryName)) {
      categoryId = caches.categoriesByName.get(defaultCategoryName)!.id;
    } else if (!newCategories.has(defaultCategoryName)) {
      newCategories.add(defaultCategoryName);
    }

    donorMetadata.push({
      contactId,
      campaignId,
      categoryId,
      pledgedAmount,
      paidAmount,
      manualDonation,
      receivedDate,
      currency,
      row,
    });
  }

  console.log(`  📊 Analysis complete:`);
  console.log(`    - New users needed: ${newUsers.size}`);
  console.log(`    - New contacts needed: ${newContacts.size}`);
  console.log(`    - New campaigns needed: ${newCampaigns.size}`);
  console.log(`    - New categories needed: ${newCategories.size}\n`);

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
      if (c.email2) caches.contactsByEmail2.set(c.email2, c);
      if (c.phone) caches.contactsByPhone.set(c.phone, c);
      caches.contactsByName.set(`${c.firstName}|||${c.lastName}`, c);
    });
  }

  if (newCampaigns.size > 0) {
    console.log(`  🎯 Creating ${newCampaigns.size} campaigns...`);
    const createdCampaigns = await batchCreateCampaigns(Array.from(newCampaigns));
    createdCampaigns.forEach(c => caches.campaignsByName.set(c.name, c));
  }

  if (newCategories.size > 0) {
    console.log(`  📂 Creating ${newCategories.size} categories...`);
    const createdCategories = await batchCreateCategories(Array.from(newCategories));
    createdCategories.forEach(c => caches.categoriesByName.set(c.name, c));
  }

  // ============ Phase 3: Resolve relationships ============
  console.log('\n🔗 Phase 3: Resolving relationships...');
  
  for (const metadata of donorMetadata) {
    const row = metadata.row;
    const donorName = (row['Donor Name'] || '').trim();
    const emailsRaw = row['Email'] || '';
    const phone = (row['Phone'] || '').trim();
    const campaignName = (row['Campaign'] || '').trim();

    // Parse name again
    let firstName = '';
    let lastName = '';
    
    if (donorName) {
      let cleanName = donorName
        .replace(/^(Rabbi and Mrs\.|Rabbi|Mrs\.|Mr\.|Ms\.|Dr\.)\s*/i, '')
        .trim();
      
      const parts = cleanName.split(/\s+/);
      
      if (parts.length >= 2) {
        lastName = parts[parts.length - 1];
        firstName = parts.slice(0, -1).filter((p: string) => p !== '&').join(' ');
      } else {
        firstName = cleanName;
      }
    }

    const emails = cleanEmail(emailsRaw);
    const email = emails[0];
    const email2 = emails[1];

    // Resolve contact
    if (!metadata.contactId) {
      if (email && caches.contactsByEmail.has(email)) {
        metadata.contactId = caches.contactsByEmail.get(email)!.id;
      } else if (email2 && caches.contactsByEmail2.has(email2)) {
        metadata.contactId = caches.contactsByEmail2.get(email2)!.id;
      } else if (phone && caches.contactsByPhone.has(phone)) {
        metadata.contactId = caches.contactsByPhone.get(phone)!.id;
      } else {
        const nameKey = `${firstName}|||${lastName}`;
        if (caches.contactsByName.has(nameKey)) {
          metadata.contactId = caches.contactsByName.get(nameKey)!.id;
        }
      }
    }

    // Resolve campaign
    if (campaignName && !metadata.campaignId) {
      metadata.campaignId = caches.campaignsByName.get(campaignName)?.id;
    }

    // Resolve category - use default "Pledge" category
    if (!metadata.categoryId) {
      const defaultCategoryName = 'Pledge';
      metadata.categoryId = caches.categoriesByName.get(defaultCategoryName)?.id;
    }
  }

  console.log('✓ All relationships resolved\n');

  // ============ Phase 4: Create pledges, payments, and manual donations ============
  console.log('💰 Phase 4: Creating pledges, payments, and manual donations...');

  const pledgesToCreate: any[] = [];
  const paymentsToCreate: any[] = [];
  const manualDonationsToCreate: any[] = [];
  let successLog: any[] = [];
  let errorLog: any[] = [];

  for (const metadata of donorMetadata) {
    try {
      if (!metadata.contactId) {
        throw new Error('Contact ID not resolved');
      }

      const row = metadata.row;
      const exchangeRate = 1.0; // Default exchange rate

      // Create pledge if pledged amount exists
      if (metadata.pledgedAmount > 0) {
        const pledgeAmountUsd = metadata.pledgedAmount * exchangeRate;
        const balance = Math.max(0, metadata.pledgedAmount - metadata.paidAmount);
        const balanceUsd = balance * exchangeRate;

        pledgesToCreate.push({
          contactId: metadata.contactId,
          categoryId: metadata.categoryId || null,
          relationshipId: null,
          pledgeDate: metadata.receivedDate,
          description: `Pledge from ${row['Donor Name']}`,
          originalAmount: metadata.pledgedAmount.toFixed(2),
          currency: metadata.currency,
          totalPaid: metadata.paidAmount.toFixed(2),
          balance: balance.toFixed(2),
          originalAmountUsd: pledgeAmountUsd.toFixed(2),
          totalPaidUsd: (metadata.paidAmount * exchangeRate).toFixed(2),
          exchangeRate: exchangeRate.toFixed(2),
          balanceUsd: balanceUsd.toFixed(2),
          campaignCode: row['Campaign'] || null,
          isActive: true,
          notes: `Imported from CSV${metadata.campaignId ? ` - Campaign: ${row['Campaign']}` : ''}`,
        });
      }

      // Create manual donation if present
      if (metadata.manualDonation > 0) {
        const donationAmountUsd = metadata.manualDonation * exchangeRate;

        manualDonationsToCreate.push({
          contactId: metadata.contactId,
          amount: metadata.manualDonation.toFixed(2),
          currency: metadata.currency,
          amountUsd: donationAmountUsd.toFixed(2),
          exchangeRate: exchangeRate.toFixed(4),
          paymentDate: metadata.receivedDate,
          receivedDate: metadata.receivedDate,
          checkDate: null,
          accountId: null,
          campaignId: metadata.campaignId || null,
          paymentMethod: 'Cash',
          methodDetail: null,
          paymentStatus: 'completed',
          referenceNumber: null,
          checkNumber: null,
          receiptNumber: null,
          receiptType: null,
          receiptIssued: false,
          solicitorId: null,
          bonusPercentage: '0.00',
          bonusAmount: '0.00',
          bonusRuleId: null,
          notes: `Manual donation - Imported from CSV`,
        });
      }

      successLog.push({
        donorName: row['Donor Name'],
        email: row['Email'],
        phone: row['Phone'],
        campaign: row['Campaign'],
        pledged: metadata.pledgedAmount.toFixed(2),
        paidOnPledge: metadata.paidAmount.toFixed(2),
        manualDonation: metadata.manualDonation.toFixed(2),
        currency: metadata.currency,
        date: metadata.receivedDate,
        contactId: metadata.contactId,
        campaignId: metadata.campaignId,
        categoryId: metadata.categoryId,
      });
    } catch (err: any) {
      const row = metadata.row;
      errorLog.push({
        donorName: row['Donor Name'],
        email: row['Email'],
        phone: row['Phone'],
        campaign: row['Campaign'],
        pledged: metadata.pledgedAmount.toFixed(2),
        paidOnPledge: metadata.paidAmount.toFixed(2),
        manualDonation: metadata.manualDonation.toFixed(2),
        date: metadata.receivedDate,
        error: String(err?.message || err),
      });
    }
  }

  // Batch insert pledges
  if (pledgesToCreate.length > 0) {
    console.log(`  📋 Inserting ${pledgesToCreate.length} pledges in batches...`);
    const createdPledges: any[] = [];
    for (let i = 0; i < pledgesToCreate.length; i += BATCH_SIZE) {
      const batch = pledgesToCreate.slice(i, i + BATCH_SIZE);
      const created = await db.insert(pledge).values(batch).returning();
      createdPledges.push(...created);
      console.log(`    ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} pledges`);
    }

    // Create payments for pledges with paid amounts
    console.log(`  💵 Creating payments for pledges...`);
    let paymentCount = 0;
    for (let i = 0; i < createdPledges.length; i++) {
      const pledgeData = pledgesToCreate[i];
      const createdPledge = createdPledges[i];
      const metadata = donorMetadata[i];

      if (metadata.paidAmount > 0) {
        const exchangeRate = 1.0;
        const amountUsd = metadata.paidAmount * exchangeRate;

        paymentsToCreate.push({
          pledgeId: createdPledge.id,
          paymentPlanId: null,
          installmentScheduleId: null,
          relationshipId: null,
          payerContactId: null,
          isThirdPartyPayment: false,
          amount: metadata.paidAmount.toFixed(2),
          currency: metadata.currency,
          amountUsd: amountUsd.toFixed(2),
          exchangeRate: exchangeRate.toFixed(4),
          amountInPledgeCurrency: metadata.paidAmount.toFixed(2),
          pledgeCurrencyExchangeRate: exchangeRate.toFixed(4),
          amountInPlanCurrency: null,
          planCurrencyExchangeRate: null,
          paymentDate: metadata.receivedDate,
          receivedDate: metadata.receivedDate,
          checkDate: null,
          account: null,
          paymentMethod: 'Cash',
          methodDetail: null,
          paymentStatus: 'completed',
          referenceNumber: null,
          checkNumber: null,
          receiptNumber: null,
          receiptType: null,
          receiptIssued: false,
          solicitorId: null,
          bonusPercentage: '0.00',
          bonusAmount: '0.00',
          bonusRuleId: null,
          notes: `Payment on pledge - Imported from CSV`,
        });
        paymentCount++;
      }
    }

    if (paymentsToCreate.length > 0) {
      for (let i = 0; i < paymentsToCreate.length; i += BATCH_SIZE) {
        const batch = paymentsToCreate.slice(i, i + BATCH_SIZE);
        await db.insert(payment).values(batch);
        console.log(`    ✓ Payment batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} payments`);
      }
    }
  }

  // Batch insert manual donations
  if (manualDonationsToCreate.length > 0) {
    console.log(`  🧾 Inserting ${manualDonationsToCreate.length} manual donations in batches...`);
    for (let i = 0; i < manualDonationsToCreate.length; i += BATCH_SIZE) {
      const batch = manualDonationsToCreate.slice(i, i + BATCH_SIZE);
      await db.insert(manualDonation).values(batch);
      console.log(`    ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} donations`);
    }
  }

  // Summary
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║              SEED SUMMARY              ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`📊 Total rows processed:     ${allRows.length}`);
  console.log(`📋 Pledges created:          ${pledgesToCreate.length}`);
  console.log(`💵 Payments created:         ${paymentsToCreate.length}`);
  console.log(`🧾 Manual donations created: ${manualDonationsToCreate.length}`);
  console.log(`✅ Successful imports:       ${successLog.length}`);
  console.log(`❌ Failed imports:           ${errorLog.length}`);

  // Write export CSVs
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve('./data/exports');
  const successPath = path.join(outDir, `success-donors-${ts}.csv`);
  const failedPath = path.join(outDir, `failed-donors-${ts}.csv`);

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