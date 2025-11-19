// scripts/seed-manual-donations.ts
import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';

process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-late-term-a9gfvfb7-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require';

import { db } from '@/lib/db';
import { contact, campaign, manualDonation } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

// ---------- CONFIG ----------
const LOCATION_ID = 'g9JSoJ1FInnA6N0SHXi7';
const CSV_PATH = process.env.MANUAL_DONATIONS_CSV || './data/north.csv';
const BATCH_SIZE = 300;
const DEFAULT_PAYMENT_METHOD = 'Cash';
const DEFAULT_CAMPAIGN_NAME = 'General Donation';

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

// ============ MAIN ============
async function main() {
  console.log("\n===== MANUAL DONATIONS IMPORT =====\n");

  // --- Delete existing data for this location ---
  console.log(`Deleting existing data for location: ${LOCATION_ID}...`);
  
  // Get contacts for this location
  const contactsToDelete = await db
    .select()
    .from(contact)
    .where(eq(contact.locationId, LOCATION_ID))
    .execute();
  
  const contactIds = contactsToDelete.map(c => c.id);
  
  if (contactIds.length > 0) {
    console.log(`Found ${contactIds.length} contacts to delete`);
    
    // Delete manual donations for these contacts
    const deletedDonations = await db
      .delete(manualDonation)
      .where(inArray(manualDonation.contactId, contactIds))
      .returning();
    console.log(`✓ Deleted ${deletedDonations.length} manual donations`);
    
    // Delete contacts
    const deletedContacts = await db
      .delete(contact)
      .where(eq(contact.locationId, LOCATION_ID))
      .returning();
    console.log(`✓ Deleted ${deletedContacts.length} contacts`);
  } else {
    console.log('No existing contacts found for this location');
  }
  
  // Delete campaigns for this location
  const deletedCampaigns = await db
    .delete(campaign)
    .where(eq(campaign.locationId, LOCATION_ID))
    .returning();
  console.log(`✓ Deleted ${deletedCampaigns.length} campaigns\n`);

  const existingContacts = await db.select().from(contact).execute();
  const existingCampaigns = await db.select().from(campaign).execute();

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

    const firstName = (r['First Name'] || '').trim();
    const lastName = (r['Last Name'] || '').trim();
    const completeName = (r['Complete Name'] || '').trim();
    const email = cleanEmail(r['Email']);
    const phone = cleanPhone(r['Phone']);
    const campaignName = (r['Campaign Name'] || '').trim() || DEFAULT_CAMPAIGN_NAME;
    const amount = toNumber(r['Amount of manual Donation']);
    const rawDate = r['Date of Donation'];
    const donationDate = normalizeDate(rawDate);

    if (!donationDate) {
      console.log(`Row ${i}: Skipping invalid date "${rawDate}" for ${completeName || firstName + ' ' + lastName}`);
      skippedInvalidDate++;
      continue;
    }
    if (!amount || amount <= 0) {
      console.log(`Row ${i}: Skipping invalid amount "${r['Amount of manual Donation']}" for ${completeName || firstName + ' ' + lastName}`);
      skippedInvalidAmount++;
      continue;
    }

    if (!firstName && !lastName) {
      console.log(`Row ${i}: Skipping row with no name data`);
      skippedEmpty++;
      continue;
    }

    // Resolve or create contact
    let contactRecord = undefined;
    if (email && contactsByEmail.has(email)) {
      contactRecord = contactsByEmail.get(email);
    } else {
      const nameKey = `${firstName}|||${lastName}`;
      if (contactsByName.has(nameKey)) {
        contactRecord = contactsByName.get(nameKey);
      }
    }

    if (!contactRecord) {
      const newC = {
        ghlContactId: undefined,
        recordId: undefined,
        locationId: LOCATION_ID,
        firstName: firstName || 'Unknown',
        lastName: lastName || '',
        displayName: completeName || `${firstName} ${lastName}`.trim(),
        email,
        phone,
        address: undefined,
      };
      newContacts.push(newC);
      contactRecord = newC; // placeholder
    }

    // Track new campaigns (including default campaign)
    if (campaignName && !campaignsByName.has(campaignName)) {
      newCampaigns.add(campaignName);
    }

    donations.push({
      contact: contactRecord,
      amount,
      campaignName,
      date: donationDate,
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
      description: `Imported from manual donations CSV`,
      status: 'active' as const,
      locationId: LOCATION_ID,
    }));
    const created = await db.insert(campaign).values(values).returning();
    for (const c of created) campaignsByName.set(c.name, c);
    console.log(`✓ Created ${created.length} campaigns`);
  }

  // --- Create contacts in batches ---
  if (newContacts.length > 0) {
    console.log('Creating contacts...');
    const CONTACT_BATCH_SIZE = 100; // Smaller batch size for contacts
    let createdCount = 0;
    
    for (let i = 0; i < newContacts.length; i += CONTACT_BATCH_SIZE) {
      const batch = newContacts.slice(i, i + CONTACT_BATCH_SIZE);
      const created = await db.insert(contact).values(batch).returning();
      
      for (const c of created) {
        if (c.email) contactsByEmail.set(c.email, c);
        contactsByName.set(`${c.firstName}|||${c.lastName}`, c);
      }
      
      createdCount += created.length;
      console.log(`  Created ${createdCount} / ${newContacts.length} contacts...`);
    }
    
    console.log(`✓ Created ${createdCount} contacts total`);
  }

  // --- Insert donations ---
  console.log('Inserting manual donations...');
  let toInsert: any[] = [];
  for (const d of donations) {
    let resolvedContact = d.contact.id 
      ? d.contact 
      : contactsByName.get(`${d.contact.firstName}|||${d.contact.lastName}`);

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
      paymentMethod: DEFAULT_PAYMENT_METHOD,
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
      notes: `Imported manual donation from CSV`,
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