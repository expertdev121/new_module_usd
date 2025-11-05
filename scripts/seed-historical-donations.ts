// Set the environment variable directly
process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-tiny-fog-a9fqoj3f-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require'
import { db } from "@/lib/db";
import {
  user,
  contact,
  category,
  campaign,
  pledge,
  payment,
  manualDonation,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as fs from 'fs';
import bcrypt from "bcryptjs";

/**
 * Parse CSV file and convert to JSON array
 */
function parseCSV(filePath: string): any[] {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');
    
    if (lines.length === 0) {
      throw new Error('CSV file is empty');
    }
    
    // Get headers from first line
    const headers = lines[0].split(',').map(h => h.trim());
    
    const data: any[] = [];
    
    // Parse each line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      const values = line.split(',').map(v => v.trim());
      const row: any = {};

      headers.forEach((header, index) => {
        let value = values[index] || '';
        // Remove all surrounding quotes if present (handles multiple quote levels)
        while (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        row[header] = value;
      });

      data.push(row);
    }
    
    return data;
  } catch (error) {
    console.error('Error parsing CSV:', error);
    throw error;
  }
}

/**
 * Parse date string to ISO format (YYYY-MM-DD)
 */
function parseDate(dateStr: string): string {
  console.log(`DEBUG: Parsing date string: "${dateStr}"`);
  try {
    // If date string doesn't contain a year, assume it's 2025
    let dateToParse = dateStr;
    if (!/\b\d{4}\b/.test(dateStr)) {
      dateToParse = `${dateStr} 2025`;
      console.log(`DEBUG: Added year 2025: "${dateToParse}"`);
    }

    const date = new Date(dateToParse);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${dateStr}`);
    }
    const isoDate = date.toISOString().split('T')[0];
    console.log(`DEBUG: Parsed date "${dateStr}" to "${isoDate}"`);
    return isoDate;
  } catch (error) {
    console.error(`Date parse error for "${dateStr}":`, error);
    // Fallback to current date
    const fallbackDate = new Date().toISOString().split('T')[0];
    console.log(`DEBUG: Using fallback date: "${fallbackDate}"`);
    return fallbackDate;
  }
}

/**
 * Extract first and last name from full name
 */
function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const nameParts = fullName.trim().split(' ');
  
  if (nameParts.length === 1) {
    return { firstName: nameParts[0], lastName: '' };
  }
  
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ');
  
  return { firstName, lastName };
}

/**
 * Find or get "Pledge" category
 */
async function getPledgeCategory(): Promise<number> {
  // Try to find existing "Pledge" category
  let pledgeCategory = await db
    .select()
    .from(category)
    .where(eq(category.name, 'Pledge'))
    .limit(1);

  if (pledgeCategory.length > 0) {
    return pledgeCategory[0].id;
  }

  // Create "Pledge" category if it doesn't exist
  const [newCategory] = await db.insert(category).values({
    name: 'Pledge',
    description: 'Default pledge category for imported donations',
    isActive: true,
  }).returning();

  console.log('→ Created "Pledge" category');
  return newCategory.id;
}

/**
 * Find or create campaign
 */
async function findOrCreateCampaign(campaignName: string, locationId: string): Promise<number | null> {
  if (!campaignName || campaignName.trim() === '') {
    return null;
  }

  // Try to find existing campaign by name and location
  let existingCampaign = await db
    .select()
    .from(campaign)
    .where(eq(campaign.name, campaignName.trim()))
    .limit(1);

  if (existingCampaign.length > 0) {
    return existingCampaign[0].id;
  }

  // Create new campaign if it doesn't exist
  const [newCampaign] = await db.insert(campaign).values({
    name: campaignName.trim(),
    description: `Campaign imported from CSV: ${campaignName}`,
    locationId: locationId,
    status: "active",
  }).returning();

  console.log(`→ Created campaign: ${campaignName} (ID: ${newCampaign.id})`);
  return newCampaign.id;
}

/**
 * Find or create contact and user
 */
async function findOrCreateContact(data: {
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  locationId: string;
}): Promise<number> {
  
  // First try to find by ghl_contact_id
  let foundContact = await db
    .select()
    .from(contact)
    .where(eq(contact.ghlContactId, data.customerId))
    .limit(1);

  if (foundContact.length > 0) {
    return foundContact[0].id;
  }

  // Contact not found, create new contact and user
  console.log(`  → Creating new contact: ${data.customerName}`);
  
  const { firstName, lastName } = parseFullName(data.customerName);
  
  // 1. Create User first
  let userId: number | undefined;
  
  if (data.customerEmail) {
    try {
      // Check if user with this email already exists
      const existingUser = await db
        .select()
        .from(user)
        .where(eq(user.email, data.customerEmail))
        .limit(1);

      if (existingUser.length > 0) {
        userId = existingUser[0].id;
        console.log(`  → User already exists: ${data.customerEmail}`);
      } else {
        // Hash password (email as password)
        const hashedPassword = await bcrypt.hash(data.customerEmail, 10);
        
        const [newUser] = await db.insert(user).values({
          email: data.customerEmail,
          passwordHash: hashedPassword,
          locationId: data.locationId,
          role: "user",
          status: "active",
          isActive: true,
        }).returning();
        
        userId = newUser.id;
        console.log(`  → Created user: ${data.customerEmail} (password: ${data.customerEmail})`);
      }
    } catch (error) {
      console.error(`  → Error creating user:`, error);
      // Continue without user if there's an error
    }
  }

  // 2. Create Contact
  const [newContact] = await db.insert(contact).values({
    ghlContactId: data.customerId,
    locationId: data.locationId,
    firstName: firstName,
    lastName: lastName,
    displayName: data.customerName,
    email: data.customerEmail || undefined,
    phone: data.customerPhone || undefined,
  }).returning();

  console.log(`  → Created contact: ${data.customerName} (ID: ${newContact.id})`);
  
  return newContact.id;
}

/**
 * Main seed function
 */
async function seed() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   DONATION DATA SEEDER - STARTING     ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Check database connection
  try {
    const testQuery = await db.select().from(user).limit(1);
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }

  try {
    // Path to your CSV file - UPDATE THIS PATH
    const csvFilePath = './data/Texas-Torah-Institute-transactions.csv';
    
    console.log(`📂 Reading CSV file: ${csvFilePath}`);
    
    // Check if file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at: ${csvFilePath}`);
    }
    
    // Get or create "Pledge" category
    console.log('🏷️  Getting "Pledge" category...');
    const pledgeCategoryId = await getPledgeCategory();
    
    // Parse CSV file
    const rows = parseCSV(csvFilePath);
    console.log(`✓ Found ${rows.length} rows to process\n`);
    
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let createdContactsCount = 0;
    let createdUsersCount = 0;
    let createdCampaignsCount = 0;
    let pledgeCount = 0;
    let manualDonationCount = 0;
    const errors: string[] = [];
    
    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because of header and 0-index
      
      try {
        // Extract data from CSV columns
        const locationId = row['Location id'];
        const customerId = row['Customer id'];
        const customerName = row['Customer name'];
        const customerEmail = row['Customer email'];
        const customerPhone = row['Customer phone'];
        const currency = row['Currency'];
        const totalAmountStr = row['Total Amount'];
        const status = row['Status'];
        const sourceName = row['Source name'];
        const paymentProvider = row['Payment provider'];
        const transactionDate = row['Transaction date'];
        const paymentMethod = row['Payment Method'];
        const campaignName = row['Campaign'];

        // Validate required fields
        if (!customerId) {
          console.log(`⊘ Row ${rowNum}: Skipped - No customer ID`);
          skippedCount++;
          continue;
        }

        if (!totalAmountStr || isNaN(parseFloat(totalAmountStr))) {
          console.log(`⊘ Row ${rowNum}: Skipped - Invalid amount`);
          skippedCount++;
          continue;
        }

        const totalAmount = parseFloat(totalAmountStr);

        // Find or create contact (and user if needed)
        const contactsBefore = await db.select().from(contact);
        const usersBefore = await db.select().from(user);
        const campaignsBefore = await db.select().from(campaign);

        const contactId = await findOrCreateContact({
          customerId,
          customerName,
          customerEmail,
          customerPhone,
          locationId,
        });

        const contactsAfter = await db.select().from(contact);
        const usersAfter = await db.select().from(user);

        if (contactsAfter.length > contactsBefore.length) createdContactsCount++;
        if (usersAfter.length > usersBefore.length) createdUsersCount++;

        // Find or create campaign if campaignName is provided
        let campaignId: number | null = null;
        if (campaignName) {
          campaignId = await findOrCreateCampaign(campaignName, locationId);
        }

        const campaignsAfter = await db.select().from(campaign);
        if (campaignsAfter.length > campaignsBefore.length) createdCampaignsCount++;

        const paymentDate = parseDate(transactionDate);

        // ============================================
        // MANUAL DONATION (payment provider = "manual")
        // ============================================
        if (paymentProvider === "manual") {

          const [insertedDonation] = await db.insert(manualDonation).values({
            contactId: contactId,
            campaignId: campaignId,
            amount: totalAmount.toFixed(2),
            currency: currency as any,
            amountUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            paymentDate: paymentDate,
            receivedDate: paymentDate,
            paymentMethod: paymentMethod || 'Cash',
            paymentStatus: status === "succeeded" ? "completed" : "failed",
            receiptIssued: false,
            notes: `Imported from CSV - ${sourceName || 'Manual Payment'}`,
          }).returning({ id: manualDonation.id });

          console.log(`✓ Row ${rowNum}: Manual donation created for ${customerName} - ${currency} ${totalAmount} (ID: ${insertedDonation.id})`);
          manualDonationCount++;
          successCount++;
          
        } 
        // ============================================
        // ALL OTHER PROVIDERS: Create Pledge + Payment
        // Category = "Pledge"
        // ============================================
        else {
          
          // 1. Create Pledge with category = "Pledge"
          const [createdPledge] = await db.insert(pledge).values({
            contactId: contactId,
            categoryId: pledgeCategoryId, // Set to "Pledge" category
            campaignCode: campaignName || undefined, // Associate with campaign if available
            pledgeDate: paymentDate,
            description: sourceName || `Donation via ${paymentProvider}`,
            originalAmount: totalAmount.toFixed(2),
            currency: currency as any,
            totalPaid: totalAmount.toFixed(2),
            balance: "0.00",
            originalAmountUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            totalPaidUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            balanceUsd: "0.00",
            isActive: true,
            notes: `Imported from CSV - ${paymentProvider}`,
          }).returning();

          // 2. Create Payment with ALL fields properly set
          await db.insert(payment).values({
            // Core payment links
            pledgeId: createdPledge.id,
            paymentPlanId: null, // No plan
            installmentScheduleId: null, // No schedule
            relationshipId: null, // Not applicable for imported data
            
            // Third-party payment fields (not applicable here)
            payerContactId: null,
            isThirdPartyPayment: false,
            
            // Core payment amount and currency
            amount: totalAmount.toFixed(2),
            currency: currency as any,
            amountUsd: currency === "USD" ? totalAmount.toFixed(2) : undefined,
            exchangeRate: currency === "USD" ? "1.00" : undefined,
            
            // Pledge currency conversion (same as amount if directly paid to pledge)
            amountInPledgeCurrency: totalAmount.toFixed(2),
            pledgeCurrencyExchangeRate: "1.00",
            
            // Plan currency conversion (not applicable without plan)
            amountInPlanCurrency: null,
            planCurrencyExchangeRate: null,
            
            // Payment dates
            paymentDate: paymentDate,
            receivedDate: paymentDate,
            checkDate: null,
            
            // Payment method details
            account: null,
            paymentMethod: paymentMethod || 'Credit Card',
            methodDetail: null,
            paymentStatus: status === "succeeded" ? "completed" : "failed",
            
            // Reference numbers
            referenceNumber: null,
            checkNumber: null,
            receiptNumber: null,
            receiptType: null,
            receiptIssued: false,
            
            // Solicitor and bonus (not applicable for imported donations)
            solicitorId: null,
            bonusPercentage: null,
            bonusAmount: null,
            bonusRuleId: null,
            
            // Notes
            notes: `Imported from CSV - ${paymentProvider}`,
          });

          console.log(`✓ Row ${rowNum}: Pledge & Payment created for ${customerName} (${paymentProvider}) - ${currency} ${totalAmount}`);
          pledgeCount++;
          successCount++;
        }
        
      } catch (error) {
        const errorMsg = `Row ${rowNum}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
        errorCount++;
      }
    }

    // Print summary
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║           SEED SUMMARY                 ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`📊 Total rows in CSV:       ${rows.length}`);
    console.log(`👤 New contacts created:    ${createdContactsCount}`);
    console.log(`🔐 New users created:       ${createdUsersCount}`);
    console.log(`\n📋 Data Import Summary:`);
    console.log(`   💰 Pledges + Payments:   ${pledgeCount}`);
    console.log(`   📝 Manual Donations:     ${manualDonationCount}`);
    console.log(`\n✓  Successfully processed:   ${successCount}`);
    console.log(`❌ Errors:                   ${errorCount}`);
    console.log(`⊘  Skipped:                  ${skippedCount}`);
    console.log('════════════════════════════════════════\n');

    // Show detailed errors if any
    if (errors.length > 0) {
      console.log('📋 Detailed Errors:');
      errors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err}`);
      });
      console.log('');
    }

    if (createdUsersCount > 0) {
      console.log('🔑 NOTE: All new users have their EMAIL as their PASSWORD');
      console.log('   They should change it on first login.\n');
    }

    console.log('✅ Seeding completed!\n');

  } catch (error) {
    console.error('\n💥 FATAL ERROR:');
    console.error(error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the seeder
seed();
