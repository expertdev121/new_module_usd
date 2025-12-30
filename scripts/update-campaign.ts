// scripts/update-donation-campaigns.ts
import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '@/lib/db';
import { contact, manualDonation, campaign } from '@/lib/db/schema';
import { eq, and, gte, lt, inArray } from 'drizzle-orm';

// Configuration
const CSV_PATH = './data/campaign.csv';
const OUTPUT_DIR = './data/exports';
const YEAR = 2025;

interface CsvRow {
  campaign: string;
  'Customer Id': string;
  'Customer Name': string;
  'Customer Email': string;
  'Customer Phone No ': string;
  'Invoice Total': string;
}

interface UpdateResult {
  row: CsvRow;
  status: 'updated' | 'contact_not_found' | 'donation_not_found' | 'campaign_not_found' | 'error' | 'multiple_contacts_found';
  contactId?: number;
  donationId?: number;
  campaignId?: number;
  oldCampaignId?: number | null;
  matchType?: 'ghl' | 'email' | 'phone' | 'name';
  error?: string;
}

function parseCSV(filePath: string): CsvRow[] {
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

  return parsed.data as CsvRow[];
}

function normalizeAmount(amount: string | number): string {
  if (typeof amount === 'number') return amount.toFixed(2);
  const cleaned = String(amount).replace(/[^0-9.\-]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, '').trim();
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCustomerName(fullName: string): { firstName?: string; lastName?: string } {
  const normalized = normalizeName(fullName);
  const parts = normalized.split(' ').filter(part => part.length > 0);
  
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  
  // Common patterns: First Last, First Middle Last, etc.
  return {
    firstName: parts[0],
    lastName: parts[parts.length - 1]
  };
}

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

async function findContactByGhlId(ghlId: string, contactsByGhlId: Map<string, typeof contact.$inferSelect>): Promise<typeof contact.$inferSelect | null> {
  return contactsByGhlId.get(ghlId) || null;
}

async function findContactByEmail(email: string, allContacts: typeof contact.$inferSelect[]): Promise<typeof contact.$inferSelect | null> {
  const normalizedEmail = normalizeEmail(email);
  const matches = allContacts.filter(c => 
    c.email && normalizeEmail(c.email) === normalizedEmail
  );
  return matches.length === 1 ? matches[0] : null;
}

async function findContactByPhone(phone: string, allContacts: typeof contact.$inferSelect[]): Promise<typeof contact.$inferSelect | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  
  const matches = allContacts.filter(c => 
    c.phone && normalizePhone(c.phone).includes(normalizedPhone)
  );
  return matches.length === 1 ? matches[0] : null;
}

async function findContactByName(
  customerName: string, 
  allContacts: typeof contact.$inferSelect[]
): Promise<typeof contact.$inferSelect | null> {
  const nameParts = parseCustomerName(customerName);
  if (!nameParts.firstName) return null;

  const candidates: typeof contact.$inferSelect[] = [];

  // Method 1: Exact first + last name match
  if (nameParts.lastName) {
    const exactMatches = allContacts.filter(c => 
      c.firstName && c.lastName &&
      normalizeName(c.firstName) === normalizeName(nameParts.firstName!) &&
      normalizeName(c.lastName) === normalizeName(nameParts.lastName!)
    );
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) candidates.push(...exactMatches);
  }

  // Method 2: First name + display name match
  const firstNameMatches = allContacts.filter(c => 
    c.firstName && normalizeName(c.firstName) === normalizeName(nameParts.firstName!)
  );
  if (firstNameMatches.length === 1) return firstNameMatches[0];
  candidates.push(...firstNameMatches);

  // Method 3: Display name substring match (most flexible)
  if (nameParts.lastName) {
    const displayMatches = allContacts.filter(c => 
      c.displayName && 
      normalizeName(c.displayName).includes(normalizeName(nameParts.firstName!)) &&
      normalizeName(c.displayName).includes(normalizeName(nameParts.lastName!))
    );
    if (displayMatches.length === 1) return displayMatches[0];
    candidates.push(...displayMatches);
  }

  // If we have exactly one candidate across all methods
  const uniqueCandidates = Array.from(new Set(candidates.map(c => c.id))).map(id => 
    candidates.find(c => c.id === id)!
  );
  
  return uniqueCandidates.length === 1 ? uniqueCandidates[0] : null;
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   UPDATE DONATION CAMPAIGNS (2025)     ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Test database connection
  try {
    await db.select().from(contact).limit(1).execute();
    console.log('✓ Database connected\n');
  } catch (e) {
    console.error('❌ Database connection failed:', e);
    process.exit(1);
  }

  // Parse CSV
  console.log(`📂 Reading CSV: ${path.resolve(CSV_PATH)}`);
  const csvRows = parseCSV(CSV_PATH);
  console.log(`✓ Loaded ${csvRows.length} rows\n`);

  // Pre-load all contacts
  console.log(`📥 Loading all contacts...`);
  const allContacts = await db.select().from(contact).execute();
  const contactsByGhlId = new Map(
    allContacts
      .filter(c => c.ghlContactId)
      .map(c => [c.ghlContactId!, c])
  );
  console.log(`✓ Loaded ${allContacts.length} contacts (${contactsByGhlId.size} with GHL ID)\n`);

  // Pre-load all campaigns
  console.log(`📥 Loading all campaigns...`);
  const allCampaigns = await db.select().from(campaign).execute();
  const campaignsByName = new Map(
    allCampaigns.map(c => [c.name.toLowerCase().trim(), c])
  );
  console.log(`✓ Loaded ${allCampaigns.length} campaigns\n`);

  // Get all contact IDs
  const contactIds = allContacts.map(c => c.id);

  // Pre-load all 2025 donations
  console.log(`📥 Loading 2025 manual donations...`);
  const startDate = `${YEAR}-01-01`;
  const endDate = `${YEAR + 1}-01-01`;

  let donations2025: Array<typeof manualDonation.$inferSelect> = [];
  
  if (contactIds.length > 0) {
    const BATCH_SIZE = 500;
    for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
      const batchContactIds = contactIds.slice(i, i + BATCH_SIZE);
      
      const batchDonations = await db
        .select()
        .from(manualDonation)
        .where(
          and(
            inArray(manualDonation.contactId, batchContactIds),
            gte(manualDonation.receivedDate, startDate)
          )
        )
        .execute()
        .then(donations => donations.filter(d => {
          const dateToCheck = d.receivedDate || d.paymentDate;
          return dateToCheck >= startDate && dateToCheck < endDate;
        }));
      
      donations2025.push(...batchDonations);
      
      if (contactIds.length > BATCH_SIZE) {
        process.stdout.write(`\r  Progress: ${Math.min(i + BATCH_SIZE, contactIds.length)}/${contactIds.length} contacts...`);
      }
    }
    if (contactIds.length > BATCH_SIZE) {
      console.log('');
    }
  }
  
  console.log(`✓ Loaded ${donations2025.length} donations for ${YEAR}\n`);

  // Group donations by contact ID for faster lookup
  const donationsByContact = new Map<number, Array<typeof manualDonation.$inferSelect>>();
  for (const donation of donations2025) {
    if (!donationsByContact.has(donation.contactId)) {
      donationsByContact.set(donation.contactId, []);
    }
    donationsByContact.get(donation.contactId)!.push(donation);
  }

  // Process each CSV row
  console.log(`🔍 Processing ${csvRows.length} transactions...\n`);
  const results: UpdateResult[] = [];
  let processed = 0;

  for (const row of csvRows) {
    processed++;
    if (processed % 50 === 0) {
      process.stdout.write(`\r  Progress: ${processed}/${csvRows.length}`);
    }

    const customerId = row['Customer Id'];
    const customerEmail = row['Customer Email']?.trim();
    const customerPhone = row['Customer Phone No ']?.trim();
    const customerName = row['Customer Name']?.trim();
    const campaignName = (row.campaign || '').trim();
    const amount = normalizeAmount(row['Invoice Total']);

    let foundContact: typeof contact.$inferSelect | null = null;
    let matchType: UpdateResult['matchType'] | undefined;

    // 1. Try GHL ID first (fastest)
    if (customerId) {
      foundContact = await findContactByGhlId(customerId, contactsByGhlId);
      if (foundContact) {
        matchType = 'ghl';
      }
    }

    // 2. Try email fallback
    if (!foundContact && customerEmail) {
      foundContact = await findContactByEmail(customerEmail, allContacts);
      if (foundContact) {
        matchType = 'email';
      }
    }

    // 3. Try phone fallback
    if (!foundContact && customerPhone) {
      foundContact = await findContactByPhone(customerPhone, allContacts);
      if (foundContact) {
        matchType = 'phone';
      }
    }

    // 4. Try name fallback (most flexible)
    if (!foundContact && customerName) {
      foundContact = await findContactByName(customerName, allContacts);
      if (foundContact) {
        matchType = 'name';
      }
    }

    if (!foundContact) {
      results.push({
        row,
        status: 'contact_not_found',
      });
      continue;
    }

    // Find campaign by name (case-insensitive)
    const foundCampaign = campaignsByName.get(campaignName.toLowerCase());
    if (!foundCampaign) {
      results.push({
        row,
        status: 'campaign_not_found',
        contactId: foundContact.id,
      });
      continue;
    }

    // Find donation with matching amount for this contact
    const contactDonations = donationsByContact.get(foundContact.id) || [];
    const matchingDonation = contactDonations.find(d => d.amount === amount);

    if (!matchingDonation) {
      results.push({
        row,
        status: 'donation_not_found',
        contactId: foundContact.id,
        campaignId: foundCampaign.id,
      });
      continue;
    }

    // Update the donation's campaign
    try {
      await db
        .update(manualDonation)
        .set({ campaignId: foundCampaign.id })
        .where(eq(manualDonation.id, matchingDonation.id))
        .execute();

      results.push({
        row,
        status: 'updated',
        contactId: foundContact.id,
        donationId: matchingDonation.id,
        campaignId: foundCampaign.id,
        oldCampaignId: matchingDonation.campaignId,
        matchType,
      });
    } catch (err: any) {
      results.push({
        row,
        status: 'error',
        contactId: foundContact.id,
        donationId: matchingDonation.id,
        campaignId: foundCampaign.id,
        matchType,
        error: err.message,
      });
    }
  }

  console.log('\n');

  // Categorize results
  const updated = results.filter(r => r.status === 'updated');
  const contactNotFound = results.filter(r => r.status === 'contact_not_found');
  const donationNotFound = results.filter(r => r.status === 'donation_not_found');
  const campaignNotFound = results.filter(r => r.status === 'campaign_not_found');
  const errors = results.filter(r => r.status === 'error');

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║           UPDATE SUMMARY               ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`📊 Total rows processed:     ${csvRows.length}`);
  console.log(`✅ Successfully updated:     ${updated.length}`);
  console.log(`❌ Contact not found:        ${contactNotFound.length}`);
  console.log(`❌ Donation not found:       ${donationNotFound.length}`);
  console.log(`❌ Campaign not found:       ${campaignNotFound.length}`);
  console.log(`❌ Errors:                   ${errors.length}`);

  // Show match type breakdown for updated records
  const ghlMatches = updated.filter(r => r.matchType === 'ghl').length;
  const emailMatches = updated.filter(r => r.matchType === 'email').length;
  const phoneMatches = updated.filter(r => r.matchType === 'phone').length;
  const nameMatches = updated.filter(r => r.matchType === 'name').length;
  console.log(`\n📈 Match types: GHL=${ghlMatches}, Email=${emailMatches}, Phone=${phoneMatches}, Name=${nameMatches}`);

  // Show examples of issues
  if (contactNotFound.length > 0) {
    console.log('\n⚠️  Sample contacts not found (first 5):');
    contactNotFound.slice(0, 5).forEach(r => {
      console.log(`  - Customer ID: ${r.row['Customer Id']} | Name: ${r.row['Customer Name']}`);
    });
  }

  if (donationNotFound.length > 0) {
    console.log('\n⚠️  Sample donations not found (first 5):');
    donationNotFound.slice(0, 5).forEach(r => {
      console.log(`  - Contact ID: ${r.contactId} | Amount: $${normalizeAmount(r.row['Invoice Total'])} | Campaign: ${r.row.campaign}`);
    });
  }

  if (campaignNotFound.length > 0) {
    console.log('\n⚠️  Campaigns not found:');
    const uniqueCampaigns = [...new Set(campaignNotFound.map(r => r.row.campaign))];
    uniqueCampaigns.forEach(c => {
      const count = campaignNotFound.filter(r => r.row.campaign === c).length;
      console.log(`  - "${c}" (${count} occurrences)`);
    });
  }

  if (errors.length > 0) {
    console.log('\n❌ Errors encountered (first 5):');
    errors.slice(0, 5).forEach(r => {
      console.log(`  - Donation ID: ${r.donationId} | Error: ${r.error}`);
    });
  }

  // Generate timestamp for files
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // Export detailed results
  if (updated.length > 0) {
    const updatedPath = path.join(OUTPUT_DIR, `updated-campaigns-${timestamp}.csv`);
    const updatedData = updated.map(r => ({
      'Customer ID': r.row['Customer Id'],
      'Customer Name': r.row['Customer Name'],
      'Match Type': r.matchType || 'unknown',
      'Amount': normalizeAmount(r.row['Invoice Total']),
      'Campaign Name': r.row.campaign,
      'Contact ID': r.contactId,
      'Donation ID': r.donationId,
      'New Campaign ID': r.campaignId,
      'Old Campaign ID': r.oldCampaignId || 'None',
    }));
    writeCsv(updatedPath, updatedData);
    console.log(`\n📤 Updated campaigns exported to: ${updatedPath}`);
  }

  if (contactNotFound.length > 0) {
    const notFoundPath = path.join(OUTPUT_DIR, `contact-not-found-${timestamp}.csv`);
    const notFoundData = contactNotFound.map(r => ({
      'Customer ID': r.row['Customer Id'],
      'Customer Name': r.row['Customer Name'],
      'Email': r.row['Customer Email'],
      'Phone': r.row['Customer Phone No '],
      'Amount': normalizeAmount(r.row['Invoice Total']),
      'Campaign Name': r.row.campaign,
    }));
    writeCsv(notFoundPath, notFoundData);
    console.log(`📤 Contacts not found: ${notFoundPath}`);
  }

  if (donationNotFound.length > 0) {
    const donNotFoundPath = path.join(OUTPUT_DIR, `donation-not-found-${timestamp}.csv`);
    const donNotFoundData = donationNotFound.map(r => ({
      'Customer ID': r.row['Customer Id'],
      'Customer Name': r.row['Customer Name'],
      'Contact ID': r.contactId,
      'Amount': normalizeAmount(r.row['Invoice Total']),
      'Campaign Name': r.row.campaign,
      'Campaign ID': r.campaignId,
    }));
    writeCsv(donNotFoundPath, donNotFoundData);
    console.log(`📤 Donations not found: ${donNotFoundPath}`);
  }

  if (campaignNotFound.length > 0) {
    const campNotFoundPath = path.join(OUTPUT_DIR, `campaign-not-found-${timestamp}.csv`);
    const campNotFoundData = campaignNotFound.map(r => ({
      'Customer ID': r.row['Customer Id'],
      'Customer Name': r.row['Customer Name'],
      'Contact ID': r.contactId,
      'Amount': normalizeAmount(r.row['Invoice Total']),
      'Campaign Name': r.row.campaign,
    }));
    writeCsv(campNotFoundPath, campNotFoundData);
    console.log(`📤 Campaigns not found: ${campNotFoundPath}`);
  }

  if (errors.length > 0) {
    const errorsPath = path.join(OUTPUT_DIR, `update-errors-${timestamp}.csv`);
    const errorsData = errors.map(r => ({
      'Customer ID': r.row['Customer Id'],
      'Customer Name': r.row['Customer Name'],
      'Contact ID': r.contactId,
      'Donation ID': r.donationId,
      'Match Type': r.matchType || 'unknown',
      'Amount': normalizeAmount(r.row['Invoice Total']),
      'Campaign Name': r.row.campaign,
      'Error': r.error,
    }));
    writeCsv(errorsPath, errorsData);
    console.log(`📤 Errors: ${errorsPath}`);
  }

  console.log('\n✅ Campaign update complete!\n');
}

main().catch((e) => {
  console.error('\n❌ FATAL ERROR:', e);
  process.exit(1);
});
