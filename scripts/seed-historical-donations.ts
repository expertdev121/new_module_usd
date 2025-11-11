// scripts/seed-historical-donations.ts
import 'dotenv/config';
import Papa from 'papaparse';

process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-sweet-shadow-a95u1c5c-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require'

import { db } from '@/lib/db';
import {
  user,
  contact,
  category,
  campaign,
  pledge,
  payment,
  manualDonation,
  solicitor,
  bonusRule,
  bonusCalculation,
} from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcryptjs';

// ---------- Config ----------
const LOCATION_ID = 'E7yO96aiKmYvsbU2tRzc';
const CSV_PATH = process.env.HISTORICAL_DONATIONS_CSV || './data/Texas.csv';
const DEFAULT_CATEGORY_NAME = 'Pledge';
const BATCH_SIZE = 500; // Process in batches

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

function coalesce<T>(...vals: Array<T | '' | null | undefined>): T | undefined {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v as T;
  }
  return undefined;
}

function normalizeDate(input?: string): string {
  const todayIso = new Date().toISOString().slice(0, 10);
  if (!input) return todayIso;

  let candidate = input;
  if (!/\b\d{4}\b/.test(candidate)) candidate = `${candidate} 2025`;

  const d = new Date(candidate);
  return isNaN(d.getTime()) ? todayIso : d.toISOString().slice(0, 10);
}

function splitNameParts(
  first?: string,
  last?: string,
  display?: string
): { firstName: string; lastName: string } {
  const f = (first || '').trim();
  const l = (last || '').trim();
  if (f || l) return { firstName: f || (display || 'Unknown'), lastName: l || '' };

  const disp = (display || 'Unknown').trim();
  const parts = disp.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function getOrCreateCategoryId(): Promise<number> {
  const found = await db
    .select()
    .from(category)
    .where(eq(category.name, DEFAULT_CATEGORY_NAME))
    .limit(1)
    .execute();
  if (found.length) return found[0].id;

  const [created] = await db
    .insert(category)
    .values({
      name: DEFAULT_CATEGORY_NAME,
      description: 'Default pledge category for imported donations',
      isActive: true,
      locationId: LOCATION_ID,
    })
    .returning();

  return created.id;
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

type Row = {
  'Account Name'?: string;
  'Last Name'?: string;
  'First Name'?: string;
  'Email'?: string;
  'Phone'?: string;
  'Campaign'?: string;
  'Paid'?: string;
  'Pledged'?: string;
  'Received'?: string;
  'Transaction Date'?: string;
  'Number of Tickets Purchased'?: string;
  'Solicited By'?: string;
  'Ambassadors'?: string;
  'Team Name'?: string;
  [k: string]: any;
};

function makeBucketKey(r: Row): string {
  const email = (r['Email'] || '').trim().toLowerCase();
  const display = (r['Account Name'] || '').trim();
  const first = (r['First Name'] || '').trim();
  const last = (r['Last Name'] || '').trim();
  const bestId = email || display || `${first} ${last}`.trim();
  const camp = (r['Campaign'] || '').trim();
  return `${bestId}|||${camp}`;
}

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

// ============ OPTIMIZATION: Pre-load all data into memory ============
async function preloadData() {
  console.log('📥 Pre-loading existing data into memory...');
  const start = Date.now();

  const [contacts, campaigns, solicitors, users] = await Promise.all([
    db.select().from(contact).execute(),
    db.select().from(campaign).execute(),
    db.select().from(solicitor).execute(),
    db.select().from(user).execute(),
  ]);

  // Build lookup maps
  const contactsByEmail = new Map(contacts.filter(c => c.email).map(c => [c.email!, c]));
  const contactsByDisplay = new Map(contacts.map(c => [c.displayName, c]));
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
    contactsByDisplay,
    contactsByName,
    campaignsByName,
    solicitorsByContactId,
    usersByEmail,
  };
}

// ============ BATCH PROCESSORS ============
async function batchCreateUsers(emails: string[]) {
  if (emails.length === 0) return;
  
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
  displayName: string;
  firstName: string;
  lastName: string;
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
      phone: undefined,
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
      notes: 'Created from historical donations import',
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
  console.log('║   HISTORICAL DONATIONS SEEDER (FAST)   ║');
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

  const pledgeCategoryId = await getOrCreateCategoryId();
  const caches = await preloadData();

  const allRows: Row[] = parseCSV(CSV_PATH);

  const groups = new Map<string, Row[]>();
  for (const r of allRows) {
    const key = makeBucketKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  console.log(`📦 CSV: ${path.resolve(CSV_PATH)}`);
  console.log(`✓ Rows loaded: ${allRows.length}`);
  console.log(`✓ Buckets (contact+campaign): ${groups.size}\n`);

  // ============ PHASE 1: Analyzing data ============
  console.log('🔍 Phase 1: Analyzing data...');
  
  const newUsers = new Set<string>();
  const newContacts = new Map<string, {
    email?: string;
    displayName: string;
    firstName: string;
    lastName: string;
  }>();
  const newCampaigns = new Set<string>();
  const newSolicitorContacts = new Map<string, string>();
  
  const bucketMetadata = new Map<string, {
    contactId?: number;
    campaignId?: number | null;
    solicitorId?: number | null;
    pledgedTotal: number;
    receivedTotal: number;
    pledgeDate: string;
    sample: Row;
  }>();

  for (const [key, bucket] of groups.entries()) {
    const sample = bucket[0];
    const email = cleanEmail(sample['Email']);
    const accountName = (sample['Account Name'] || '').trim();
    const firstName = (sample['First Name'] || '').trim();
    const lastName = (sample['Last Name'] || '').trim();
    const campaignName = (sample['Campaign'] || '').trim();

    const pledgedTotal = bucket.reduce((acc, r) => acc + toNumber(r['Pledged']), 0);
    const receivedTotal = bucket.reduce((acc, r) => acc + toNumber(r['Received']), 0);
    const pledgeDate = bucket.map((r) => normalizeDate(r['Transaction Date'])).sort()[0];

    let contactId: number | undefined;
    if (email && caches.contactsByEmail.has(email)) {
      contactId = caches.contactsByEmail.get(email)!.id;
    } else if (accountName && caches.contactsByDisplay.has(accountName)) {
      contactId = caches.contactsByDisplay.get(accountName)!.id;
    } else if (firstName || lastName) {
      const nameKey = `${firstName}|||${lastName}`;
      if (caches.contactsByName.has(nameKey)) {
        contactId = caches.contactsByName.get(nameKey)!.id;
      }
    }

    if (!contactId) {
      const names = splitNameParts(firstName, lastName, accountName || email || 'Unknown');
      const contactKey = email || accountName || `${firstName}|||${lastName}`;
      
      if (!newContacts.has(contactKey)) {
        newContacts.set(contactKey, {
          email,
          displayName: accountName || `${names.firstName} ${names.lastName}`.trim(),
          firstName: names.firstName,
          lastName: names.lastName,
        });

        if (email && !caches.usersByEmail.has(email)) {
          newUsers.add(email);
        }
      }
    }

    let campaignId: number | null = null;
    if (campaignName) {
      if (caches.campaignsByName.has(campaignName)) {
        campaignId = caches.campaignsByName.get(campaignName)!.id;
      } else if (!newCampaigns.has(campaignName)) {
        newCampaigns.add(campaignName);
      }
    }

    const solicitorName = (
      coalesce<string>(sample['Solicited By'], sample['Ambassadors'], sample['Team Name']) || ''
    ).trim();

    bucketMetadata.set(key, {
      contactId,
      campaignId,
      solicitorId: null,
      pledgedTotal,
      receivedTotal,
      pledgeDate,
      sample,
    });

    if (solicitorName && (pledgedTotal > 0 || receivedTotal > 0)) {
      if (!caches.contactsByDisplay.has(solicitorName)) {
        newSolicitorContacts.set(solicitorName, solicitorName);
      }
    }
  }

  console.log(`  📊 Analysis complete:`);
  console.log(`    - New users needed: ${newUsers.size}`);
  console.log(`    - New contacts needed: ${newContacts.size}`);
  console.log(`    - New campaigns needed: ${newCampaigns.size}`);
  console.log(`    - New solicitor contacts needed: ${newSolicitorContacts.size}\n`);

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
      caches.contactsByDisplay.set(c.displayName, c);
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
      const names = splitNameParts(undefined, undefined, name);
      return {
        displayName: name,
        firstName: names.firstName,
        lastName: names.lastName,
      };
    });
    const createdSolicitorContacts = await batchCreateContacts(solicitorContactData);
    createdSolicitorContacts.forEach(c => {
      caches.contactsByDisplay.set(c.displayName, c);
    });
  }

  const solicitorDataToCreate: Array<{ contactId: number; name: string }> = [];
  const seenContactIds = new Set<number>();
  
  for (const [key, metadata] of bucketMetadata.entries()) {
    const solicitorName = (
      coalesce<string>(
        metadata.sample['Solicited By'],
        metadata.sample['Ambassadors'],
        metadata.sample['Team Name']
      ) || ''
    ).trim();

    if (solicitorName && (metadata.pledgedTotal > 0 || metadata.receivedTotal > 0)) {
      const solicitorContact = caches.contactsByDisplay.get(solicitorName);
      if (solicitorContact && 
          !caches.solicitorsByContactId.has(solicitorContact.id) &&
          !seenContactIds.has(solicitorContact.id)) {
        solicitorDataToCreate.push({
          contactId: solicitorContact.id,
          name: solicitorName,
        });
        seenContactIds.add(solicitorContact.id);
      }
    }
  }

  if (solicitorDataToCreate.length > 0) {
    console.log(`  💼 Creating ${solicitorDataToCreate.length} solicitors...`);
    const createdSolicitors = await batchCreateSolicitors(solicitorDataToCreate);
    createdSolicitors.forEach(s => caches.solicitorsByContactId.set(s.contactId, s));
  }

  // ============ PHASE 3: Resolving relationships ============
  console.log('\n🔗 Phase 3: Resolving relationships...');
  
  for (const [key, metadata] of bucketMetadata.entries()) {
    const sample = metadata.sample;
    const email = cleanEmail(sample['Email']);
    const accountName = (sample['Account Name'] || '').trim();
    const firstName = (sample['First Name'] || '').trim();
    const lastName = (sample['Last Name'] || '').trim();
    const campaignName = (sample['Campaign'] || '').trim();

    if (!metadata.contactId) {
      if (email && caches.contactsByEmail.has(email)) {
        metadata.contactId = caches.contactsByEmail.get(email)!.id;
      } else if (accountName && caches.contactsByDisplay.has(accountName)) {
        metadata.contactId = caches.contactsByDisplay.get(accountName)!.id;
      } else {
        const nameKey = `${firstName}|||${lastName}`;
        if (caches.contactsByName.has(nameKey)) {
          metadata.contactId = caches.contactsByName.get(nameKey)!.id;
        }
      }
    }

    if (campaignName && !metadata.campaignId) {
      metadata.campaignId = caches.campaignsByName.get(campaignName)?.id || null;
    }

    const solicitorName = (
      coalesce<string>(sample['Solicited By'], sample['Ambassadors'], sample['Team Name']) || ''
    ).trim();
    
    if (solicitorName && (metadata.pledgedTotal > 0 || metadata.receivedTotal > 0)) {
      const solicitorContact = caches.contactsByDisplay.get(solicitorName);
      if (solicitorContact) {
        metadata.solicitorId = caches.solicitorsByContactId.get(solicitorContact.id)?.id || null;
      }
    }
  }

  console.log('✓ All relationships resolved\n');

  // ============ PHASE 3.5: Create Bonus Rules ============
  console.log('💰 Phase 3.5: Creating bonus rules for solicitors...');

  const bonusRulesToCreate: Array<{ solicitorId: number }> = [];
  const seenSolicitorIds = new Set<number>();

  for (const [key, metadata] of bucketMetadata.entries()) {
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
        notes: 'Auto-created during historical data import',
      }));

      const created = await db.insert(bonusRule).values(values).returning();
      created.forEach((br, idx) => {
        bonusRuleMap.set(batch[idx].solicitorId, br.id);
      });
      
      console.log(`    ✓ Batch ${Math.floor(i / 100) + 1}: ${created.length} bonus rules`);
    }
  }

  console.log('✓ All bonus rules created\n');

  // ============ PHASE 4: Creating pledges and payments ============
  console.log('💰 Phase 4: Creating pledges and payments...');

  const pledgesToCreate: any[] = [];
  const paymentsToCreate: any[] = [];
  const manualDonationsToCreate: any[] = [];

  let successLog: any[] = [];
  let errorLog: any[] = [];

  for (const [key, metadata] of bucketMetadata.entries()) {
    try {
      if (!metadata.contactId) {
        throw new Error('Contact ID not resolved');
      }

      const sample = metadata.sample;
      const accountName = (sample['Account Name'] || '').trim();
      const email = cleanEmail(sample['Email']) || '';
      const firstName = (sample['First Name'] || '').trim();
      const lastName = (sample['Last Name'] || '').trim();
      const campaignName = (sample['Campaign'] || '').trim();

      let pledgeCreated = false;
      let paymentCreated = false;
      let manualCreated = false;

      if (metadata.pledgedTotal > 0) {
        const alreadyPaid = Math.min(metadata.receivedTotal, metadata.pledgedTotal);
        
        pledgesToCreate.push({
          contactId: metadata.contactId,
          categoryId: pledgeCategoryId,
          relationshipId: null,
          pledgeDate: metadata.pledgeDate,
          description: `Imported pledge for ${campaignName}`,
          originalAmount: metadata.pledgedTotal.toFixed(2),
          currency: 'USD',
          totalPaid: alreadyPaid.toFixed(2),
          balance: (metadata.pledgedTotal - alreadyPaid).toFixed(2),
          originalAmountUsd: metadata.pledgedTotal.toFixed(2),
          totalPaidUsd: alreadyPaid.toFixed(2),
          exchangeRate: '1.00',
          balanceUsd: (metadata.pledgedTotal - alreadyPaid).toFixed(2),
          campaignCode: campaignName || null,
          isActive: true,
          notes: `Bucket: ${key}`,
          _bucketKey: key,
        });
        
        pledgeCreated = true;
      }

      if (metadata.receivedTotal > 0 && metadata.pledgedTotal > 0) {
        paymentsToCreate.push({
          _bucketKey: key,
          pledgeId: null,
          paymentPlanId: null,
          installmentScheduleId: null,
          relationshipId: null,
          payerContactId: null,
          isThirdPartyPayment: false,
          amount: metadata.receivedTotal.toFixed(2),
          currency: 'USD',
          amountUsd: metadata.receivedTotal.toFixed(2),
          exchangeRate: '1.00',
          amountInPledgeCurrency: metadata.receivedTotal.toFixed(2),
          pledgeCurrencyExchangeRate: '1.00',
          amountInPlanCurrency: null,
          planCurrencyExchangeRate: null,
          paymentDate: metadata.pledgeDate,
          receivedDate: metadata.pledgeDate,
          checkDate: null,
          account: null,
          paymentMethod: 'Credit Card',
          methodDetail: null,
          paymentStatus: 'completed',
          referenceNumber: null,
          checkNumber: null,
          receiptNumber: null,
          receiptType: null,
          receiptIssued: false,
          solicitorId: metadata.solicitorId,
          bonusPercentage: metadata.solicitorId ? '10.00' : null,
          bonusAmount: metadata.solicitorId ? (metadata.receivedTotal * 0.1).toFixed(2) : null,
          bonusRuleId: metadata.solicitorId ? bonusRuleMap.get(metadata.solicitorId) || null : null,
          notes: `Imported payment for ${campaignName}`,
        });
        paymentCreated = true;
      } else if (metadata.receivedTotal > 0) {
        manualDonationsToCreate.push({
          contactId: metadata.contactId,
          amount: metadata.receivedTotal.toFixed(2),
          currency: 'USD',
          amountUsd: metadata.receivedTotal.toFixed(2),
          exchangeRate: '1.00',
          paymentDate: metadata.pledgeDate,
          receivedDate: metadata.pledgeDate,
          checkDate: null,
          accountId: null,
          campaignId: metadata.campaignId,
          paymentMethod: 'Credit Card',
          methodDetail: null,
          paymentStatus: 'completed',
          referenceNumber: null,
          checkNumber: null,
          receiptNumber: null,
          receiptType: null,
          receiptIssued: false,
          solicitorId: metadata.solicitorId,
          bonusPercentage: metadata.solicitorId ? '10.00' : null,
          bonusAmount: metadata.solicitorId ? (metadata.receivedTotal * 0.1).toFixed(2) : null,
          bonusRuleId: metadata.solicitorId ? bonusRuleMap.get(metadata.solicitorId) || null : null,
          notes: `Imported manual donation for ${campaignName}`,
        });
        manualCreated = true;
      }

      if (pledgeCreated || paymentCreated || manualCreated) {
        successLog.push({
          bucketKey: key,
          accountName,
          email,
          firstName,
          lastName,
          campaign: campaignName,
          pledgedTotal: metadata.pledgedTotal.toFixed(2),
          receivedTotal: metadata.receivedTotal.toFixed(2),
          pledgeCreated: pledgeCreated ? 'yes' : 'no',
          paymentCreated: paymentCreated ? 'yes' : 'no',
          manualDonationCreated: manualCreated ? 'yes' : 'no',
          contactId: metadata.contactId,
          solicitorId: metadata.solicitorId,
          pledgeDate: metadata.pledgeDate,
        });
      }
    } catch (err: any) {
      const sample = metadata.sample;
      errorLog.push({
        bucketKey: key,
        accountName: (sample['Account Name'] || '').trim(),
        email: cleanEmail(sample['Email']) || '',
        firstName: (sample['First Name'] || '').trim(),
        lastName: (sample['Last Name'] || '').trim(),
        campaign: (sample['Campaign'] || '').trim(),
        pledgedTotal: metadata.pledgedTotal.toFixed(2),
        receivedTotal: metadata.receivedTotal.toFixed(2),
        error: String(err?.message || err),
      });
    }
  }

  // Batch insert pledges
  console.log(`  💳 Inserting ${pledgesToCreate.length} pledges in batches...`);
  const pledgeMap = new Map<string, number>();
  
  for (let i = 0; i < pledgesToCreate.length; i += BATCH_SIZE) {
    const batch = pledgesToCreate.slice(i, i + BATCH_SIZE);
    const batchToInsert = batch.map(p => {
      const { _bucketKey, ...rest } = p;
      return rest;
    });
    
    const createdPledges = await db.insert(pledge).values(batchToInsert).returning();
    
    batch.forEach((p, idx) => {
      pledgeMap.set(p._bucketKey, createdPledges[idx].id);
    });
    
    console.log(`    ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${createdPledges.length} pledges`);
  }

  // Prepare bonus calculations
  const bonusCalculationsToCreate: any[] = [];

  for (let i = 0; i < paymentsToCreate.length; i++) {
    const paymentData = paymentsToCreate[i];
    
    if (paymentData.solicitorId && paymentData.bonusAmount) {
      bonusCalculationsToCreate.push({
        _bucketKey: paymentData._bucketKey,
        solicitorId: paymentData.solicitorId,
        bonusRuleId: paymentData.bonusRuleId,
        paymentAmount: paymentData.amount,
        bonusPercentage: paymentData.bonusPercentage || '10.00',
        bonusAmount: paymentData.bonusAmount,
        isPaid: false,
        paidAt: null,
        notes: `Bonus for imported payment`,
      });
    }
  }

  // Link payments to pledges and batch insert
  console.log(`  💵 Inserting ${paymentsToCreate.length} payments in batches...`);
  const paymentMap = new Map<string, number>();

  for (let i = 0; i < paymentsToCreate.length; i += BATCH_SIZE) {
    const batch = paymentsToCreate.slice(i, i + BATCH_SIZE);
    const batchToInsert = batch.map(p => {
      const { _bucketKey, ...rest } = p;
      return {
        ...rest,
        pledgeId: pledgeMap.get(_bucketKey)!,
      };
    });
    
    const createdPayments = await db.insert(payment).values(batchToInsert).returning();
    
    batch.forEach((p, idx) => {
      paymentMap.set(p._bucketKey, createdPayments[idx].id);
    });
    
    console.log(`    ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${createdPayments.length} payments`);
  }

  // Insert bonus calculations with actual payment IDs
  if (bonusCalculationsToCreate.length > 0) {
    console.log(`  🎁 Inserting ${bonusCalculationsToCreate.length} bonus calculations in batches...`);
    
    for (let i = 0; i < bonusCalculationsToCreate.length; i += BATCH_SIZE) {
      const batch = bonusCalculationsToCreate.slice(i, i + BATCH_SIZE);
      const batchToInsert = batch.map(bc => {
        const { _bucketKey, ...rest } = bc;
        return {
          ...rest,
          paymentId: paymentMap.get(_bucketKey)!,
        };
      }).filter(bc => bc.paymentId);
      
      if (batchToInsert.length > 0) {
        await db.insert(bonusCalculation).values(batchToInsert);
        console.log(`    ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchToInsert.length} bonus calculations`);
      }
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
  console.log(`👤 Processed buckets:   ${groups.size}`);
  console.log(`🏷️  Pledges created:     ${pledgesToCreate.length}`);
  console.log(`💳 Payments created:     ${paymentsToCreate.length}`);
  console.log(`🧾 Manual donations:     ${manualDonationsToCreate.length}`);
  console.log(`📋 Bonus rules created:  ${bonusRulesToCreate.length}`);
  console.log(`🎁 Bonus calculations:   ${bonusCalculationsToCreate.length}`);
  console.log(`✅ Successful imports:   ${successLog.length}`);
  console.log(`❌ Failed imports:       ${errorLog.length}`);

  // Write export CSVs
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve('./data/exports');
  const successPath = path.join(outDir, `success-${ts}.csv`);
  const failedPath = path.join(outDir, `failed-${ts}.csv`);

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