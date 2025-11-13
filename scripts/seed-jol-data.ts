// scripts/seed-ghl-donations-new-format.ts
import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';

process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-tiny-fog-a9fqoj3f-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require';

import { db } from '@/lib/db';
import { contact, campaign, manualDonation } from '@/lib/db/schema';

// ---------- CONFIG ----------
const LOCATION_ID = 'KVgMIrEYRkKRcfeicJBm';
const CSV_PATH = process.env.NEW_GHL_PAYMENTS_CSV || './data/JOL.csv';
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
  
  // Try to parse the date
  const d = new Date(input);
  
  // Check if date is invalid
  if (isNaN(d.getTime())) return null;
  
  // Check if year is within reasonable range (1900-2100)
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

// ============ MAIN ============
async function main() {
  console.log("\n===== NEW GHL PAYMENT IMPORT =====\n");

  const existingContacts = await db.select().from(contact).execute();
  const existingCampaigns = await db.select().from(campaign).execute();

  const contactsByGhlId = new Map(existingContacts.filter(c => c.ghlContactId).map(c => [c.ghlContactId!, c]));
  const contactsByEmail = new Map(existingContacts.filter(c => c.email).map(c => [c.email!, c]));
  const contactsByName = new Map(existingContacts.map(c => [`${c.firstName}|||${c.lastName}`, c]));
  const campaignsByName = new Map(existingCampaigns.map(c => [c.name, c]));

  const rows = parseCSV(CSV_PATH);
  console.log(`Loaded ${rows.length} rows`);

  const newContacts: any[] = [];
  const newCampaigns: Set<string> = new Set();
  const donations: any[] = [];

  let skippedEmpty = 0;
  let skippedInvalidDate = 0;
  let skippedInvalidAmount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // Skip completely empty rows
    const hasAnyData = Object.values(r).some(val => val && String(val).trim() !== '');
    if (!hasAnyData) {
      console.log(`Row ${i}: Skipping empty row`);
      skippedEmpty++;
      continue;
    }

    const paymentType = r['PAYMENT TYPE'];
    const campaignName = (r['Campaign'] || '').trim();
    const amount = toNumber(r['Line Item Amount']);
    const ghlContactId = (r['Customer Id'] || '').trim();
    const displayName = r['Customer Name']?.trim() || '';
    const email = cleanEmail(r['Customer Email']);
    const phone = cleanPhone(r['Customer Phone No']);
    const rawDate = r['Issue Date'];
    const issueDate = normalizeDate(rawDate);

    if (!issueDate) {
      console.log(`Row ${i}: Skipping invalid date "${rawDate}" for ${displayName}`);
      skippedInvalidDate++;
      continue;
    }
    if (!amount || amount <= 0) {
      console.log(`Row ${i}: Skipping invalid amount "${r['Line Item Amount']}" for ${displayName}`);
      skippedInvalidAmount++;
      continue;
    }

    const nameParts = splitName(displayName);

    // Resolve or create contact
    let contactRecord = undefined;
    if (ghlContactId && contactsByGhlId.has(ghlContactId)) contactRecord = contactsByGhlId.get(ghlContactId);
    else if (email && contactsByEmail.has(email)) contactRecord = contactsByEmail.get(email);
    else {
      const nameKey = `${nameParts.firstName}|||${nameParts.lastName}`;
      if (contactsByName.has(nameKey)) contactRecord = contactsByName.get(nameKey);
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
      contactRecord = newC; // placeholder
    }

    if (campaignName && !campaignsByName.has(campaignName)) {
      newCampaigns.add(campaignName);
    }

    donations.push({
      contact: contactRecord,
      amount,
      campaignName,
      paymentType: paymentType || 'Card',
      date: issueDate,
    });
  }

  console.log(`\n--- PROCESSING SUMMARY ---`);
  console.log(`Total rows: ${rows.length}`);
  console.log(`Skipped empty rows: ${skippedEmpty}`);
  console.log(`Skipped invalid dates: ${skippedInvalidDate}`);
  console.log(`Skipped invalid amounts: ${skippedInvalidAmount}`);
  console.log(`Valid donations to import: ${donations.length}`);
  console.log(`New contacts to create: ${newContacts.length}`);
  console.log(`New campaigns to create: ${newCampaigns.size}\n`);

  // --- Create campaigns ---
  if (newCampaigns.size > 0) {
    console.log('Creating campaigns...');
    const values = Array.from(newCampaigns).map(name => ({
      name,
      description: `Imported from new GHL CSV`,
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

  // --- Insert donations ---
  console.log('Inserting donations...');
  let toInsert: any[] = [];
  for (const d of donations) {
    let resolvedContact = d.contact.id ? d.contact : contactsByName.get(`${d.contact.firstName}|||${d.contact.lastName}`);

    if (!resolvedContact || !resolvedContact.id) {
      console.warn(`Warning: Could not resolve contact for donation: ${d.contact.firstName} ${d.contact.lastName}`);
      continue;
    }

    toInsert.push({
      contactId: resolvedContact.id,
      amount: d.amount.toFixed(2),
      amountUsd: d.amount.toFixed(2),
      currency: 'USD',
      exchangeRate: '1.00',
      paymentDate: d.date,
      receivedDate: d.date,
      checkDate: null,
      accountId: null,
      campaignId: campaignsByName.get(d.campaignName)?.id || null,
      paymentMethod: d.paymentType,
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
      notes: `Imported from new GHL CSV`,
    });
  }

  let insertedCount = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    await db.insert(manualDonation).values(batch);
    insertedCount += batch.length;
    console.log(`  Inserted ${insertedCount} / ${toInsert.length} donations...`);
  }

  console.log(`\n✓ Import complete! Inserted ${insertedCount} donations.`);
}

main().catch(e => {
  console.error('\n❌ Import failed with error:');
  console.error(e);
  process.exit(1);
});