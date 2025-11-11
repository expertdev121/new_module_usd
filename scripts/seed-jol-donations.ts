// scripts/seed-ghl-donations.ts
import 'dotenv/config';
import Papa from 'papaparse';

process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-sweet-shadow-a95u1c5c-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require'

import { db } from '@/lib/db';
import {
  user,
  contact,
  campaign,
  manualDonation,
  solicitor,
  bonusRule,
} from '@/lib/db/schema';

import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcryptjs';

// ---------- Config ----------
const LOCATION_ID = 'E7yO96aiKmYvsbU2tRzc';
const CSV_PATH = process.env.GHL_DONATIONS_CSV || './data/data (33) - Export.csv';
const BATCH_SIZE = 500;
const DEFAULT_PAYMENT_METHOD = 'Card';

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

  // Handle formats like "Tuesday, September 25, 2012"
  let candidate = input.trim();
  
  // Remove day of week if present
  candidate = candidate.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/i, '');

  const d = new Date(candidate);
  return isNaN(d.getTime()) ? todayIso : d.toISOString().slice(0, 10);
}

function splitNameParts(donorName?: string): { firstName: string; lastName: string } {
  if (!donorName) return { firstName: 'Unknown', lastName: '' };

  const cleaned = donorName.trim();
  
  // Handle titles
  const withoutTitle = cleaned.replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Rabbi)\s+/i, '');
  
  const parts = withoutTitle.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  
  return { 
    firstName: parts[0], 
    lastName: parts.slice(1).join(' ') 
  };
}

function cleanEmail(raw?: string): string | undefined {
  if (!raw) return undefined;

  let e = raw.replace(/\s+/g, '').trim().toLowerCase();

  // Filter out fake emails
  if (e.includes('fake999email') || e.includes('fake_email')) {
    return undefined;
  }

  if (e.includes(',')) e = e.split(',')[0];
  if (e.includes(';')) e = e.split(';')[0];

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return e;
  }

  return undefined;
}

function cleanPhone(raw?: string): string | undefined {
  if (!raw) return undefined;
  
  const cleaned = String(raw).replace(/[^0-9]/g, '');
  
  // Check if it's a valid length (at least 10 digits)
  if (cleaned.length >= 10) {
    return cleaned;
  }
  
  return undefined;
}

function cleanAddress(raw?: string): string | undefined {
  if (!raw) return undefined;
  
  const cleaned = raw.trim();
  
  // Filter out invalid addresses
  if (cleaned === '0' || cleaned === '' || cleaned.toLowerCase() === 'unknown') {
    return undefined;
  }
  
  return cleaned;
}

type Row = {
  'GHL Data'?: string;
  'Contact Id'?: string;
  'Record ID'?: string;
  'Donor'?: string;
  'Tags'?: string;
  'Transaction Date'?: string;
  'Email'?: string;
  'Address (full)'?: string;
  'Phone Number'?: string;
  'City'?: string;
  'State'?: string;
  'Country'?: string;
  'Event Code'?: string;
  'Organization'?: string;
  'Total Donation Amount'?: string;
  [k: string]: any;
};

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

// ============ Pre-load data into memory ============
async function preloadData() {
  console.log('📥 Pre-loading existing data into memory...');
  const start = Date.now();

  const [contacts, campaigns, solicitors, users] = await Promise.all([
    db.select().from(contact).execute(),
    db.select().from(campaign).execute(),
    db.select().from(solicitor).execute(),
    db.select().from(user).execute(),
  ]);

  const contactsByEmail = new Map(contacts.filter(c => c.email).map(c => [c.email!, c]));
  const contactsByRecordId = new Map(contacts.filter(c => c.recordId).map(c => [c.recordId!, c]));
  const contactsByGhlId = new Map(contacts.filter(c => c.ghlContactId).map(c => [c.ghlContactId!, c]));
  const contactsByName = new Map(
    contacts.map(c => [`${c.firstName}|||${c.lastName}`, c])
  );
  const campaignsByName = new Map(campaigns.map(c => [c.name, c]));
  const solicitorsByContactId = new Map(solicitors.map(s => [s.contactId, s]));
  const usersByEmail = new Map(users.map(u => [u.email, u]));

  console.log(`✓ Loaded in ${Date.now() - start}ms:`);
  console.log(`  - ${contacts.length} contacts`);
  console.log(`  - ${campaigns.length} campaigns`);
  console.log(`  - ${solicitors.length} solicitors`);
  console.log(`  - ${users.length} users\n`);

  return {
    contactsByEmail,
    contactsByRecordId,
    contactsByGhlId,
    contactsByName,
    campaignsByName,
    solicitorsByContactId,
    usersByEmail,
  };
}

// ============ BATCH PROCESSORS ============
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
  ghlContactId?: string;
  recordId?: string;
  email?: string;
  displayName: string;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: string;
}>) {
  if (contactData.length === 0) return [];

  const allCreated: any[] = [];
  const batchSize = 200;

  for (let i = 0; i < contactData.length; i += batchSize) {
    const batch = contactData.slice(i, i + batchSize);
    const values = batch.map(c => ({
      ghlContactId: c.ghlContactId,
      recordId: c.recordId,
      locationId: LOCATION_ID,
      firstName: c.firstName,
      lastName: c.lastName,
      displayName: c.displayName,
      email: c.email,
      phone: c.phone,
      address: c.address,
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
      description: `Imported from GHL: ${name}`,
      status: 'active' as const,
      locationId: LOCATION_ID,
    }));

    const created = await db.insert(campaign).values(values).returning();
    allCreated.push(...created);
    console.log(`  ✓ Created campaigns batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
  }

  return allCreated;
}

async function batchCreateSolicitors(solicitorData: Array<{ contactId: number; name: string }>) {
  if (solicitorData.length === 0) return [];

  const allCreated: any[] = [];
  const batchSize = 100;

  for (let i = 0; i < solicitorData.length; i += batchSize) {
    const batch = solicitorData.slice(i, i + batchSize);
    const values = batch.map(s => ({
      contactId: s.contactId,
      solicitorCode: `SOL-${Date.now()}-${s.contactId}`,
      status: 'active' as const,
      commissionRate: '10.00',
      hireDate: new Date().toISOString().slice(0, 10),
      locationId: LOCATION_ID,
      notes: 'Created from GHL donations import',
    }));

    const created = await db.insert(solicitor).values(values).returning();
    allCreated.push(...created);
    console.log(`  ✓ Created solicitors batch ${Math.floor(i / batchSize) + 1}: ${created.length} records`);
  }

  return allCreated;
}

// ============ MAIN LOGIC ============
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║      GHL DONATIONS SEEDER (FAST)       ║');
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

  const caches = await preloadData();

  const allRows: Row[] = parseCSV(CSV_PATH);

  console.log(`📦 CSV: ${path.resolve(CSV_PATH)}`);
  console.log(`✓ Rows loaded: ${allRows.length}\n`);

  // ============ PHASE 1: Analyzing data ============
  console.log('🔍 Phase 1: Analyzing data...');
  
  const newUsers = new Set<string>();
  const newContacts = new Map<string, {
    ghlContactId?: string;
    recordId?: string;
    email?: string;
    displayName: string;
    firstName: string;
    lastName: string;
    phone?: string;
    address?: string;
  }>();
  const newCampaigns = new Set<string>();
  const newSolicitorContacts = new Map<string, string>();
  
  const donationMetadata = new Map<string, {
    contactId?: number;
    campaignId?: number | null;
    solicitorId?: number | null;
    amount: number;
    date: string;
    row: Row;
  }>();

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const donationKey = `donation_${i}`;
    
    const donorName = (row['Donor'] || '').trim();
    const email = cleanEmail(row['Email']);
    const recordId = (row['Record ID'] || '').trim();
    const ghlContactId = (row['Contact Id'] || '').trim();
    const phone = cleanPhone(row['Phone Number']);
    const address = cleanAddress(row['Address (full)']);
    const eventCode = (row['Event Code'] || '').trim();
    const organization = (row['Organization'] || '').trim();
    const amount = toNumber(row['Total Donation Amount']);
    const transactionDate = normalizeDate(row['Transaction Date']);

    // Skip rows with no donation amount
    if (amount <= 0) {
      continue;
    }

    const names = splitNameParts(donorName);
    
    // Find or mark contact for creation
    let contactId: number | undefined;
    
    if (email && caches.contactsByEmail.has(email)) {
      contactId = caches.contactsByEmail.get(email)!.id;
    } else if (recordId && caches.contactsByRecordId.has(recordId)) {
      contactId = caches.contactsByRecordId.get(recordId)!.id;
    } else if (ghlContactId && caches.contactsByGhlId.has(ghlContactId)) {
      contactId = caches.contactsByGhlId.get(ghlContactId)!.id;
    } else {
      const nameKey = `${names.firstName}|||${names.lastName}`;
      if (caches.contactsByName.has(nameKey)) {
        contactId = caches.contactsByName.get(nameKey)!.id;
      }
    }

    if (!contactId) {
      const contactKey = email || recordId || ghlContactId || `${names.firstName}|||${names.lastName}`;
      
      if (!newContacts.has(contactKey)) {
        newContacts.set(contactKey, {
          ghlContactId: ghlContactId || undefined,
          recordId: recordId || undefined,
          email,
          displayName: donorName || `${names.firstName} ${names.lastName}`.trim(),
          firstName: names.firstName,
          lastName: names.lastName,
          phone,
          address,
        });

        if (email && !caches.usersByEmail.has(email)) {
          newUsers.add(email);
        }
      }
    }

    // Find or mark campaign for creation
    let campaignId: number | null = null;
    if (eventCode) {
      if (caches.campaignsByName.has(eventCode)) {
        campaignId = caches.campaignsByName.get(eventCode)!.id;
      } else if (!newCampaigns.has(eventCode)) {
        newCampaigns.add(eventCode);
      }
    }

    // Handle solicitor (organization field)
    let solicitorId: number | null = null;
    if (organization) {
      if (caches.contactsByName.has(`${organization}|||`)) {
        const solContact = caches.contactsByName.get(`${organization}|||`)!;
        solicitorId = caches.solicitorsByContactId.get(solContact.id)?.id || null;
      } else if (!newSolicitorContacts.has(organization)) {
        newSolicitorContacts.set(organization, organization);
      }
    }

    donationMetadata.set(donationKey, {
      contactId,
      campaignId,
      solicitorId,
      amount,
      date: transactionDate,
      row,
    });
  }

  console.log(`  📊 Analysis complete:`);
  console.log(`    - New users needed: ${newUsers.size}`);
  console.log(`    - New contacts needed: ${newContacts.size}`);
  console.log(`    - New campaigns needed: ${newCampaigns.size}`);
  console.log(`    - New solicitor contacts needed: ${newSolicitorContacts.size}`);
  console.log(`    - Valid donations to import: ${donationMetadata.size}\n`);

  // ============ PHASE 2: Creating missing records ============
  console.log('🏗️  Phase 2: Creating missing records...');

  if (newUsers.size > 0) {
    console.log(`  👤 Creating ${newUsers.size} users...`);
    const createdUsers = await batchCreateUsers(Array.from(newUsers));
    createdUsers?.forEach(u => caches.usersByEmail.set(u.email, u));
  }

  if (newContacts.size > 0) {
    console.log(`  📇 Creating ${newContacts.size} contacts...`);
    const createdContacts = await batchCreateContacts(Array.from(newContacts.values()));
    createdContacts.forEach(c => {
      if (c.email) caches.contactsByEmail.set(c.email, c);
      if (c.recordId) caches.contactsByRecordId.set(c.recordId, c);
      if (c.ghlContactId) caches.contactsByGhlId.set(c.ghlContactId, c);
      caches.contactsByName.set(`${c.firstName}|||${c.lastName}`, c);
    });
  }

  if (newCampaigns.size > 0) {
    console.log(`  🎯 Creating ${newCampaigns.size} campaigns...`);
    const createdCampaigns = await batchCreateCampaigns(Array.from(newCampaigns));
    createdCampaigns.forEach(c => caches.campaignsByName.set(c.name, c));
  }

  if (newSolicitorContacts.size > 0) {
    console.log(`  👔 Creating ${newSolicitorContacts.size} solicitor contacts...`);
    const solicitorContactData = Array.from(newSolicitorContacts.values()).map(name => {
      const names = splitNameParts(name);
      return {
        displayName: name,
        firstName: names.firstName,
        lastName: names.lastName,
      };
    });
    const createdSolicitorContacts = await batchCreateContacts(solicitorContactData);
    createdSolicitorContacts.forEach(c => {
      caches.contactsByName.set(`${c.firstName}|||${c.lastName}`, c);
    });

    // Create solicitor records
    const solicitorDataToCreate = createdSolicitorContacts.map(c => ({
      contactId: c.id,
      name: c.displayName,
    }));

    console.log(`  💼 Creating ${solicitorDataToCreate.length} solicitors...`);
    const createdSolicitors = await batchCreateSolicitors(solicitorDataToCreate);
    createdSolicitors.forEach(s => caches.solicitorsByContactId.set(s.contactId, s));
  }

  // ============ PHASE 3: Resolving relationships ============
  console.log('\n🔗 Phase 3: Resolving relationships...');
  
  for (const [key, metadata] of donationMetadata.entries()) {
    const row = metadata.row;
    const email = cleanEmail(row['Email']);
    const recordId = (row['Record ID'] || '').trim();
    const ghlContactId = (row['Contact Id'] || '').trim();
    const donorName = (row['Donor'] || '').trim();
    const eventCode = (row['Event Code'] || '').trim();
    const organization = (row['Organization'] || '').trim();

    if (!metadata.contactId) {
      if (email && caches.contactsByEmail.has(email)) {
        metadata.contactId = caches.contactsByEmail.get(email)!.id;
      } else if (recordId && caches.contactsByRecordId.has(recordId)) {
        metadata.contactId = caches.contactsByRecordId.get(recordId)!.id;
      } else if (ghlContactId && caches.contactsByGhlId.has(ghlContactId)) {
        metadata.contactId = caches.contactsByGhlId.get(ghlContactId)!.id;
      } else {
        const names = splitNameParts(donorName);
        const nameKey = `${names.firstName}|||${names.lastName}`;
        if (caches.contactsByName.has(nameKey)) {
          metadata.contactId = caches.contactsByName.get(nameKey)!.id;
        }
      }
    }

    if (eventCode && !metadata.campaignId) {
      metadata.campaignId = caches.campaignsByName.get(eventCode)?.id || null;
    }

    if (organization && !metadata.solicitorId) {
      const nameKey = `${organization}|||`;
      const solContact = caches.contactsByName.get(nameKey);
      if (solContact) {
        metadata.solicitorId = caches.solicitorsByContactId.get(solContact.id)?.id || null;
      }
    }
  }

  console.log('✓ All relationships resolved\n');

  // ============ PHASE 3.5: Create Bonus Rules ============
  console.log('💰 Phase 3.5: Creating bonus rules for solicitors...');

  const bonusRulesToCreate: Array<{ solicitorId: number }> = [];
  const seenSolicitorIds = new Set<number>();

  for (const [key, metadata] of donationMetadata.entries()) {
    if (metadata.solicitorId && !seenSolicitorIds.has(metadata.solicitorId)) {
      bonusRulesToCreate.push({ solicitorId: metadata.solicitorId });
      seenSolicitorIds.add(metadata.solicitorId);
    }
  }

  const bonusRuleMap = new Map<number, number>();

  if (bonusRulesToCreate.length > 0) {
    console.log(`  📋 Creating ${bonusRulesToCreate.length} bonus rules...`);
    
    for (let i = 0; i < bonusRulesToCreate.length; i += 100) {
      const batch = bonusRulesToCreate.slice(i, i + 100);
      const values = batch.map(br => ({
        solicitorId: br.solicitorId,
        ruleName: 'Default Import Rule',
        bonusPercentage: '10.00',
        paymentType: 'both' as const,
        effectiveFrom: new Date().toISOString().slice(0, 10),
        isActive: true,
        priority: 1,
        notes: 'Auto-created during GHL data import',
      }));

      const created = await db.insert(bonusRule).values(values).returning();
      created.forEach((br, idx) => {
        bonusRuleMap.set(batch[idx].solicitorId, br.id);
      });
      
      console.log(`    ✓ Batch ${Math.floor(i / 100) + 1}: ${created.length} bonus rules`);
    }
  }

  console.log('✓ All bonus rules created\n');

  // ============ PHASE 4: Creating manual donations ============
  console.log('💰 Phase 4: Creating manual donations...');

  const manualDonationsToCreate: any[] = [];
  let successLog: any[] = [];
  let errorLog: any[] = [];

  for (const [key, metadata] of donationMetadata.entries()) {
    try {
      if (!metadata.contactId) {
        throw new Error('Contact ID not resolved');
      }

      const row = metadata.row;
      const eventCode = (row['Event Code'] || '').trim();

      manualDonationsToCreate.push({
        contactId: metadata.contactId,
        amount: metadata.amount.toFixed(2),
        currency: 'USD',
        amountUsd: metadata.amount.toFixed(2),
        exchangeRate: '1.00',
        paymentDate: metadata.date,
        receivedDate: metadata.date,
        checkDate: null,
        accountId: null,
        campaignId: metadata.campaignId,
        paymentMethod: DEFAULT_PAYMENT_METHOD,
        methodDetail: null,
        paymentStatus: 'completed',
        referenceNumber: null,
        checkNumber: null,
        receiptNumber: null,
        receiptType: null,
        receiptIssued: false,
        solicitorId: metadata.solicitorId,
        bonusPercentage: metadata.solicitorId ? '10.00' : null,
        bonusAmount: metadata.solicitorId ? (metadata.amount * 0.1).toFixed(2) : null,
        bonusRuleId: metadata.solicitorId ? bonusRuleMap.get(metadata.solicitorId) || null : null,
        notes: `Imported from GHL: ${eventCode || 'No campaign'}`,
      });

      successLog.push({
        donationKey: key,
        donor: (row['Donor'] || '').trim(),
        email: cleanEmail(row['Email']) || '',
        recordId: (row['Record ID'] || '').trim(),
        ghlContactId: (row['Contact Id'] || '').trim(),
        campaign: eventCode,
        organization: (row['Organization'] || '').trim(),
        amount: metadata.amount.toFixed(2),
        date: metadata.date,
        contactId: metadata.contactId,
        campaignId: metadata.campaignId,
        solicitorId: metadata.solicitorId,
      });
    } catch (err: any) {
      const row = metadata.row;
      errorLog.push({
        donationKey: key,
        donor: (row['Donor'] || '').trim(),
        email: cleanEmail(row['Email']) || '',
        recordId: (row['Record ID'] || '').trim(),
        campaign: (row['Event Code'] || '').trim(),
        amount: metadata.amount.toFixed(2),
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
  console.log(`📊 Total CSV rows:       ${allRows.length}`);
  console.log(`🧾 Manual donations:     ${manualDonationsToCreate.length}`);
  console.log(`📋 Bonus rules created:  ${bonusRulesToCreate.length}`);
  console.log(`✅ Successful imports:   ${successLog.length}`);
  console.log(`❌ Failed imports:       ${errorLog.length}`);

  // Write export CSVs
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve('./data/exports');
  const successPath = path.join(outDir, `ghl-success-${ts}.csv`);
  const failedPath = path.join(outDir, `ghl-failed-${ts}.csv`);

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