// scripts/import-donations-simple.ts
import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '@/lib/db';
import { contact, manualDonation, paymentMethods } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Configuration
const CSV_PATH = './data/north_history.csv';
const OUTPUT_DIR = './data/exports';
const BATCH_SIZE = 100;
const DRY_RUN = false;
const DEFAULT_PAYMENT_METHOD = 'PayPal';
const LOCATION_ID = 'g9JSoJ1FInnA6N0SHXi7'; 

interface DonationRow {
  'Date': string;
  'Name': string;
  'Email': string;
  'Deposit': string;
}

interface ProcessedResult {
  row: DonationRow;
  contactId?: number;
  paymentMethodId?: number;
  matchedBy?: 'email' | 'name' | 'notFound';
  paymentMethodMatched?: boolean;
  status: 'exists' | 'missing' | 'contact_not_found';
  existingDonationId?: number;
  reason?: string;
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

function normalizeDateTime(dateTimeStr: string): string {
  // Handle MM/DD/YY format
  const parts = dateTimeStr.trim().split('/');
  
  if (parts.length === 3) {
    let [month, day, year] = parts;
    
    // Convert 2-digit year to 4-digit
    if (year.length === 2) {
      const yearNum = parseInt(year, 10);
      // Assuming years 00-50 are 2000-2050, 51-99 are 1951-1999
      year = yearNum >= 0 && yearNum <= 50 ? `20${year}` : `19${year}`;
    }
    
    const paddedMonth = month.padStart(2, '0');
    const paddedDay = day.padStart(2, '0');
    
    return `${year}-${paddedMonth}-${paddedDay}`;
  }
  
  // Fallback: try parsing as-is
  const date = new Date(dateTimeStr);
  if (isNaN(date.getTime())) {
    console.warn(`Invalid date: ${dateTimeStr}, using today`);
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

function cleanString(str?: string): string | undefined {
  if (!str) return undefined;
  const cleaned = str.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function parseNameToFirstLast(fullName: string): { firstName: string; lastName: string } {
  const cleaned = fullName.trim();
  
  // Check if it's a business name (contains common business indicators)
  const businessIndicators = ['Inc', 'LLC', 'Ltd', 'Corp', 'Company', 'Foundation', 'CHABAD', 'MD,'];
  const isBusiness = businessIndicators.some(indicator => 
    cleaned.includes(indicator)
  );
  
  if (isBusiness) {
    return {
      firstName: cleaned,
      lastName: ''
    };
  }
  
  // Split on space and take first word as first name, rest as last name
  const parts = cleaned.split(/\s+/);
  
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: ''
    };
  }
  
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

// Main logic
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   IMPORT DONATIONS - SIMPLE FORMAT     ║');
  console.log('╚════════════════════════════════════════╝\n');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made to database\n');
  }

  console.log(`📍 Location ID: ${LOCATION_ID}\n`);

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
  console.log(`📥 Loading contacts for location: ${LOCATION_ID}...`);
  const allContacts = await db
    .select()
    .from(contact)
    .where(eq(contact.locationId, LOCATION_ID))
    .execute();
  
  // Create lookup maps
  const contactsByEmail = new Map<string, typeof allContacts[0]>();
  const contactsByDisplayName = new Map<string, typeof allContacts[0]>();

  allContacts.forEach(c => {
    if (c.email) {
      contactsByEmail.set(c.email.toLowerCase(), c);
    }
    if (c.displayName) {
      contactsByDisplayName.set(c.displayName.toLowerCase(), c);
    }
  });

  console.log(`✓ Loaded ${allContacts.length} total contacts\n`);

  // Pre-load payment methods for this location
  console.log(`📥 Loading payment methods for location: ${LOCATION_ID}...`);
  const allPaymentMethods = await db
    .select()
    .from(paymentMethods)
    .where(eq(paymentMethods.locationId, LOCATION_ID))
    .execute();

  const paymentMethodsByName = new Map<string, typeof allPaymentMethods[0]>();
  allPaymentMethods.forEach(pm => {
    paymentMethodsByName.set(pm.name.toLowerCase().trim(), pm);
  });

  console.log(`✓ Loaded ${allPaymentMethods.length} payment methods\n`);

  // Pre-load all manual donations for this location
  console.log(`📥 Loading manual donations for location: ${LOCATION_ID}...`);
  const allManualDonations = await db
    .select()
    .from(manualDonation)
    .innerJoin(contact, eq(manualDonation.contactId, contact.id))
    .where(eq(contact.locationId, LOCATION_ID))
    .execute()
    .then(results => results.map(r => ({
      donation: r.manual_donation,
      contact: r.contact,
    })));
  
  console.log(`✓ Loaded ${allManualDonations.length} manual donations\n`);

  // Process each row
  console.log('🔍 Analyzing donations...\n');
  const results: ProcessedResult[] = [];
  const missingPaymentMethod = !paymentMethodsByName.has(DEFAULT_PAYMENT_METHOD.toLowerCase());
  const missingContactsToCreate = new Map<string, {
    firstName: string;
    lastName: string;
    displayName: string;
    email?: string;
    locationId: string;
  }>();

  let processed = 0;
  for (const row of donationRows) {
    processed++;
    if (processed % 10 === 0) {
      process.stdout.write(`\r  Progress: ${processed}/${donationRows.length}`);
    }

    const displayName = cleanString(row['Name']) || 'Unknown';
    const email = cleanEmail(row['Email']);
    const amount = normalizeAmount(row['Deposit']);
    const donationDate = normalizeDateTime(row['Date']);
    
    const { firstName, lastName } = parseNameToFirstLast(displayName);

    // Try to find contact
    let foundContact = null;
    let matchedBy: 'email' | 'name' | 'notFound' = 'notFound';

    if (email && contactsByEmail.has(email)) {
      foundContact = contactsByEmail.get(email)!;
      matchedBy = 'email';
    } else if (contactsByDisplayName.has(displayName.toLowerCase())) {
      foundContact = contactsByDisplayName.get(displayName.toLowerCase())!;
      matchedBy = 'name';
    }

    if (!foundContact) {
      // Prepare to create new contact
      const contactKey = email || displayName;
      if (!missingContactsToCreate.has(contactKey)) {
        missingContactsToCreate.set(contactKey, {
          firstName: firstName || 'Unknown',
          lastName: lastName || '',
          displayName: displayName,
          email: email,
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

    // Check if manual donation exists
    const existingDonation = allManualDonations.find(({ donation: md }) => {
      const contactMatch = md.contactId === foundContact!.id;
      const amountMatch = md.amount === amount;
      
      const donationDateObj = new Date(md.paymentDate);
      const transDateObj = new Date(donationDate);
      const daysDiff = Math.abs((donationDateObj.getTime() - transDateObj.getTime()) / (1000 * 60 * 60 * 24));
      const dateMatch = daysDiff <= 1;

      return contactMatch && amountMatch && dateMatch;
    });

    const foundPaymentMethod = paymentMethodsByName.get(DEFAULT_PAYMENT_METHOD.toLowerCase());

    if (existingDonation) {
      results.push({
        row,
        contactId: foundContact.id,
        paymentMethodId: foundPaymentMethod?.id,
        matchedBy,
        paymentMethodMatched: !!foundPaymentMethod,
        status: 'exists',
        existingDonationId: existingDonation.donation.id,
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

  if (missingPaymentMethod) {
    console.log(`\n⚠️  Payment method to create: ${DEFAULT_PAYMENT_METHOD}`);
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
        if (c.email) {
          contactsByEmail.set(c.email.toLowerCase(), c);
        }
        if (c.displayName) {
          contactsByDisplayName.set(c.displayName.toLowerCase(), c);
        }
      });
      
      console.log(`  ✓ Created ${createdContacts.length} contacts\n`);

      // Update results with new contact IDs
      for (const result of results) {
        if (result.status === 'contact_not_found') {
          const email = cleanEmail(result.row['Email']);
          const displayName = cleanString(result.row['Name']) || 'Unknown';
          const newContact = createdContacts.find(c => 
            (email && c.email?.toLowerCase() === email) ||
            (c.displayName?.toLowerCase() === displayName.toLowerCase())
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

    // Create missing payment method
    if (missingPaymentMethod) {
      console.log(`💳 Creating payment method: ${DEFAULT_PAYMENT_METHOD}...`);
      
      const createdPaymentMethods = await db.insert(paymentMethods).values([{
        name: DEFAULT_PAYMENT_METHOD,
        description: 'Auto-created from import',
        locationId: LOCATION_ID,
        isActive: true,
      }]).returning();
      
      // Update cache
      createdPaymentMethods.forEach(pm => {
        paymentMethodsByName.set(pm.name.toLowerCase().trim(), pm);
      });
      
      console.log(`  ✓ Created payment method\n`);
    }

    // Prepare donations to insert
    const donationsToCreate: any[] = [];
    const importLog: any[] = [];

    const finalMissingDonations = results.filter(r => r.status === 'missing');

    for (const result of finalMissingDonations) {
      const row = result.row;
      const amount = normalizeAmount(row['Deposit']);
      const paymentDate = normalizeDateTime(row['Date']);
      const displayName = cleanString(row['Name']) || 'Unknown';

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
        campaignId: null,
        categoryId: null,
        categoryItemId: null,
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
        notes: `Imported from CSV - ${displayName} - ${row['Date']}`,
        _rowData: row,
      });

      importLog.push({
        'Name': row['Name'],
        'Email': row['Email'],
        'Amount': amount,
        'Payment Date': paymentDate,
        'Payment Method': DEFAULT_PAYMENT_METHOD,
        'Location ID': LOCATION_ID,
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

    const importPath = path.join(OUTPUT_DIR, `imported-donations-${timestamp}.csv`);
    writeCsv(importPath, importLog);
    console.log(`\n📤 Import log saved to: ${importPath}`);
  }

  // Write analysis CSVs
  if (missingDonations.length > 0 || missingContactsToCreate.size > 0) {
    const missingPath = path.join(OUTPUT_DIR, `missing-donations-${timestamp}.csv`);
    const allMissingData = [
      ...missingDonations.map(md => ({
        'Name': md.row['Name'],
        'Email': md.row['Email'],
        'Amount': md.row['Deposit'],
        'Date': md.row['Date'],
        'Normalized Date': normalizeDateTime(md.row['Date']),
        'Normalized Amount': normalizeAmount(md.row['Deposit']),
        'Contact ID': md.contactId,
        'Payment Method Matched': md.paymentMethodMatched ? 'Yes' : 'No',
        'Matched By': md.matchedBy,
        'Contact Status': 'Existing',
      })),
      ...Array.from(missingContactsToCreate.entries()).map(([key, contactData]) => {
        const relatedRow = results.find(r => 
          cleanEmail(r.row['Email']) === cleanEmail(contactData.email) ||
          cleanString(r.row['Name']) === contactData.displayName
        )?.row;
        return relatedRow ? {
          'Name': relatedRow['Name'],
          'Email': relatedRow['Email'],
          'Amount': relatedRow['Deposit'],
          'Date': relatedRow['Date'],
          'Normalized Date': normalizeDateTime(relatedRow['Date']),
          'Normalized Amount': normalizeAmount(relatedRow['Deposit']),
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
    const notFoundPath = path.join(OUTPUT_DIR, `contact-not-found-${timestamp}.csv`);
    const notFoundData = contactNotFound.map(nf => ({
      'Name': nf.row['Name'],
      'Email': nf.row['Email'],
      'Amount': nf.row['Deposit'],
      'Date': nf.row['Date'],
      'Reason': nf.reason,
    }));
    writeCsv(notFoundPath, notFoundData);
    console.log(`📤 Contacts not found: ${notFoundPath}`);
  }

  if (existingDonations.length > 0) {
    const existsPath = path.join(OUTPUT_DIR, `already-exists-${timestamp}.csv`);
    const existsData = existingDonations.map(fd => ({
      'Name': fd.row['Name'],
      'Email': fd.row['Email'],
      'Amount': fd.row['Deposit'],
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