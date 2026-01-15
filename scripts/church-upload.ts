// scripts/import-manual-donations.ts
import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '@/lib/db';
import { contact, manualDonation, campaign, paymentMethods } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Configuration
const DONATION_CSV_PATH = './data/church.csv';
const OUTPUT_DIR = './data/exports';
const LOCATION_ID = '4Nzcp3vUgVbOoN9uxu5F';
const DEFAULT_PAYMENT_METHOD = 'Cash';
const BATCH_SIZE = 100;
const DRY_RUN = false;

interface DonationRow {
  'Donation Total': string;
  'Donation Date': string;
  'First Name': string;
  'Last Name': string;
  'Email Address': string;
  'Address 1': string;
  'Address 2': string;
  'City': string;
  'State': string;
  'Zip': string;
  'Country': string;
  'Donor Phone Number': string;
  'Notes': string;
  'Campaign': string;
}

interface ProcessedResult {
  row: DonationRow;
  contactId?: number;
  campaignId?: number;
  matchedBy?: 'email' | 'name' | 'notFound' | 'created';
  campaignMatched?: boolean;
  status: 'exists' | 'missing' | 'contact_not_found' | 'imported' | 'failed';
  existingDonationId?: number;
  newDonationId?: number;
  reason?: string;
  error?: string;
}

// Utility functions
function parseCSV(filePath: string): DonationRow[] {
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

  return parsed.data as DonationRow[];
}

function normalizeDate(dateStr: string): string {
  // Handle formats like "11-Oct-24" or "6-Dec-18"
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    console.warn(`Invalid date: ${dateStr}, using today`);
    return new Date().toISOString().slice(0, 10);
  }
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

function normalizeAmount(amount: string | number): string {
  if (typeof amount === 'number') return amount.toFixed(2);
  const cleaned = String(amount).replace(/[^0-9.\-]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
}

function cleanEmail(email?: string): string | undefined {
  if (!email) return undefined;
  const cleaned = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : undefined;
}

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

// Main logic
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║    IMPORT MANUAL DONATIONS SCRIPT      ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log(`📍 Location ID: ${LOCATION_ID}`);
  console.log(`💵 Default Payment Method: ${DEFAULT_PAYMENT_METHOD}\n`);

  // Test database connection
  await db
    .select()
    .from(contact)
    .limit(1)
    .execute()
    .catch((e) => {
      console.error('❌ Database connection failed:', e);
      process.exit(1);
    });

  console.log('✓ Database connected\n');

  // Parse CSV
  console.log(`📂 Reading CSV: ${path.resolve(DONATION_CSV_PATH)}`);
  const donationRows = parseCSV(DONATION_CSV_PATH);
  console.log(`✓ Loaded ${donationRows.length} rows\n`);

  // Pre-load all contacts for this location
  console.log(`📥 Loading contacts for location ${LOCATION_ID}...`);
  const allContacts = await db
    .select()
    .from(contact)
    .where(eq(contact.locationId, LOCATION_ID))
    .execute();
  
  const contactsByEmail = new Map(
    allContacts
      .filter(c => c.email)
      .map(c => [c.email!.toLowerCase(), c])
  );
  
  const contactsByName = new Map(
    allContacts.map(c => {
      const key = `${c.firstName?.toLowerCase() || ''} ${c.lastName?.toLowerCase() || ''}`.trim();
      return [key, c];
    })
  );

  console.log(`✓ Loaded ${allContacts.length} contacts`);
  console.log(`  - By Email: ${contactsByEmail.size}`);
  console.log(`  - By Name: ${contactsByName.size}\n`);

  // Pre-load all campaigns for this location
  console.log(`📥 Loading campaigns for location...`);
  const allCampaigns = await db
    .select()
    .from(campaign)
    .where(eq(campaign.locationId, LOCATION_ID))
    .execute();

  const campaignsByName = new Map(
    allCampaigns.map(c => [c.name.toLowerCase().trim(), c])
  );

  console.log(`✓ Loaded ${allCampaigns.length} campaigns\n`);

  // Check/create default payment method
  console.log(`💳 Checking payment method "${DEFAULT_PAYMENT_METHOD}"...`);
  const allPaymentMethods = await db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.locationId, LOCATION_ID))
    .execute();

  let cashPaymentMethod = allPaymentMethods.find(
    pm => pm.name.toLowerCase() === DEFAULT_PAYMENT_METHOD.toLowerCase()
  );

  if (!cashPaymentMethod) {
    console.log(`  Creating payment method "${DEFAULT_PAYMENT_METHOD}"...`);
    const [created] = await db
      .insert(paymentMethods)
      .values({
        name: DEFAULT_PAYMENT_METHOD,
        description: 'Cash payments',
        locationId: LOCATION_ID,
        isActive: true,
      })
      .returning();
    cashPaymentMethod = created;
    console.log(`  ✓ Created payment method\n`);
  } else {
    console.log(`✓ Payment method exists\n`);
  }

  // Pre-load all manual donations for this location
  console.log(`📥 Loading manual donations for location...`);
  const allManualDonations = await db
    .select()
    .from(manualDonation)
    .innerJoin(contact, eq(manualDonation.contactId, contact.id))
    .where(eq(contact.locationId, LOCATION_ID))
    .execute()
    .then(results => results.map(r => r.manual_donation));
  
  console.log(`✓ Loaded ${allManualDonations.length} manual donations\n`);

  // Process each row
  console.log('🔍 Analyzing donations...\n');
  const results: ProcessedResult[] = [];
  const missingCampaignsToCreate = new Set<string>();
  const missingContactsToCreate = new Map<string, {
    firstName: string;
    lastName: string;
    displayName: string;
    email?: string;
    phone?: string;
    address?: string;
    locationId: string;
  }>();

  let processed = 0;
  for (const row of donationRows) {
    processed++;
    if (processed % 10 === 0) {
      process.stdout.write(`\r  Progress: ${processed}/${donationRows.length}`);
    }

    const email = cleanEmail(row['Email Address']);
    const firstName = (row['First Name'] || '').trim();
    const lastName = (row['Last Name'] || '').trim();
    const fullName = `${firstName} ${lastName}`.toLowerCase().trim();
    const amount = normalizeAmount(row['Donation Total']);
    const donationDate = normalizeDate(row['Donation Date']);
    const campaignName = (row['Campaign'] || '').trim();
    const phone = (row['Donor Phone Number'] || '').trim();
    
    // Build address
    const addressParts = [
      row['Address 1'],
      row['Address 2'],
      row['City'],
      row['State'],
      row['Zip'],
      row['Country']
    ].filter(p => p && p.trim());
    const address = addressParts.join(', ');

    // Track missing campaigns
    if (campaignName && !campaignsByName.has(campaignName.toLowerCase())) {
      missingCampaignsToCreate.add(campaignName);
    }

    // Try to find contact
    let foundContact = null;
    let matchedBy: 'email' | 'name' | 'notFound' | 'created' = 'notFound';

    if (email && contactsByEmail.has(email)) {
      foundContact = contactsByEmail.get(email)!;
      matchedBy = 'email';
    } else if (fullName && contactsByName.has(fullName)) {
      foundContact = contactsByName.get(fullName)!;
      matchedBy = 'name';
    }

    if (!foundContact) {
      // Prepare to create new contact
      const contactKey = email || fullName;
      if (contactKey && !missingContactsToCreate.has(contactKey)) {
        missingContactsToCreate.set(contactKey, {
          firstName: firstName || 'Unknown',
          lastName: lastName || '',
          displayName: `${firstName} ${lastName}`.trim() || 'Unknown',
          email: email,
          phone: phone || undefined,
          address: address || undefined,
          locationId: LOCATION_ID,
        });
      }

      results.push({
        row,
        matchedBy: 'notFound',
        status: 'contact_not_found',
        reason: 'Contact will be created',
      });
      continue;
    }

    // Try to find campaign
    let foundCampaign = campaignName ? campaignsByName.get(campaignName.toLowerCase()) : null;

    // Check if manual donation exists (same contact, amount, and date within 1 day)
    const existingDonation = allManualDonations.find(md => {
      const contactMatch = md.contactId === foundContact!.id;
      const amountMatch = md.amount === amount;
      
      const donationDateObj = new Date(md.paymentDate);
      const transDate = new Date(donationDate);
      const daysDiff = Math.abs((donationDateObj.getTime() - transDate.getTime()) / (1000 * 60 * 60 * 24));
      const dateMatch = daysDiff <= 1;

      return contactMatch && amountMatch && dateMatch;
    });

    if (existingDonation) {
      results.push({
        row,
        contactId: foundContact.id,
        campaignId: foundCampaign?.id,
        matchedBy,
        campaignMatched: !!foundCampaign,
        status: 'exists',
        existingDonationId: existingDonation.id,
      });
    } else {
      results.push({
        row,
        contactId: foundContact.id,
        campaignId: foundCampaign?.id,
        matchedBy,
        campaignMatched: !!foundCampaign,
        status: 'missing',
        reason: 'Manual donation not found for this contact/amount/date',
      });
    }
  }

  console.log('\n');

  // Categorize results
  const existingDonations = results.filter(r => r.status === 'exists');
  const missingDonations = results.filter(r => r.status === 'missing');
  const contactNotFound = results.filter(r => r.status === 'contact_not_found');

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║           ANALYSIS SUMMARY             ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`📊 Total rows processed:     ${donationRows.length}`);
  console.log(`✅ Already exists:           ${existingDonations.length}`);
  console.log(`❌ Missing donations:        ${missingDonations.length}`);
  console.log(`⚠️  Contact not found:       ${contactNotFound.length}`);

  if (missingCampaignsToCreate.size > 0) {
    console.log(`\n⚠️  Campaigns to create: ${missingCampaignsToCreate.size}`);
    console.log(`    ${Array.from(missingCampaignsToCreate).join(', ')}`);
  }

  if (missingContactsToCreate.size > 0) {
    console.log(`\n⚠️  Contacts to create: ${missingContactsToCreate.size}`);
  }

  // Generate timestamp for file names
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // === START IMPORT PROCESS ===
  const donationsToProcess = missingDonations.length > 0 || contactNotFound.length > 0;
  
  if (donationsToProcess) {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║         STARTING IMPORT PROCESS        ║');
    console.log('╚════════════════════════════════════════╝\n');

    // Create missing contacts first
    if (missingContactsToCreate.size > 0) {
      console.log(`👤 Creating ${missingContactsToCreate.size} contacts...`);
      const contactValues = Array.from(missingContactsToCreate.values());

      const createdContacts = await db.insert(contact).values(contactValues).returning();
      
      // Update caches with new contacts
      createdContacts.forEach(c => {
        if (c.email) contactsByEmail.set(c.email.toLowerCase(), c);
        const nameKey = `${c.firstName?.toLowerCase() || ''} ${c.lastName?.toLowerCase() || ''}`.trim();
        if (nameKey) contactsByName.set(nameKey, c);
      });
      
      console.log(`  ✓ Created ${createdContacts.length} contacts\n`);

      // Update results with new contact IDs
      for (const result of results) {
        if (result.status === 'contact_not_found') {
          const email = cleanEmail(result.row['Email Address']);
          const firstName = result.row['First Name'].trim();
          const lastName = result.row['Last Name'].trim();
          const fullName = `${firstName} ${lastName}`.toLowerCase().trim();

          let newContact = null;
          if (email) {
            newContact = createdContacts.find(c => c.email?.toLowerCase() === email);
          } else if (fullName) {
            newContact = createdContacts.find(c => 
              `${c.firstName?.toLowerCase()} ${c.lastName?.toLowerCase()}`.trim() === fullName
            );
          }

          if (newContact) {
            result.contactId = newContact.id;
            result.status = 'missing';
            result.matchedBy = 'created';
            result.reason = 'Manual donation not found for this contact/amount/date';
            
            // Update campaign reference
            const campaignName = (result.row['Campaign'] || '').trim();
            if (campaignName) {
              result.campaignId = campaignsByName.get(campaignName.toLowerCase())?.id;
              result.campaignMatched = !!result.campaignId;
            }
          }
        }
      }
    }

    // Create missing campaigns
    if (missingCampaignsToCreate.size > 0) {
      console.log(`🎯 Creating ${missingCampaignsToCreate.size} campaigns...`);
      const campaignValues = Array.from(missingCampaignsToCreate).map(name => ({
        name,
        description: `Auto-created from import: ${name}`,
        status: 'active' as const,
        locationId: LOCATION_ID,
      }));

      const createdCampaigns = await db.insert(campaign).values(campaignValues).returning();
      createdCampaigns.forEach(c => {
        campaignsByName.set(c.name.toLowerCase().trim(), c);
      });
      console.log(`  ✓ Created ${createdCampaigns.length} campaigns\n`);
    }

    // Prepare donations to insert
    const donationsToCreate: any[] = [];
    const importLog: any[] = [];

    // Get updated list of missing donations
    const finalMissingDonations = results.filter(r => r.status === 'missing');

    for (const result of finalMissingDonations) {
      const row = result.row;
      const amount = normalizeAmount(row['Donation Total']);
      const paymentDate = normalizeDate(row['Donation Date']);
      const campaignName = (row['Campaign'] || '').trim();
      const notes = row['Notes'] || '';

      // Get campaign ID
      const campaignId = campaignName 
        ? campaignsByName.get(campaignName.toLowerCase())?.id || null
        : null;

      donationsToCreate.push({
        contactId: result.contactId!,
        amount: amount,
        currency: 'USD',
        amountUsd: amount,
        exchangeRate: '1.00',
        paymentDate: paymentDate,
        receivedDate: paymentDate,
        checkDate: null,
        accountId: null,
        campaignId: campaignId,
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
        notes: notes || `Imported from CSV - ${row['First Name']} ${row['Last Name']}`,
        _rowData: row,
      });

      importLog.push({
        'First Name': row['First Name'],
        'Last Name': row['Last Name'],
        'Email': row['Email Address'],
        'Amount': amount,
        'Payment Date': paymentDate,
        'Campaign': campaignName,
        'Campaign ID': campaignId || '',
        'Contact ID': result.contactId,
        'Matched By': result.matchedBy,
        'Status': 'pending',
      });
    }

    // Insert donations in batches
    console.log(`💰 Inserting ${donationsToCreate.length} manual donations in batches...`);
    
    let totalCreated = 0;
    for (let i = 0; i < donationsToCreate.length; i += BATCH_SIZE) {
      const batch = donationsToCreate.slice(i, i + BATCH_SIZE);
      const batchToInsert = batch.map(d => {
        const { _rowData, ...rest } = d;
        return rest;
      });
      
      try {
        const created = await db.insert(manualDonation).values(batchToInsert).returning();
        totalCreated += created.length;
        
        // Update import log with donation IDs
        batch.forEach((d, idx) => {
          const logIndex = importLog.findIndex(
            log => log['Email'] === d._rowData['Email Address'] && 
                   log['Amount'] === d.amount &&
                   log['Payment Date'] === d.paymentDate
          );
          if (logIndex >= 0) {
            importLog[logIndex]['Donation ID'] = created[idx].id;
            importLog[logIndex]['Status'] = 'imported';
          }
        });
        
        console.log(`  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${created.length} donations`);
      } catch (err: any) {
        console.error(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, err.message);
        
        // Mark failed in log
        batch.forEach(d => {
          const logIndex = importLog.findIndex(
            log => log['Email'] === d._rowData['Email Address']
          );
          if (logIndex >= 0) {
            importLog[logIndex]['Status'] = 'failed';
            importLog[logIndex]['Error'] = err.message;
          }
        });
      }
    }
    
    console.log(`\n✓ Total created: ${totalCreated} donations`);

    // Write import log
    const importPath = path.join(OUTPUT_DIR, `imported-donations-${timestamp}.csv`);
    writeCsv(importPath, importLog);
    console.log(`\n📤 Import log saved to: ${importPath}`);
  }

  // Write analysis CSVs
  if (missingDonations.length > 0 || contactNotFound.length > 0) {
    const analysisPath = path.join(OUTPUT_DIR, `donation-analysis-${timestamp}.csv`);
    const analysisData = results.map(r => ({
      'First Name': r.row['First Name'],
      'Last Name': r.row['Last Name'],
      'Email': r.row['Email Address'],
      'Amount': r.row['Donation Total'],
      'Date': r.row['Donation Date'],
      'Campaign': r.row['Campaign'],
      'Contact ID': r.contactId || '',
      'Campaign ID': r.campaignId || '',
      'Matched By': r.matchedBy || '',
      'Status': r.status,
      'Reason': r.reason || '',
    }));
    writeCsv(analysisPath, analysisData);
    console.log(`\n📤 Full analysis saved to: ${analysisPath}`);
  }

  if (existingDonations.length > 0) {
    const existsPath = path.join(OUTPUT_DIR, `already-exists-${timestamp}.csv`);
    const existsData = existingDonations.map(fd => ({
      'First Name': fd.row['First Name'],
      'Last Name': fd.row['Last Name'],
      'Email': fd.row['Email Address'],
      'Amount': fd.row['Donation Total'],
      'Date': fd.row['Donation Date'],
      'Campaign': fd.row['Campaign'],
      'Contact ID': fd.contactId,
      'Campaign ID': fd.campaignId || '',
      'Matched By': fd.matchedBy,
      'Donation ID': fd.existingDonationId,
    }));
    writeCsv(existsPath, existsData);
    console.log(`📤 Already exists: ${existsPath}`);
  }

  const finalMessage = '\n✅ Import complete!\n';
  
  console.log(finalMessage);
}

main().catch((e) => {
  console.error('\n❌ FATAL ERROR:', e);
  process.exit(1);
});