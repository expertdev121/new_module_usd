// scripts/import-contacts.ts
import 'dotenv/config';
import Papa from 'papaparse';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '@/lib/db';
import { contact } from '@/lib/db/schema';
import { eq, and, or } from 'drizzle-orm';

// Configuration
const CSV_PATH = './data/razor-contacts.csv';
const OUTPUT_DIR = './data/exports';
const BATCH_SIZE = 100;
const DRY_RUN = false;

interface ContactCSVRow {
  location_id: string;
  Constituents_id: string;
  address: string;
  'address/type': string;
  name: string;
  first: string;
  last: string;
  'email/address': string;
  'phone/number': string;
}

interface ProcessedResult {
  row: ContactCSVRow;
  contactId?: number;
  matchedBy?: 'constituents_id' | 'email' | 'name' | 'notFound';
  status: 'exists' | 'missing' | 'invalid';
  existingContactId?: number;
  reason?: string;
}

// Utility functions
function parseCSV(filePath: string): ContactCSVRow[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = Papa.parse(raw, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (header: string) => header.trim(),
  });

  if (parsed.errors.length > 0) {
    console.error('CSV Parse Error:', parsed.errors[0]);
    throw new Error(parsed.errors[0].message);
  }

  return parsed.data as ContactCSVRow[];
}

function parseNameParts(displayName: string, firstName?: string, lastName?: string): { 
  first: string; 
  last: string; 
  display: string; 
} {
  // If we have both first and last, use them
  if (firstName?.trim() && lastName?.trim()) {
    return {
      first: firstName.trim(),
      last: lastName.trim(),
      display: displayName?.trim() || `${firstName.trim()} ${lastName.trim()}`.trim(),
    };
  }

  // If we only have displayName, split it
  if (displayName?.trim()) {
    const nameParts = displayName.trim().split(/\s+/);
    
    if (nameParts.length === 1) {
      // Single word name - use it for both first and last
      return {
        first: nameParts[0],
        last: nameParts[0],
        display: displayName.trim(),
      };
    } else if (nameParts.length >= 2) {
      // Multiple words - first word as first name, rest as last name
      return {
        first: nameParts[0],
        last: nameParts.slice(1).join(' '),
        display: displayName.trim(),
      };
    }
  }

  // Fallback - use whatever we have
  return {
    first: firstName?.trim() || 'Unknown',
    last: lastName?.trim() || '',
    display: displayName?.trim() || `${firstName?.trim() || 'Unknown'} ${lastName?.trim() || ''}`.trim(),
  };
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

function normalizeAddress(address?: string): string | undefined {
  if (!address) return undefined;
  // Remove multiple spaces and newlines
  const normalized = address
    .replace(/\s+/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
  return normalized || undefined;
}

function writeCsv(filePath: string, rows: any[]) {
  const csv = Papa.unparse(rows);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf8');
}

// Main logic
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       IMPORT CONTACTS FROM CSV         ║');
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
  console.log(`📂 Reading CSV: ${path.resolve(CSV_PATH)}`);
  const contactRows = parseCSV(CSV_PATH);
  console.log(`✓ Loaded ${contactRows.length} rows\n`);

  // Get unique location IDs from CSV
  const locationIds = [...new Set(contactRows.map(r => r.location_id).filter(Boolean))];
  console.log(`📍 Found ${locationIds.length} unique location(s): ${locationIds.join(', ')}\n`);

  // Always clean existing contacts before import (unless DRY_RUN)
  if (!DRY_RUN && locationIds.length > 0) {
    console.log('🗑️  Cleaning existing contacts for these locations...\n');
    
    for (const locationId of locationIds) {
      try {
        const deletedContacts = await db
          .delete(contact)
          .where(eq(contact.locationId, locationId))
          .returning();
        
        console.log(`  ✓ Deleted ${deletedContacts.length} contacts from location: ${locationId}`);
      } catch (err: any) {
        console.error(`  ❌ Failed to delete contacts for location ${locationId}:`, err.message);
        throw err;
      }
    }
    
    console.log('\n✓ Cleanup complete\n');
  } else if (DRY_RUN) {
    console.log('⚠️  DRY_RUN mode - Existing contacts will NOT be deleted\n');
  }

  // Pre-load all contacts for these locations (will be empty after cleanup)
  console.log(`📥 Loading existing contacts...`);
  const allContacts = await db
    .select()
    .from(contact)
    .where(
      locationIds.length > 0 
        ? or(...locationIds.map(lid => eq(contact.locationId, lid)))!
        : undefined
    )
    .execute();
  
  const contactsByConstituentsId = new Map(
    allContacts
      .filter(c => c.constituentsId)
      .map(c => [`${c.locationId}:${c.constituentsId}`, c])
  );
  
  const contactsByEmail = new Map(
    allContacts
      .filter(c => c.email)
      .map(c => [`${c.locationId}:${c.email!.toLowerCase()}`, c])
  );
  
  const contactsByName = new Map(
    allContacts.map(c => [
      `${c.locationId}:${c.firstName?.toLowerCase()}:${c.lastName?.toLowerCase()}`,
      c
    ])
  );

  console.log(`✓ Loaded ${allContacts.length} existing contacts`);
  console.log(`  - By Constituents ID: ${contactsByConstituentsId.size}`);
  console.log(`  - By Email: ${contactsByEmail.size}`);
  console.log(`  - By Name: ${contactsByName.size}\n`);

  // Process each row to identify duplicates and new contacts
  console.log('🔍 Analyzing contacts...\n');
  const results: ProcessedResult[] = [];
  const contactsToCreate = new Map<string, {
    locationId: string;
    constituentsId: string | null;
    firstName: string;
    lastName: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    title: string | null;
  }>();

  let processed = 0;
  for (const row of contactRows) {
    processed++;
    if (processed % 50 === 0) {
      process.stdout.write(`\r  Progress: ${processed}/${contactRows.length}`);
    }

    const locationId = row.location_id?.trim();
    const constituentsId = row.Constituents_id?.trim();
    
    // Parse name parts - handles cases where only displayName exists
    const nameParts = parseNameParts(row.name, row.first, row.last);
    const firstName = nameParts.first;
    const lastName = nameParts.last;
    const displayName = nameParts.display;
    
    const email = cleanEmail(row['email/address']);
    const phone = cleanPhone(row['phone/number']);
    const address = normalizeAddress(row.address);
    const addressType = row['address/type']?.trim();

    // Validate required fields - now we only need location_id and some form of name
    if (!locationId || !displayName) {
      results.push({
        row,
        status: 'invalid',
        reason: 'Missing required fields (location_id or name)',
      });
      continue;
    }

    // Try to find existing contact
    let foundContact = null;
    let matchedBy: 'constituents_id' | 'email' | 'name' | 'notFound' = 'notFound';

    // 1. Try matching by constituents_id (most reliable)
    if (constituentsId) {
      const key = `${locationId}:${constituentsId}`;
      if (contactsByConstituentsId.has(key)) {
        foundContact = contactsByConstituentsId.get(key)!;
        matchedBy = 'constituents_id';
      }
    }

    // 2. Try matching by email
    if (!foundContact && email) {
      const key = `${locationId}:${email}`;
      if (contactsByEmail.has(key)) {
        foundContact = contactsByEmail.get(key)!;
        matchedBy = 'email';
      }
    }

    // 3. Try matching by name (least reliable)
    if (!foundContact && firstName && lastName) {
      const key = `${locationId}:${firstName.toLowerCase()}:${lastName.toLowerCase()}`;
      if (contactsByName.has(key)) {
        foundContact = contactsByName.get(key)!;
        matchedBy = 'name';
      }
    }

    if (foundContact) {
      // Contact already exists
      results.push({
        row,
        contactId: foundContact.id,
        matchedBy,
        status: 'exists',
        existingContactId: foundContact.id,
      });
    } else {
      // Contact needs to be created
      // Use constituents_id as primary key, otherwise use name combination
      // This ensures we can import contacts without email/phone
      const uniqueKey = constituentsId 
        ? `${locationId}:constituents:${constituentsId}`
        : `${locationId}:name:${firstName.toLowerCase()}:${lastName.toLowerCase()}`;

      if (!contactsToCreate.has(uniqueKey)) {
        contactsToCreate.set(uniqueKey, {
          locationId,
          constituentsId: constituentsId || null,
          firstName,
          lastName,
          displayName,
          email: email || null,
          phone: phone || null,
          address: address || null,
          title: addressType || null,
        });
      }

      results.push({
        row,
        matchedBy: 'notFound',
        status: 'missing',
        reason: 'New contact to be created',
      });
    }
  }

  console.log('\n');

  // Categorize results
  const existingContacts = results.filter(r => r.status === 'exists');
  const missingContacts = results.filter(r => r.status === 'missing');
  const invalidContacts = results.filter(r => r.status === 'invalid');

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║           ANALYSIS SUMMARY             ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`📊 Total rows processed:     ${contactRows.length}`);
  console.log(`✅ Already exists:           ${existingContacts.length}`);
  console.log(`➕ New contacts to create:   ${missingContacts.length}`);
  console.log(`❌ Invalid rows:             ${invalidContacts.length}`);

  // Breakdown by match type for existing contacts
  if (existingContacts.length > 0) {
    const matchedByConstituentsId = existingContacts.filter(r => r.matchedBy === 'constituents_id').length;
    const matchedByEmail = existingContacts.filter(r => r.matchedBy === 'email').length;
    const matchedByName = existingContacts.filter(r => r.matchedBy === 'name').length;
    
    console.log(`\n📋 Existing contacts breakdown:`);
    console.log(`  - Matched by Constituents ID: ${matchedByConstituentsId}`);
    console.log(`  - Matched by Email:           ${matchedByEmail}`);
    console.log(`  - Matched by Name:            ${matchedByName}`);
  }

  // Generate timestamp for file names
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // === START IMPORT PROCESS ===
  const shouldImport = missingContacts.length > 0;
  
  if (!DRY_RUN && shouldImport) {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║         STARTING IMPORT PROCESS        ║');
    console.log('╚════════════════════════════════════════╝\n');

    // Prepare contacts to insert
    const contactValues = Array.from(contactsToCreate.values());
    console.log(`👤 Creating ${contactValues.length} contacts in batches...\n`);

    const importLog: any[] = [];
    let totalCreated = 0;

    // Insert contacts in batches
    for (let i = 0; i < contactValues.length; i += BATCH_SIZE) {
      const batch = contactValues.slice(i, i + BATCH_SIZE);
      
      try {
        const created = await db.insert(contact).values(batch).returning();
        totalCreated += created.length;
        
        // Log created contacts
        created.forEach((c, idx) => {
          const contactData = batch[idx];
          importLog.push({
            'Contact ID': c.id,
            'Constituents ID': c.constituentsId,
            'Location ID': c.locationId,
            'First Name': c.firstName,
            'Last Name': c.lastName,
            'Display Name': c.displayName,
            'Email': c.email,
            'Phone': c.phone,
            'Address': c.address,
            'Status': 'imported',
            'Created At': c.createdAt,
          });
        });
        
        console.log(`  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${created.length} contacts`);
      } catch (err: any) {
        console.error(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, err.message);
        
        // Log failed contacts
        batch.forEach(contactData => {
          importLog.push({
            'Contact ID': '',
            'Constituents ID': contactData.constituentsId,
            'Location ID': contactData.locationId,
            'First Name': contactData.firstName,
            'Last Name': contactData.lastName,
            'Display Name': contactData.displayName,
            'Email': contactData.email,
            'Phone': contactData.phone,
            'Address': contactData.address,
            'Status': 'failed',
            'Error': err.message,
          });
        });
      }
    }
    
    console.log(`\n✓ Total created: ${totalCreated} contacts`);

    // Save import log
    if (importLog.length > 0) {
      const importPath = path.join(OUTPUT_DIR, `imported-contacts-${timestamp}.csv`);
      writeCsv(importPath, importLog);
      console.log(`\n📤 Import log saved to: ${importPath}`);
    }
  }

  // Write analysis CSVs
  if (missingContacts.length > 0) {
    const missingPath = path.join(OUTPUT_DIR, `missing-contacts-${timestamp}.csv`);
    const missingData = missingContacts.map(mc => ({
      'Constituents ID': mc.row.Constituents_id,
      'Location ID': mc.row.location_id,
      'First Name': mc.row.first,
      'Last Name': mc.row.last,
      'Display Name': mc.row.name,
      'Email': mc.row['email/address'],
      'Phone': mc.row['phone/number'],
      'Address': mc.row.address,
      'Address Type': mc.row['address/type'],
      'Status': 'Will be created',
    }));
    writeCsv(missingPath, missingData);
    console.log(`\n📤 Missing contacts analysis: ${missingPath}`);
  }

  if (existingContacts.length > 0) {
    const existsPath = path.join(OUTPUT_DIR, `already-exists-contacts-${timestamp}.csv`);
    const existsData = existingContacts.map(ec => ({
      'Contact ID': ec.contactId,
      'Constituents ID': ec.row.Constituents_id,
      'Location ID': ec.row.location_id,
      'First Name': ec.row.first,
      'Last Name': ec.row.last,
      'Display Name': ec.row.name,
      'Email': ec.row['email/address'],
      'Phone': ec.row['phone/number'],
      'Matched By': ec.matchedBy,
      'Status': 'Already exists',
    }));
    writeCsv(existsPath, existsData);
    console.log(`📤 Already exists: ${existsPath}`);
  }

  if (invalidContacts.length > 0) {
    const invalidPath = path.join(OUTPUT_DIR, `invalid-contacts-${timestamp}.csv`);
    const invalidData = invalidContacts.map(ic => ({
      'Constituents ID': ic.row.Constituents_id,
      'Location ID': ic.row.location_id,
      'First Name': ic.row.first,
      'Last Name': ic.row.last,
      'Display Name': ic.row.name,
      'Email': ic.row['email/address'],
      'Phone': ic.row['phone/number'],
      'Reason': ic.reason,
    }));
    writeCsv(invalidPath, invalidData);
    console.log(`📤 Invalid contacts: ${invalidPath}`);
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