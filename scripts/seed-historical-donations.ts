// scripts/seed-historical-donations.ts
import 'dotenv/config';
import Papa from 'papaparse';

// If you want to hardcode for local runs, uncomment and paste yours (keep secrets out of git!):
process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-frosty-moon-a93sd4ha-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require'

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
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcryptjs';

// ---------- Config ----------
const LOCATION_ID = 'E7yO96aiKmYvsbU2tRzc';
const CSV_PATH = process.env.HISTORICAL_DONATIONS_CSV || './data/Texas.csv';
const DEFAULT_CATEGORY_NAME = 'Pledge';

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
  // If missing/invalid -> today
  const todayIso = new Date().toISOString().slice(0, 10);
  if (!input) return todayIso;

  // If no year present, assume 2025 (you can tweak if needed)
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

async function findOrCreateCampaign(campaignName?: string | null): Promise<number | null> {
  const name = (campaignName || '').trim();
  if (!name) return null;

  const existing = await db
    .select()
    .from(campaign)
    .where(eq(campaign.name, name))
    .limit(1)
    .execute();
  if (existing.length) return existing[0].id;

  const [created] = await db
    .insert(campaign)
    .values({
      name,
      description: `Imported from CSV: ${name}`,
      status: 'active',
      locationId: LOCATION_ID,
    })
    .returning();
  return created.id;
}

function cleanEmail(raw?: string): string | undefined {
  if (!raw) return undefined;

  // remove whitespace/newlines
  let e = raw.replace(/\s+/g, '').trim();

  // if multiple emails → take the first one
  if (e.includes(',')) e = e.split(',')[0];
  if (e.includes(';')) e = e.split(';')[0];

  // validate format
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return e.toLowerCase();
  }

  return undefined;
}

async function findOrCreateContactByPriority(opts: {
  email?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}): Promise<number> {
  const email = cleanEmail(opts.email || '');
  const displayName = (opts.displayName || '').trim();
  const firstName = (opts.firstName || '').trim();
  const lastName = (opts.lastName || '').trim();

  // 1) Email
  if (email) {
    const byEmail = await db.select().from(contact).where(eq(contact.email, email)).limit(1).execute();
    if (byEmail.length) return byEmail[0].id;
  }

  // 2) Display name (Account Name)
  if (displayName) {
    const byDisplay = await db
      .select()
      .from(contact)
      .where(eq(contact.displayName, displayName))
      .limit(1)
      .execute();
    if (byDisplay.length) return byDisplay[0].id;
  }

  // 3) First + Last
  if (firstName || lastName) {
    const existing = await db
      .select()
      .from(contact)
      .where(and(eq(contact.firstName, firstName || ''), eq(contact.lastName, lastName || '')))
      .limit(1)
      .execute();
    if (existing.length) return existing[0].id;
  }

  // Create new user (if email present) + contact
  if (email) {
    const existingUser = await db.select().from(user).where(eq(user.email, email)).limit(1).execute();
    if (!existingUser.length) {
      const hashed = await bcrypt.hash(email, 10);
      await db
        .insert(user)
        .values({
          email,
          passwordHash: hashed,
          role: 'user',
          status: 'active',
          isActive: true,
          locationId: LOCATION_ID,
        })
        .returning();
    }
  }

  const names = splitNameParts(firstName, lastName, displayName || email || 'Unknown');
  const [createdContact] = await db
    .insert(contact)
    .values({
      ghlContactId: undefined,
      locationId: LOCATION_ID,
      firstName: names.firstName,
      lastName: names.lastName,
      displayName: displayName || `${names.firstName} ${names.lastName}`.trim(),
      email,
      phone: undefined,
    })
    .returning();
  return createdContact.id;
}

async function getOrCreateSolicitorId(name?: string | null): Promise<number | null> {
  const clean = (name || '').trim();
  if (!clean) return null;

  // find contact by displayName = solicitor name; else create minimal contact
  const existingContact = await db.select().from(contact).where(eq(contact.displayName, clean)).limit(1).execute();
  let contactId: number;
  if (existingContact.length) contactId = existingContact[0].id;
  else {
    const names = splitNameParts(undefined, undefined, clean);
    const [c] = await db
      .insert(contact)
      .values({
        locationId: LOCATION_ID,
        firstName: names.firstName,
        lastName: names.lastName,
        displayName: clean,
      })
      .returning();
    contactId = c.id;
  }

  const existingSol = await db.select().from(solicitor).where(eq(solicitor.contactId, contactId)).limit(1).execute();
  if (existingSol.length) return existingSol[0].id;

  const [createdSol] = await db
    .insert(solicitor)
    .values({
      contactId,
      solicitorCode: `SOL-${Date.now()}`,
      status: 'active',
      commissionRate: '10.00',
      hireDate: new Date().toISOString().slice(0, 10),
      locationId: LOCATION_ID,
      notes: 'Created from historical donations import',
    })
    .returning();

  return createdSol.id;
}

async function findExistingPledgeId(contactId: number, campaignName?: string | null): Promise<number | null> {
  const name = (campaignName || '').trim();
  if (!name) return null;

  // We use campaignCode field on pledge to store the campaign name
  const existing = await db
    .select()
    .from(pledge)
    .where(and(eq(pledge.contactId, contactId), eq(pledge.campaignCode, name)))
    .limit(1)
    .execute();

  return existing.length ? existing[0].id : null;
}

// ---------- Main ----------
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

// --- simple CSV writers for audit exports ---
function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   HISTORICAL DONATIONS SEEDER (B)     ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Sanity check DB connectivity
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
  const allRows: Row[] = parseCSV(CSV_PATH);

  // Group rows by contact+campaign
  const groups = new Map<string, Row[]>();
  for (const r of allRows) {
    const key = makeBucketKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  console.log(`📦 CSV: ${path.resolve(CSV_PATH)}`);
  console.log(`✓ Rows loaded: ${allRows.length}`);
  console.log(`✓ Buckets (contact+campaign): ${groups.size}\n`);

  // Stats
  let createdPledges = 0;
  let createdPayments = 0;
  let createdManuals = 0;
  let createdSolicitors = 0;
  let processed = 0;

  // Export collectors
  const successLog: Array<{
    bucketKey: string;
    accountName: string;
    email: string;
    firstName: string;
    lastName: string;
    campaign: string;
    pledgedTotal: string;
    receivedTotal: string;
    pledgeCreated: 'yes' | 'no';
    paymentCreated: 'yes' | 'no';
    manualDonationCreated: 'yes' | 'no';
    contactId?: number;
    pledgeId?: number | null;
    solicitorName?: string;
    solicitorId?: number | null;
    pledgeDate: string;
  }> = [];

  const errorLog: Array<{
    bucketKey: string;
    accountName: string;
    email: string;
    firstName: string;
    lastName: string;
    campaign: string;
    pledgedTotal: string;
    receivedTotal: string;
    error: string;
  }> = [];

  for (const [key, bucket] of groups.entries()) {
    try {
      const sample = bucket[0];
      const email = (sample['Email'] || '').trim();
      const accountName = (sample['Account Name'] || '').trim();
      const firstName = (sample['First Name'] || '').trim();
      const lastName = (sample['Last Name'] || '').trim();
      const campaignName = (sample['Campaign'] || '').trim();

      const pledgedTotalNum = bucket.reduce((acc, r) => acc + toNumber(r['Pledged']), 0);
      const receivedTotalNum = bucket.reduce((acc, r) => acc + toNumber(r['Received']), 0);

      // pick earliest date in the bucket
      const pledgeDateIso = bucket
        .map((r) => normalizeDate(r['Transaction Date']))
        .sort()[0];

      // Find/create contact and campaign
      const contactId = await findOrCreateContactByPriority({
        email,
        displayName: accountName,
        firstName,
        lastName,
      });
      const campaignId = await findOrCreateCampaign(campaignName);

      // Resolve solicitor (only if meaningful amounts)
      const solicitorName =
        (coalesce<string>(sample['Solicited By'], sample['Ambassadors'], sample['Team Name']) || '').trim();
      let solicitorId: number | null = null;
      if ((pledgedTotalNum > 0 || receivedTotalNum > 0) && solicitorName) {
        const before = await db.select().from(solicitor).execute();
        solicitorId = await getOrCreateSolicitorId(solicitorName);
        const after = await db.select().from(solicitor).execute();
        if (after.length > before.length) createdSolicitors++;
      }

      // We might reuse an existing pledge for the same contact+campaign
      let pledgeId: number | null = await findExistingPledgeId(contactId, campaignName);

      let pledgeCreated = false;
      let paymentCreated = false;
      let manualCreated = false;

      // If there's new pledged amount, create a pledge (even if an older one exists, create a new one for the bucket)
      if (pledgedTotalNum > 0) {
        const alreadyPaidAgainstThisPledge = Math.min(receivedTotalNum, pledgedTotalNum);
        const [created] = await db
          .insert(pledge)
          .values({
            contactId,
            categoryId: pledgeCategoryId,
            relationshipId: null,
            pledgeDate: pledgeDateIso,
            description: `Imported pledge for ${campaignName}`,
            originalAmount: pledgedTotalNum.toFixed(2),
            currency: 'USD',
            totalPaid: alreadyPaidAgainstThisPledge.toFixed(2),
            balance: (pledgedTotalNum - alreadyPaidAgainstThisPledge).toFixed(2),
            originalAmountUsd: pledgedTotalNum.toFixed(2),
            totalPaidUsd: alreadyPaidAgainstThisPledge.toFixed(2),
            exchangeRate: '1.00',
            balanceUsd: (pledgedTotalNum - alreadyPaidAgainstThisPledge).toFixed(2),
            campaignCode: campaignName || null,
            isActive: true,
            notes: `Bucket: ${key}`,
          })
          .returning();

        pledgeId = created.id;
        createdPledges++;
        pledgeCreated = true;
      }

      // Create payment(s) or manual donation
      if (receivedTotalNum > 0) {
        if (pledgeId) {
          await db.insert(payment).values({
            pledgeId,
            paymentPlanId: null,
            installmentScheduleId: null,
            relationshipId: null,
            payerContactId: null,
            isThirdPartyPayment: false,
            amount: receivedTotalNum.toFixed(2),
            currency: 'USD',
            amountUsd: receivedTotalNum.toFixed(2),
            exchangeRate: '1.00',
            amountInPledgeCurrency: receivedTotalNum.toFixed(2),
            pledgeCurrencyExchangeRate: '1.00',
            amountInPlanCurrency: null,
            planCurrencyExchangeRate: null,
            paymentDate: pledgeDateIso,
            receivedDate: pledgeDateIso,
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
            solicitorId,
            bonusPercentage: solicitorId ? '10.00' : null,
            bonusAmount: solicitorId ? (receivedTotalNum * 0.1).toFixed(2) : null,
            bonusRuleId: null,
            notes: `Imported payment for ${campaignName}`,
          });
          createdPayments++;
          paymentCreated = true;
        } else {
          // No pledge created AND none existed prior for same campaign → manual donation
          await db.insert(manualDonation).values({
            contactId,
            amount: receivedTotalNum.toFixed(2),
            currency: 'USD',
            amountUsd: receivedTotalNum.toFixed(2),
            exchangeRate: '1.00',
            paymentDate: pledgeDateIso,
            receivedDate: pledgeDateIso,
            checkDate: null,
            accountId: null,
            campaignId: campaignId,
            paymentMethod: 'Credit Card',
            methodDetail: null,
            paymentStatus: 'completed',
            referenceNumber: null,
            checkNumber: null,
            receiptNumber: null,
            receiptType: null,
            receiptIssued: false,
            solicitorId,
            bonusPercentage: solicitorId ? '10.00' : null,
            bonusAmount: solicitorId ? (receivedTotalNum * 0.1).toFixed(2) : null,
            bonusRuleId: null,
            notes: `Imported manual donation for ${campaignName}`,
          });
          createdManuals++;
          manualCreated = true;
        }
      }

      processed++;
      console.log(
        `✓ ${(accountName || email || `${firstName} ${lastName}`.trim()).padEnd(30)} | ${campaignName.padEnd(
          28
        )} | Pledged $${pledgedTotalNum.toFixed(2)} | Received $${receivedTotalNum.toFixed(2)}`
      );

      // Log success row if something got created (pledge and/or payment/manual)
      if (pledgeCreated || paymentCreated || manualCreated) {
        successLog.push({
          bucketKey: key,
          accountName,
          email,
          firstName,
          lastName,
          campaign: campaignName,
          pledgedTotal: pledgedTotalNum.toFixed(2),
          receivedTotal: receivedTotalNum.toFixed(2),
          pledgeCreated: pledgeCreated ? 'yes' : 'no',
          paymentCreated: paymentCreated ? 'yes' : 'no',
          manualDonationCreated: manualCreated ? 'yes' : 'no',
          contactId,
          pledgeId: pledgeId ?? null,
          solicitorName,
          solicitorId: solicitorId ?? null,
          pledgeDate: pledgeDateIso,
        });
      }
    } catch (err: any) {
      const sample = bucket[0] || {};
      const email = (sample['Email'] || '').trim();
      const accountName = (sample['Account Name'] || '').trim();
      const firstName = (sample['First Name'] || '').trim();
      const lastName = (sample['Last Name'] || '').trim();
      const campaignName = (sample['Campaign'] || '').trim();
      const pledgedTotalNum = bucket.reduce((acc, r) => acc + toNumber(r['Pledged']), 0);
      const receivedTotalNum = bucket.reduce((acc, r) => acc + toNumber(r['Received']), 0);

      console.error(`❌ Error in bucket ${key}:`, err?.message || err);

      errorLog.push({
        bucketKey: key,
        accountName,
        email,
        firstName,
        lastName,
        campaign: campaignName,
        pledgedTotal: pledgedTotalNum.toFixed(2),
        receivedTotal: receivedTotalNum.toFixed(2),
        error: String(err?.message || err),
      });
    }
  }

  // Summary
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║              SEED SUMMARY              ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`👤 Processed buckets:   ${processed}`);
  console.log(`🏷️  Pledges created:     ${createdPledges}`);
  console.log(`💳 Payments created:     ${createdPayments}`);
  console.log(`🧾 Manual donations:     ${createdManuals}`);
  console.log(`👔 Solicitors created:   ${createdSolicitors}`);

  // ---- Write export CSVs ----
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve('./data/exports');
  const successPath = path.join(outDir, `success-${ts}.csv`);
  const failedPath = path.join(outDir, `failed-${ts}.csv`);

  try {
    if (successLog.length > 0) {
      writeCsv(successPath, successLog);
      console.log(`📤 Success log written: ${successPath} (${successLog.length} rows)`);
    } else {
      console.log('📤 Success log: no rows to write.');
    }

    if (errorLog.length > 0) {
      writeCsv(failedPath, errorLog);
      console.log(`📤 Error log written:   ${failedPath} (${errorLog.length} rows)`);
    } else {
      console.log('📤 Error log: no rows to write.');
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
