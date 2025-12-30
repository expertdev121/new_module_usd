// scripts/find-and-import-missing-donations.ts
import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '@/lib/db';
import { contact, manualDonation, campaign, paymentMethods } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Configuration
const CHECK_CSV_PATH = './data/Just-One-Life-transactions-list-Dec-29-2025-4-22-01 - Just-One-Life-transactions-list-Dec-29-2025-4-22-01.csv';
const OUTPUT_DIR = './data/exports';
const BATCH_SIZE = 100;
const DRY_RUN = false;

interface CheckRow {
  'Location id': string;
  'Customer id': string;
  'Customer name': string;
  'Customer email': string;
  'Customer phone': string;
  'Payment method': string;
  'Total amount paid': string;
  'Source name': string;
  'Transaction date': string;
}

interface ProcessedResult {
  row: CheckRow;
  contactId?: number;
  campaignId?: number;
  matchedBy?: 'ghlContactId' | 'email' | 'displayName' | 'notFound';
  campaignMatched?: boolean;
  status: 'exists' | 'missing' | 'contact_not_found';
  existingDonationId?: number;
  reason?: string;
}

// Utility functions
function parseCSV(filePath: string): CheckRow[] {
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

  return parsed.data as CheckRow[];
}

function normalizeDate(dateStr: string): string {
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
  console.log('║   FIND & IMPORT MISSING DONATIONS      ║');
  console.log('╚════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made to database\n');
  }

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
  console.log(`📂 Reading CSV: ${path.resolve(CHECK_CSV_PATH)}`);
  const checkRows = parseCSV(CHECK_CSV_PATH);
  console.log(`✓ Loaded ${checkRows.length} rows\n`);

  // Get unique location IDs from CSV
  const locationIds = [...new Set(checkRows.map(r => r['Location id']))];
  console.log(`📍 Found ${locationIds.length} unique location(s): ${locationIds.join(', ')}\n`);

  // Pre-load all contacts for these locations
  console.log(`📥 Loading contacts for locations...`);
  const allContacts = await db
    .select()
    .from(contact)
    .execute()
    .then(contacts => contacts.filter(c => locationIds.includes(c.locationId || '')));
  
  const contactsByGhlId = new Map(
    allContacts
      .filter(c => c.ghlContactId)
      .map(c => [c.ghlContactId!, c])
  );
  const contactsByEmail = new Map(
    allContacts
      .filter(c => c.email)
      .map(c => [c.email!.toLowerCase(), c])
  );
  const contactsByDisplayName = new Map(
    allContacts.map(c => [c.displayName?.toLowerCase() || '', c])
  );

  console.log(`✓ Loaded ${allContacts.length} contacts`);
  console.log(`  - By GHL ID: ${contactsByGhlId.size}`);
  console.log(`  - By Email: ${contactsByEmail.size}`);
  console.log(`  - By Display Name: ${contactsByDisplayName.size}\n`);

  // Pre-load all campaigns for these locations
  console.log(`📥 Loading campaigns for locations...`);
  const allCampaigns = await db
    .select()
    .from(campaign)
    .execute()
    .then(campaigns => campaigns.filter(c => locationIds.includes(c.locationId || '')));

  const campaignsByName = new Map(
    allCampaigns.map(c => [c.name.toLowerCase().trim(), c])
  );

  console.log(`✓ Loaded ${allCampaigns.length} campaigns\n`);

  // Pre-load all payment methods for these locations
  console.log(`📥 Loading payment methods for locations...`);
  const allPaymentMethods = await db
    .select()
    .from(paymentMethods)
    .execute()
    .then(methods => methods.filter(m => locationIds.includes(m.locationId || '')));

  const paymentMethodsByName = new Map(
    allPaymentMethods.map(pm => [pm.name.toLowerCase().trim(), pm])
  );

  console.log(`✓ Loaded ${allPaymentMethods.length} payment methods\n`);

  // Pre-load all manual donations for these locations
  console.log(`📥 Loading manual donations for locations...`);
  const allManualDonations = await db
    .select()
    .from(manualDonation)
    .innerJoin(contact, eq(manualDonation.contactId, contact.id))
    .execute()
    .then(results => 
      results
        .filter(r => locationIds.includes(r.contact.locationId || ''))
        .map(r => r.manual_donation)
    );
  console.log(`✓ Loaded ${allManualDonations.length} manual donations\n`);

  // Process each row to identify missing items
  console.log('🔍 Analyzing donations...\n');
  const results: ProcessedResult[] = [];
  const missingCampaignsToCreate = new Map<string, string>(); // name -> locationId
  const missingPaymentMethodsToCreate = new Map<string, string>(); // name -> locationId
  const missingContactsToCreate = new Map<string, {
    ghlContactId: string;
    recordId?: string;
    raffelTickets?: string;
    firstName: string;
    lastName: string;
    displayName: string;
    email?: string;
    email2?: string;
    phone?: string;
    title?: string;
    gender?: 'male' | 'female';
    address?: string;
    locationId: string;
  }>(); // ghlContactId -> contact data

  let processed = 0;
  for (const row of checkRows) {
    processed++;
    if (processed % 10 === 0) {
      process.stdout.write(`\r  Progress: ${processed}/${checkRows.length}`);
    }

    const customerId = row['Customer id'];
    const customerEmail = cleanEmail(row['Customer email']);
    const customerName = (row['Customer name'] || '').trim();
    const customerPhone = (row['Customer phone'] || '').trim();
    const amount = normalizeAmount(row['Total amount paid']);
    const transactionDate = normalizeDate(row['Transaction date']);
    const campaignName = (row['Source name'] || '').trim();
    const paymentMethod = (row['Payment method'] || '').trim();
    const locationId = row['Location id'];

    // Track missing campaigns
    if (campaignName && !campaignsByName.has(campaignName.toLowerCase())) {
      missingCampaignsToCreate.set(campaignName, locationId);
    }

    // Track missing payment methods
    if (paymentMethod && !paymentMethodsByName.has(paymentMethod.toLowerCase())) {
      missingPaymentMethodsToCreate.set(paymentMethod, locationId);
    }

    // Try to find contact
    let foundContact = null;
    let matchedBy: 'ghlContactId' | 'email' | 'displayName' | 'notFound' = 'notFound';

    if (customerId && contactsByGhlId.has(customerId)) {
      foundContact = contactsByGhlId.get(customerId)!;
      matchedBy = 'ghlContactId';
    } else if (customerEmail && contactsByEmail.has(customerEmail)) {
      foundContact = contactsByEmail.get(customerEmail)!;
      matchedBy = 'email';
    } else if (customerName && contactsByDisplayName.has(customerName.toLowerCase())) {
      foundContact = contactsByDisplayName.get(customerName.toLowerCase())!;
      matchedBy = 'displayName';
    }

    if (!foundContact) {
      // Prepare to create new contact
      if (customerId && !missingContactsToCreate.has(customerId)) {
        // Split name into first and last
        const nameParts = customerName.split(/\s+/);
        const firstName = nameParts[0] || 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || '';

        missingContactsToCreate.set(customerId, {
          ghlContactId: customerId,
          recordId: undefined,
          raffelTickets: undefined,
          firstName,
          lastName,
          displayName: customerName || `${firstName} ${lastName}`.trim(),
          email: customerEmail,
          email2: undefined,
          phone: customerPhone || undefined,
          title: undefined,
          gender: undefined,
          address: undefined,
          locationId,
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

    // Check if manual donation exists
    const existingDonation = allManualDonations.find(md => {
      const contactMatch = md.contactId === foundContact!.id;
      const amountMatch = md.amount === amount;
      
      const donationDate = new Date(md.paymentDate);
      const transDate = new Date(transactionDate);
      const daysDiff = Math.abs((donationDate.getTime() - transDate.getTime()) / (1000 * 60 * 60 * 24));
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
  console.log(`📊 Total rows processed:     ${checkRows.length}`);
  console.log(`✅ Already exists:           ${existingDonations.length}`);
  console.log(`❌ Missing donations:        ${missingDonations.length}`);
  console.log(`⚠️  Contact not found:       ${contactNotFound.length}`);

  // Summary by location
  console.log('\n📊 Breakdown by Location:');
  for (const locationId of locationIds) {
    const locationResults = results.filter(r => r.row['Location id'] === locationId);
    const locationMissing = locationResults.filter(r => r.status === 'missing');
    const locationExists = locationResults.filter(r => r.status === 'exists');
    const locationNotFound = locationResults.filter(r => r.status === 'contact_not_found');
    console.log(`\n  ${locationId}:`);
    console.log(`    Total:           ${locationResults.length}`);
    console.log(`    Missing:         ${locationMissing.length}`);
    console.log(`    Already exists:  ${locationExists.length}`);
    console.log(`    Contact N/F:     ${locationNotFound.length}`);
  }

  if (missingCampaignsToCreate.size > 0) {
    console.log(`\n⚠️  Campaigns to create: ${missingCampaignsToCreate.size}`);
    console.log(`    ${Array.from(missingCampaignsToCreate.keys()).join(', ')}`);
  }

  if (missingPaymentMethodsToCreate.size > 0) {
    console.log(`\n⚠️  Payment methods to create: ${missingPaymentMethodsToCreate.size}`);
    console.log(`    ${Array.from(missingPaymentMethodsToCreate.keys()).join(', ')}`);
  }

  if (missingContactsToCreate.size > 0) {
    console.log(`\n⚠️  Contacts to create: ${missingContactsToCreate.size}`);
  }

  // Generate timestamp for file names
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // === START IMPORT PROCESS ===
  // FIXED: Check if there are ANY donations to process (missing OR contact_not_found)
  const donationsToProcess = missingDonations.length > 0 || contactNotFound.length > 0;
  
  if (!DRY_RUN && donationsToProcess) {
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
        if (c.ghlContactId) contactsByGhlId.set(c.ghlContactId, c);
        if (c.email) contactsByEmail.set(c.email.toLowerCase(), c);
        if (c.displayName) contactsByDisplayName.set(c.displayName.toLowerCase(), c);
      });
      
      console.log(`  ✓ Created ${createdContacts.length} contacts\n`);

      // Update results with new contact IDs
      for (const result of results) {
        if (result.status === 'contact_not_found') {
          const customerId = result.row['Customer id'];
          const newContact = createdContacts.find(c => c.ghlContactId === customerId);
          if (newContact) {
            result.contactId = newContact.id;
            result.status = 'missing'; // Change status to missing since we now have a contact
            result.matchedBy = 'ghlContactId';
            result.reason = 'Manual donation not found for this contact/amount/date';
          }
        }
      }

      // Recalculate missing donations (now includes newly created contacts)
      const updatedMissingDonations = results.filter(r => r.status === 'missing');
      console.log(`  ✓ Updated missing donations count: ${updatedMissingDonations.length}\n`);
    }

    // Create missing campaigns
    if (missingCampaignsToCreate.size > 0) {
      console.log(`🎯 Creating ${missingCampaignsToCreate.size} campaigns...`);
      const campaignValues = Array.from(missingCampaignsToCreate.entries()).map(([name, locationId]) => ({
        name,
        description: `Auto-created from import: ${name}`,
        status: 'active' as const,
        locationId,
      }));

      const createdCampaigns = await db.insert(campaign).values(campaignValues).returning();
      createdCampaigns.forEach(c => {
        campaignsByName.set(c.name.toLowerCase().trim(), c);
      });
      console.log(`  ✓ Created ${createdCampaigns.length} campaigns\n`);
    }

    // Create missing payment methods
    if (missingPaymentMethodsToCreate.size > 0) {
      console.log(`💳 Creating ${missingPaymentMethodsToCreate.size} payment methods...`);
      const paymentMethodValues = Array.from(missingPaymentMethodsToCreate.entries()).map(([name, locationId]) => ({
        name,
        description: `Auto-created from import: ${name}`,
        locationId,
        isActive: true,
      }));

      const createdPaymentMethods = await db.insert(paymentMethods).values(paymentMethodValues).returning();
      createdPaymentMethods.forEach(pm => {
        paymentMethodsByName.set(pm.name.toLowerCase().trim(), pm);
      });
      console.log(`  ✓ Created ${createdPaymentMethods.length} payment methods\n`);
    }

    // Prepare donations to insert
    const donationsToCreate: any[] = [];
    const importLog: any[] = [];

    // Get updated list of missing donations (includes newly created contacts)
    const finalMissingDonations = results.filter(r => r.status === 'missing');

    for (const result of finalMissingDonations) {
      const row = result.row;
      const amount = normalizeAmount(row['Total amount paid']);
      const paymentDate = normalizeDate(row['Transaction date']);
      const campaignName = (row['Source name'] || '').trim();
      const paymentMethod = (row['Payment method'] || '').trim();

      // Get campaign ID (now should exist)
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
        paymentMethod: paymentMethod,
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
        notes: `Imported from CSV - ${row['Customer name']}`,
        _rowData: row,
      });

      importLog.push({
        'Location ID': row['Location id'],
        'Customer ID': row['Customer id'],
        'Customer Name': row['Customer name'],
        'Amount': amount,
        'Payment Date': paymentDate,
        'Source name': campaignName,
        'Campaign ID': campaignId || '',
        'Payment Method': paymentMethod,
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
            log => log['Customer ID'] === d._rowData['Customer id'] && 
                   log['Amount'] === d.amount
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
            log => log['Customer ID'] === d._rowData['Customer id']
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

  // Write analysis CSVs (always generated)
  if (missingDonations.length > 0 || missingContactsToCreate.size > 0) {
    const missingPath = path.join(OUTPUT_DIR, `missing-donations-${timestamp}.csv`);
    const allMissingData = [
      ...missingDonations.map(md => ({
        'Location ID': md.row['Location id'],
        'Customer ID': md.row['Customer id'],
        'Customer Name': md.row['Customer name'],
        'Customer Email': md.row['Customer email'],
        'Customer Phone': md.row['Customer phone'],
        'Payment Method': md.row['Payment method'],
        'Amount': md.row['Total amount paid'],
        'Source name': md.row['Source name'],
        'Transaction Date': md.row['Transaction date'],
        'Normalized Date': normalizeDate(md.row['Transaction date']),
        'Normalized Amount': normalizeAmount(md.row['Total amount paid']),
        'Contact ID': md.contactId,
        'Campaign ID': md.campaignId || '',
        'Campaign Matched': md.campaignMatched ? 'Yes' : 'No',
        'Matched By': md.matchedBy,
        'Contact Status': 'Existing',
      })),
      ...Array.from(missingContactsToCreate.entries()).map(([customerId, contactData]) => {
        const relatedRow = results.find(r => r.row['Customer id'] === customerId)?.row;
        return relatedRow ? {
          'Location ID': relatedRow['Location id'],
          'Customer ID': relatedRow['Customer id'],
          'Customer Name': relatedRow['Customer name'],
          'Customer Email': relatedRow['Customer email'],
          'Customer Phone': relatedRow['Customer phone'],
          'Payment Method': relatedRow['Payment method'],
          'Amount': relatedRow['Total amount paid'],
          'Source name': relatedRow['Source name'],
          'Transaction Date': relatedRow['Transaction date'],
          'Normalized Date': normalizeDate(relatedRow['Transaction date']),
          'Normalized Amount': normalizeAmount(relatedRow['Total amount paid']),
          'Contact ID': '',
          'Campaign ID': '',
          'Campaign Matched': '',
          'Matched By': 'Will be created',
          'Contact Status': 'New Contact',
        } : null;
      }).filter(Boolean),
    ];
    writeCsv(missingPath, allMissingData);
    console.log(`\n📤 Missing donations analysis: ${missingPath}`);
  }

  if (contactNotFound.length > 0) {
    const notFoundPath = path.join(OUTPUT_DIR, `contact-not-found-${timestamp}.csv`);
    const notFoundData = contactNotFound.map(nf => ({
      'Location ID': nf.row['Location id'],
      'Customer ID': nf.row['Customer id'],
      'Customer Name': nf.row['Customer name'],
      'Customer Email': nf.row['Customer email'],
      'Customer Phone': nf.row['Customer phone'],
      'Amount': nf.row['Total amount paid'],
      'Source name': nf.row['Source name'],
      'Transaction Date': nf.row['Transaction date'],
      'Reason': nf.reason,
    }));
    writeCsv(notFoundPath, notFoundData);
    console.log(`📤 Contacts not found: ${notFoundPath}`);
  }

  if (existingDonations.length > 0) {
    const existsPath = path.join(OUTPUT_DIR, `already-exists-${timestamp}.csv`);
    const existsData = existingDonations.map(fd => ({
      'Location ID': fd.row['Location id'],
      'Customer ID': fd.row['Customer id'],
      'Customer Name': fd.row['Customer name'],
      'Amount': fd.row['Total amount paid'],
      'Source name': fd.row['Source name'],
      'Transaction Date': fd.row['Transaction date'],
      'Contact ID': fd.contactId,
      'Campaign ID': fd.campaignId || '',
      'Campaign Matched': fd.campaignMatched ? 'Yes' : 'No',
      'Matched By': fd.matchedBy,
      'Donation ID': fd.existingDonationId,
    }));
    writeCsv(existsPath, existsData);
    console.log(`📤 Already exists: ${existsPath}`);
  }

  const finalMessage = DRY_RUN 
    ? '\n✅ Analysis complete! No changes made to database (DRY RUN mode).\n'
    : '\n✅ Import complete!\n';
  
  console.log(finalMessage);
}

main().catch((e) => {
  console.error('\n❌ FATAL ERROR:', e);
  process.exit(1);
});