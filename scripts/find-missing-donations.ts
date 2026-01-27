// scripts/import-simple-donations.ts
import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '@/lib/db';
import { contact, manualDonation, paymentMethods } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Configuration
const CSV_PATH = './data/ch.csv';
const OUTPUT_DIR = './data/exports';
const LOCATION_ID = '4Nzcp3vUgVbOoN9uxu5F';
const BATCH_SIZE = 100;
const DRY_RUN = false;

interface SimpleDonationRow {
  'Name': string;
  'Email': string;
  'Phone': string;
  'Date': string;
  'Payment method': string;
  'Amount': string;
}

interface ProcessedResult {
  row: SimpleDonationRow;
  contactId?: number;
  paymentMethodId?: number;
  matchedBy?: 'email' | 'name' | 'notFound';
  paymentMethodMatched?: boolean;
  status: 'exists' | 'missing' | 'contact_not_found';
  existingDonationId?: number;
  reason?: string;
}

// Utility functions
function parseCSV(filePath: string): SimpleDonationRow[] {
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

  return parsed.data as SimpleDonationRow[];
}

function normalizeDate(dateStr: string): string {
  // Handle DD/MM/YYYY format
  const parts = dateStr.trim().split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    
    // Create date as YYYY-MM-DD
    const date = new Date(`${year}-${month}-${day}`);
    if (!isNaN(date.getTime())) {
      const yearNum = date.getFullYear();
      const monthNum = String(date.getMonth() + 1).padStart(2, '0');
      const dayNum = String(date.getDate()).padStart(2, '0');
      return `${yearNum}-${monthNum}-${dayNum}`;
    }
  }
  
  // Fallback: try parsing as-is
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

function cleanPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 10 ? cleaned : undefined;
}

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

// Main logic
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   IMPORT SIMPLE DONATIONS              ║');
  console.log('╚════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made to database\n');
  }

  console.log(`📍 Target Location ID: ${LOCATION_ID}\n`);

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
  console.log(`📂 Reading CSV: ${path.resolve(CSV_PATH)}`);
  const donationRows = parseCSV(CSV_PATH);
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
  const contactsByDisplayName = new Map(
    allContacts.map(c => [c.displayName?.toLowerCase() || '', c])
  );

  console.log(`✓ Loaded ${allContacts.length} contacts`);
  console.log(`  - By Email: ${contactsByEmail.size}`);
  console.log(`  - By Display Name: ${contactsByDisplayName.size}\n`);

  // Pre-load all payment methods for this location
  console.log(`📥 Loading payment methods for location...`);
  const allPaymentMethods = await db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.locationId, LOCATION_ID))
    .execute();

  const paymentMethodsByName = new Map(
    allPaymentMethods.map(pm => [pm.name.toLowerCase().trim(), pm])
  );

  console.log(`✓ Loaded ${allPaymentMethods.length} payment methods\n`);

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

  // Process each row to identify missing items
  console.log('🔍 Analyzing donations...\n');
  const results: ProcessedResult[] = [];
  const missingPaymentMethodsToCreate = new Set<string>();
  const missingContactsToCreate = new Map<string, {
    firstName: string;
    lastName: string;
    displayName: string;
    email?: string;
    phone?: string;
    locationId: string;
  }>();

  let processed = 0;
  for (const row of donationRows) {
    processed++;
    if (processed % 10 === 0) {
      process.stdout.write(`\r  Progress: ${processed}/${donationRows.length}`);
    }

    const name = (row['Name'] || '').trim();
    const email = cleanEmail(row['Email']);
    const phone = cleanPhone(row['Phone']);
    const amount = normalizeAmount(row['Amount']);
    const donationDate = normalizeDate(row['Date']);
    const paymentMethodName = (row['Payment method'] || '').trim();

    // Track missing payment methods
    if (paymentMethodName && !paymentMethodsByName.has(paymentMethodName.toLowerCase())) {
      missingPaymentMethodsToCreate.add(paymentMethodName);
    }

    // Try to find contact
    let foundContact = null;
    let matchedBy: 'email' | 'name' | 'notFound' = 'notFound';

    if (email && contactsByEmail.has(email)) {
      foundContact = contactsByEmail.get(email)!;
      matchedBy = 'email';
    } else if (name && contactsByDisplayName.has(name.toLowerCase())) {
      foundContact = contactsByDisplayName.get(name.toLowerCase())!;
      matchedBy = 'name';
    }

    if (!foundContact) {
      // Prepare to create new contact
      const contactKey = email || name;
      if (contactKey && !missingContactsToCreate.has(contactKey)) {
        // Split name into first and last
        const nameParts = name.split(/\s+/);
        const firstName = nameParts[0] || 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || '';

        missingContactsToCreate.set(contactKey, {
          firstName: firstName,
          lastName: lastName,
          displayName: name || `${firstName} ${lastName}`.trim(),
          email: email,
          phone: phone,
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

    // Try to find payment method
    let foundPaymentMethod = paymentMethodName 
      ? paymentMethodsByName.get(paymentMethodName.toLowerCase()) 
      : null;

    // Check if manual donation exists
    const existingDonation = allManualDonations.find(md => {
      const contactMatch = md.contactId === foundContact!.id;
      const amountMatch = md.amount === amount;
      
      const donationDateObj = new Date(md.paymentDate);
      const transDateObj = new Date(donationDate);
      const daysDiff = Math.abs((donationDateObj.getTime() - transDateObj.getTime()) / (1000 * 60 * 60 * 24));
      const dateMatch = daysDiff <= 1;

      return contactMatch && amountMatch && dateMatch;
    });

    if (existingDonation) {
      results.push({
        row,
        contactId: foundContact.id,
        paymentMethodId: foundPaymentMethod?.id,
        matchedBy,
        paymentMethodMatched: !!foundPaymentMethod,
        status: 'exists',
        existingDonationId: existingDonation.id,
      });
    } else {
      results.push({
        row,
        contactId: foundContact.id,
        paymentMethodId: foundPaymentMethod?.id,
        matchedBy,
        paymentMethodMatched: !!foundPaymentMethod,
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

  if (missingPaymentMethodsToCreate.size > 0) {
    console.log(`\n⚠️  Payment methods to create: ${missingPaymentMethodsToCreate.size}`);
    console.log(`    ${Array.from(missingPaymentMethodsToCreate).join(', ')}`);
  }

  if (missingContactsToCreate.size > 0) {
    console.log(`\n⚠️  Contacts to create: ${missingContactsToCreate.size}`);
  }

  // Generate timestamp for file names
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // === START IMPORT PROCESS ===
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
        if (c.email) contactsByEmail.set(c.email.toLowerCase(), c);
        if (c.displayName) contactsByDisplayName.set(c.displayName.toLowerCase(), c);
      });
      
      console.log(`  ✓ Created ${createdContacts.length} contacts\n`);

      // Update results with new contact IDs
      for (const result of results) {
        if (result.status === 'contact_not_found') {
          const email = cleanEmail(result.row['Email']);
          const name = result.row['Name'];
          const newContact = createdContacts.find(c => 
            (email && c.email?.toLowerCase() === email) ||
            (c.displayName?.toLowerCase() === name.toLowerCase())
          );
          if (newContact) {
            result.contactId = newContact.id;
            result.status = 'missing';
            result.matchedBy = email ? 'email' : 'name';
            result.reason = 'Manual donation not found for this contact/amount/date';
          }
        }
      }

      console.log(`  ✓ Updated missing donations count: ${results.filter(r => r.status === 'missing').length}\n`);
    }

    // Create missing payment methods
    if (missingPaymentMethodsToCreate.size > 0) {
      console.log(`💳 Creating ${missingPaymentMethodsToCreate.size} payment methods...`);
      const paymentMethodValues = Array.from(missingPaymentMethodsToCreate).map(name => ({
        name,
        description: `Auto-created from import: ${name}`,
        locationId: LOCATION_ID,
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

    const finalMissingDonations = results.filter(r => r.status === 'missing');

    for (const result of finalMissingDonations) {
      const row = result.row;
      const amount = normalizeAmount(row['Amount']);
      const paymentDate = normalizeDate(row['Date']);
      const paymentMethodName = (row['Payment method'] || '').trim();

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
        campaignId: null, // No campaign for simple donations
        paymentMethod: paymentMethodName || 'Other',
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
        notes: `Imported from CSV - ${row['Name']}`,
        _rowData: row,
      });

      importLog.push({
        'Name': row['Name'],
        'Email': row['Email'],
        'Phone': row['Phone'],
        'Amount': amount,
        'Payment Date': paymentDate,
        'Payment Method': paymentMethodName,
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
        
        batch.forEach((d, idx) => {
          const logIndex = importLog.findIndex(
            log => log['Email'] === d._rowData['Email'] && 
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
        
        batch.forEach(d => {
          const logIndex = importLog.findIndex(
            log => log['Email'] === d._rowData['Email']
          );
          if (logIndex >= 0) {
            importLog[logIndex]['Status'] = 'failed';
            importLog[logIndex]['Error'] = err.message;
          }
        });
      }
    }
    
    console.log(`\n✓ Total created: ${totalCreated} donations`);

    const importPath = path.join(OUTPUT_DIR, `imported-simple-donations-${timestamp}.csv`);
    writeCsv(importPath, importLog);
    console.log(`\n📤 Import log saved to: ${importPath}`);
  }

  // Write analysis CSVs
  if (missingDonations.length > 0 || missingContactsToCreate.size > 0) {
    const missingPath = path.join(OUTPUT_DIR, `missing-simple-donations-${timestamp}.csv`);
    const allMissingData = [
      ...missingDonations.map(md => ({
        'Name': md.row['Name'],
        'Email': md.row['Email'],
        'Phone': md.row['Phone'],
        'Amount': md.row['Amount'],
        'Payment Method': md.row['Payment method'],
        'Date': md.row['Date'],
        'Normalized Date': normalizeDate(md.row['Date']),
        'Normalized Amount': normalizeAmount(md.row['Amount']),
        'Contact ID': md.contactId,
        'Payment Method Matched': md.paymentMethodMatched ? 'Yes' : 'No',
        'Matched By': md.matchedBy,
        'Contact Status': 'Existing',
      })),
      ...Array.from(missingContactsToCreate.entries()).map(([key, contactData]) => {
        const relatedRow = results.find(r => 
          cleanEmail(r.row['Email']) === key || r.row['Name'] === key
        )?.row;
        return relatedRow ? {
          'Name': relatedRow['Name'],
          'Email': relatedRow['Email'],
          'Phone': relatedRow['Phone'],
          'Amount': relatedRow['Amount'],
          'Payment Method': relatedRow['Payment method'],
          'Date': relatedRow['Date'],
          'Normalized Date': normalizeDate(relatedRow['Date']),
          'Normalized Amount': normalizeAmount(relatedRow['Amount']),
          'Contact ID': '',
          'Payment Method Matched': '',
          'Matched By': 'Will be created',
          'Contact Status': 'New Contact',
        } : null;
      }).filter(Boolean),
    ];
    writeCsv(missingPath, allMissingData);
    console.log(`\n📤 Missing donations analysis: ${missingPath}`);
  }

  if (contactNotFound.length > 0) {
    const notFoundPath = path.join(OUTPUT_DIR, `contact-not-found-simple-${timestamp}.csv`);
    const notFoundData = contactNotFound.map(nf => ({
      'Name': nf.row['Name'],
      'Email': nf.row['Email'],
      'Phone': nf.row['Phone'],
      'Amount': nf.row['Amount'],
      'Payment Method': nf.row['Payment method'],
      'Date': nf.row['Date'],
      'Reason': nf.reason,
    }));
    writeCsv(notFoundPath, notFoundData);
    console.log(`📤 Contacts not found: ${notFoundPath}`);
  }

  if (existingDonations.length > 0) {
    const existsPath = path.join(OUTPUT_DIR, `already-exists-simple-${timestamp}.csv`);
    const existsData = existingDonations.map(fd => ({
      'Name': fd.row['Name'],
      'Email': fd.row['Email'],
      'Amount': fd.row['Amount'],
      'Payment Method': fd.row['Payment method'],
      'Date': fd.row['Date'],
      'Contact ID': fd.contactId,
      'Payment Method Matched': fd.paymentMethodMatched ? 'Yes' : 'No',
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