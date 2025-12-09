// scripts/sync-payments.ts
import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';

process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-tiny-fog-a9fqoj3f-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require';

import { db } from '@/lib/db';
import { contact, campaign, manualDonation } from '@/lib/db/schema';

// ---------- CONFIG ----------
const LOCATION_ID = 'KVgMIrEYRkKRcfeicJBm';
const CSV_PATH = process.env.PAYMENTS_CSV || './data/jolm.csv';
const BATCH_SIZE = 300;

// ---------- HELPERS ----------
function parseCSV(filePath: string) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
  return parsed.data as any[];
}

function toNumber(amount: string): number {
  if (!amount) return 0;
  const cleaned = amount.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(input: string): string | null {
  if (!input || !input.trim()) return null;
  
  const d = new Date(input);
  
  if (isNaN(d.getTime())) return null;
  
  const year = d.getFullYear();
  if (year < 1900 || year > 2100) {
    console.warn(`Invalid year ${year} for date input: "${input}"`);
    return null;
  }
  
  return d.toISOString().slice(0, 10);
}

function cleanEmail(raw?: string): string | undefined {
  if (!raw) return undefined;
  let e = raw.trim().toLowerCase();
  if (e.includes('fake999email')) return undefined;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return e;
  return undefined;
}

function cleanPhone(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^0-9]/g, '');
  return cleaned.length >= 10 ? cleaned : undefined;
}

function splitName(full: string) {
  if (!full) return { firstName: 'Unknown', lastName: '' };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function normalizePaymentMethod(method: string): string {
  if (!method) return 'Other';
  const m = method.trim().toLowerCase();
  if (m === 'cheque' || m === 'check') return 'Check';
  if (m === 'other') return 'Other';
  if (m === 'card' || m === 'credit card') return 'Card';
  if (m === 'cash') return 'Cash';
  if (m === 'bank transfer' || m === 'wire') return 'Bank Transfer';
  return 'Other';
}

// ============ MAIN ============
async function main() {
  console.log("\n===== MANUAL DONATIONS IMPORT =====\n");
  console.log(`Location ID: ${LOCATION_ID}\n`);

  const existingContacts = await db.select().from(contact).execute();
  const existingCampaigns = await db.select().from(campaign).execute();
  const existingDonations = await db.select().from(manualDonation).execute();

  const contactsByGhlId = new Map(existingContacts.filter(c => c.ghlContactId).map(c => [c.ghlContactId!, c]));
  const contactsByEmail = new Map(existingContacts.filter(c => c.email).map(c => [c.email!, c]));
  const contactsByName = new Map(existingContacts.map(c => [`${c.firstName}|||${c.lastName}`, c]));
  const campaignsByName = new Map(existingCampaigns.map(c => [c.name, c]));

  // Create a Set of existing donations to check for duplicates
  // Format: "contactId|date|amount"
  const existingDonationKeys = new Set(
    existingDonations.map(d => `${d.contactId}|${d.receivedDate}|${d.amount}`)
  );
  console.log(`Found ${existingDonations.length} existing donations in database\n`);

  const rows = parseCSV(CSV_PATH);
  console.log(`Loaded ${rows.length} rows`);
  
  // Debug: show the actual column names from the CSV
  if (rows.length > 0) {
    console.log('\nCSV Columns detected:', Object.keys(rows[0]));
    console.log('First row sample:', rows[0]);
    console.log('');
  }

  const newContacts: any[] = [];
  const newCampaigns: Set<string> = new Set();
  const donations: any[] = [];

  let skippedEmpty = 0;
  let skippedInvalidDate = 0;
  let skippedInvalidAmount = 0;
  let skippedDuplicates = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    const hasAnyData = Object.values(r).some(val => val && String(val).trim() !== '');
    if (!hasAnyData) {
      console.log(`Row ${i}: Skipping empty row`);
      skippedEmpty++;
      continue;
    }

    const campaignName = (r['Line Item Name'] || '').trim();
    const amount = toNumber(r['amount']);
    const ghlContactId = (r['Customer Id'] || '').trim();
    const displayName = r['Customer Name']?.trim() || '';
    const email = cleanEmail(r['Customer Email']);
    const phone = cleanPhone(r['Customer Phone No']);
    // Try different possible column names for the date
    const rawDate = r['received date'] || r['received date '] || r['Received Date'] || r['Received date'];
    const receivedDate = normalizeDate(rawDate);
    const paymentMethod = normalizePaymentMethod(r['Payment Method']);

    if (!receivedDate) {
      console.log(`Row ${i}: Skipping invalid date "${rawDate}" for ${displayName}`);
      skippedInvalidDate++;
      continue;
    }
    if (!amount || amount <= 0) {
      console.log(`Row ${i}: Skipping invalid amount "${r['amount']}" for ${displayName}`);
      skippedInvalidAmount++;
      continue;
    }

    const nameParts = splitName(displayName);

    let contactRecord = undefined;
    if (ghlContactId && contactsByGhlId.has(ghlContactId)) {
      contactRecord = contactsByGhlId.get(ghlContactId);
    } else if (email && contactsByEmail.has(email)) {
      contactRecord = contactsByEmail.get(email);
    } else {
      const nameKey = `${nameParts.firstName}|||${nameParts.lastName}`;
      if (contactsByName.has(nameKey)) {
        contactRecord = contactsByName.get(nameKey);
      }
    }

    if (!contactRecord) {
      const newC = {
        ghlContactId: ghlContactId || undefined,
        recordId: undefined,
        locationId: LOCATION_ID,
        firstName: nameParts.firstName,
        lastName: nameParts.lastName,
        displayName,
        email,
        phone,
        address: undefined,
      };
      newContacts.push(newC);
      contactRecord = newC;
    }

    if (campaignName && !campaignsByName.has(campaignName)) {
      newCampaigns.add(campaignName);
    }

    donations.push({
      contact: contactRecord,
      amount,
      campaignName,
      paymentMethod,
      receivedDate,
    });
  }

  console.log(`\n--- PROCESSING SUMMARY ---`);
  console.log(`Total rows: ${rows.length}`);
  console.log(`Skipped empty rows: ${skippedEmpty}`);
  console.log(`Skipped invalid dates: ${skippedInvalidDate}`);
  console.log(`Skipped invalid amounts: ${skippedInvalidAmount}`);
  console.log(`Skipped duplicates: ${skippedDuplicates}`);
  console.log(`Valid donations to import: ${donations.length}`);
  console.log(`New contacts to create: ${newContacts.length}`);
  console.log(`New campaigns to create: ${newCampaigns.size}\n`);

  // --- Create campaigns ---
  if (newCampaigns.size > 0) {
    console.log('Creating campaigns...');
    const values = Array.from(newCampaigns).map(name => ({
      name,
      description: `Imported from payment sync CSV`,
      status: 'active' as const,
      locationId: LOCATION_ID,
    }));
    const created = await db.insert(campaign).values(values).returning();
    for (const c of created) campaignsByName.set(c.name, c);
    console.log(`✓ Created ${created.length} campaigns`);
  }

  // --- Create contacts ---
  if (newContacts.length > 0) {
    console.log('Creating contacts...');
    const created = await db.insert(contact).values(newContacts).returning();
    for (const c of created) {
      if (c.ghlContactId) contactsByGhlId.set(c.ghlContactId, c);
      if (c.email) contactsByEmail.set(c.email, c);
      contactsByName.set(`${c.firstName}|||${c.lastName}`, c);
    }
    console.log(`✓ Created ${created.length} contacts`);
  }

  // --- Insert manual donations ---
  console.log('Inserting manual donations...');
  let toInsert: any[] = [];
  
  for (const d of donations) {
    let resolvedContact = d.contact.id ? d.contact : contactsByName.get(`${d.contact.firstName}|||${d.contact.lastName}`);

    if (!resolvedContact || !resolvedContact.id) {
      console.warn(`Warning: Could not resolve contact for donation: ${d.contact.firstName} ${d.contact.lastName}`);
      continue;
    }

    // Check for duplicate: same contact, same date, same amount
    const donationKey = `${resolvedContact.id}|${d.receivedDate}|${d.amount.toFixed(2)}`;
    if (existingDonationKeys.has(donationKey)) {
      console.log(`  Skipping duplicate: ${resolvedContact.firstName} ${resolvedContact.lastName} - ${d.amount.toFixed(2)} on ${d.receivedDate}`);
      skippedDuplicates++;
      continue;
    }

    toInsert.push({
      contactId: resolvedContact.id,
      amount: d.amount.toFixed(2),
      amountUsd: d.amount.toFixed(2),
      currency: 'USD',
      exchangeRate: '1.00',
      paymentDate: d.receivedDate,
      receivedDate: d.receivedDate,
      checkDate: null,
      accountId: null,
      campaignId: campaignsByName.get(d.campaignName)?.id || null,
      paymentMethod: d.paymentMethod,
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
      notes: `Imported from payment sync CSV`,
    });
  }

  let insertedCount = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    await db.insert(manualDonation).values(batch);
    insertedCount += batch.length;
    console.log(`  Inserted ${insertedCount} / ${toInsert.length} donations...`);
  }

  console.log(`\n✓ Import complete! Inserted ${insertedCount} manual donations.`);
}

main().catch(e => {
  console.error('\n❌ Import failed with error:');
  console.error(e);
  process.exit(1);
});