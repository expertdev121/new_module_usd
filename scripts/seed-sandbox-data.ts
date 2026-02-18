/**
 * Seed Sandbox Data Script
 * 
 * This script creates dummy data for a specific location ID to use as a sandbox account.
 * It creates:
 * - Categories with category items
 * - Payment methods
 * - Campaigns
 * - 30+ contacts with manual donations
 * 
 * Location ID: Jd28il5U0OdfAA0C3z7c
 */

import {
  category,
  categoryItem,
  paymentMethods,
  campaign,
  contact,
  manualDonation,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";

// Location ID for the sandbox account
const LOCATION_ID = "Jd28il5U0OdfAA0C3z7c";

// Sample data for contacts
const firstNames = [
  "John", "Sarah", "Michael", "Emily", "David",
  "Rachel", "James", "Hannah", "Robert", "Leah",
  "William", "Esther", "Daniel", "Rebecca", "Joseph",
  "Sarah", "Matthew", "Chaya", "Andrew", "Tamar",
  "Christopher", "Miriam", "Joshua", "Devorah", "Kevin",
  "Ruth", "Brian", "Yocheved", "Steven", "Judith"
];

const lastNames = [
  "Smith", "Johnson", "Williams", "Brown", "Jones",
  "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris",
  "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson"
];

const donationAmounts = [
  50, 100, 150, 200, 250, 300, 350, 400, 500, 750,
  1000, 1500, 2000, 2500, 3000, 5000, 7500, 10000
];

const paymentMethodsList = [
  "check", "cash", "credit_card", "bank_transfer", "ach",
  "money_order", "p2p", "wire"
];

const checkNumbers = [
  "1001", "1002", "1003", "1004", "1005", "1006", "1007", "1008", "1009", "1010",
  "2001", "2002", "2003", "2004", "2005", "3001", "3002", "3003", "4001", "4002"
];

const referenceNumbers = [
  "REF-001", "REF-002", "REF-003", "REF-004", "REF-005",
  "REF-006", "REF-007", "REF-008", "REF-009", "REF-010",
  "DON-001", "DON-002", "DON-003", "DON-004", "DON-005"
];

// Generate random date within the last year
function getRandomDate(): string {
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  const end = new Date();
  const randomTime = start.getTime() + Math.random() * (end.getTime() - start.getTime());
  const randomDate = new Date(randomTime);
  return randomDate.toISOString().split('T')[0];
}

// Generate random amount from array
function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate random integer between min and max
function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seed() {
  console.log("Starting sandbox data seeding...");
  console.log(`Location ID: ${LOCATION_ID}`);

  try {
    // Check for existing data and clean up if needed
    console.log("\n0. Checking for existing data...");

    const existingCategories = await db
      .select()
      .from(category)
      .where(eq(category.locationId, LOCATION_ID));

    if (existingCategories.length > 0) {
      console.log(`Found ${existingCategories.length} existing categories for this location.`);
      console.log("Cleaning up existing data...");

      // Get all contact IDs for this location first
      const contactsToDelete = await db
        .select({ id: contact.id })
        .from(contact)
        .where(eq(contact.locationId, LOCATION_ID));

      const contactIds = contactsToDelete.map(c => c.id);

      // Delete in correct order due to foreign key constraints
      if (contactIds.length > 0) {
        // Delete donations for these contacts
        await db.delete(manualDonation).where(
          inArray(manualDonation.contactId, contactIds)
        );
        console.log(`Deleted donations for ${contactIds.length} contacts`);

        // Delete contacts
        await db.delete(contact).where(eq(contact.locationId, LOCATION_ID));
        console.log(`Deleted ${contactIds.length} contacts`);
      }

      await db.delete(campaign).where(eq(campaign.locationId, LOCATION_ID));
      await db.delete(categoryItem).where(eq(categoryItem.locationId, LOCATION_ID));
      await db.delete(category).where(eq(category.locationId, LOCATION_ID));
      await db.delete(paymentMethods).where(eq(paymentMethods.locationId, LOCATION_ID));

      console.log("Cleanup complete.");
    }

    // 1. Create Categories
    console.log("\n1. Creating categories...");

    const categoriesData = [
      { name: "General Fund", description: "General operating fund" },
      { name: "Capital Campaign", description: "Building and infrastructure fund" },
      { name: "Education", description: "Educational programs and services" },
      { name: "Youth Programs", description: "Youth engagement and activities" },
      { name: "Community Services", description: "Community outreach programs" },
      { name: "Emergency Relief", description: "Emergency assistance fund" },
    ];

    const insertedCategories = await db
      .insert(category)
      .values(
        categoriesData.map(cat => ({
          name: cat.name,
          description: cat.description,
          isActive: true,
          locationId: LOCATION_ID,
        }))
      )
      .returning({ id: category.id, name: category.name });

    console.log(`Created ${insertedCategories.length} categories`);

    // 2. Create Category Items
    console.log("\n2. Creating category items...");

    const categoryItemsData = [
      // General Fund items
      { name: "Unrestricted", categoryName: "General Fund" },
      { name: "Operations", categoryName: "General Fund" },
      // Capital Campaign items
      { name: "Building Fund", categoryName: "Capital Campaign" },
      { name: "Equipment", categoryName: "Capital Campaign" },
      // Education items
      { name: "Tuition Assistance", categoryName: "Education" },
      { name: "School Programs", categoryName: "Education" },
      { name: "Adult Education", categoryName: "Education" },
      // Youth Programs items
      { name: "Summer Camp", categoryName: "Youth Programs" },
      { name: "After School", categoryName: "Youth Programs" },
      { name: "Youth Events", categoryName: "Youth Programs" },
      // Community Services items
      { name: "Food Pantry", categoryName: "Community Services" },
      { name: "Homeless Assistance", categoryName: "Community Services" },
      // Emergency Relief items
      { name: "Disaster Relief", categoryName: "Emergency Relief" },
      { name: "Crisis Assistance", categoryName: "Emergency Relief" },
    ];

    const categoryMap = new Map(insertedCategories.map(c => [c.name, c.id]));

    const insertedCategoryItems = await db
      .insert(categoryItem)
      .values(
        categoryItemsData.map(item => ({
          name: item.name,
          categoryId: categoryMap.get(item.categoryName)!,
          isActive: true,
          locationId: LOCATION_ID,
        }))
      )
      .returning({ id: categoryItem.id, name: categoryItem.name, categoryId: categoryItem.categoryId });

    console.log(`Created ${insertedCategoryItems.length} category items`);

    // 3. Create Payment Methods
    console.log("\n3. Creating payment methods...");

    const paymentMethodsData = [
      { name: "Check", description: "check" },
      { name: "Cash", description: "cash" },
      { name: "Credit Card", description: "credit_card" },
      { name: "Bank Transfer", description: "bank_transfer" },
      { name: "ACH", description: "ach" },
      { name: "Money Order", description: "money_order" },
      { name: "P2P Payment", description: "p2p" },
      { name: "Wire Transfer", description: "wire" },
    ];

    const insertedPaymentMethods = await db
      .insert(paymentMethods)
      .values(
        paymentMethodsData.map(pm => ({
          name: pm.name,
          description: pm.description,
          isActive: true,
          locationId: LOCATION_ID,
        }))
      )
      .returning({ id: paymentMethods.id, description: paymentMethods.description });

    const paymentMethodMap = new Map(insertedPaymentMethods.map(pm => [pm.description, pm.id]));

    console.log(`Created ${insertedPaymentMethods.length} payment methods`);

    // 4. Create Campaigns
    console.log("\n4. Creating campaigns...");

    const campaignsData = [
      { name: "Annual Fund 2025", description: "Yearly fundraising campaign" },
      { name: "Building Project", description: "Capital campaign for new building" },
      { name: "Emergency Appeal", description: "Emergency relief efforts" },
      { name: "Back to School", description: "Education support campaign" },
      { name: "Holiday Giving", description: "Holiday season fundraising" },
    ];

    const insertedCampaigns = await db
      .insert(campaign)
      .values(
        campaignsData.map(camp => ({
          name: camp.name,
          description: camp.description,
          status: "active" as const,
          locationId: LOCATION_ID,
        }))
      )
      .returning({ id: campaign.id, name: campaign.name });

    const campaignIds = insertedCampaigns.map(c => c.id);

    console.log(`Created ${insertedCampaigns.length} campaigns`);

    // 5. Create Contacts
    console.log("\n5. Creating contacts...");

    const contactsToInsert = [];

    for (let i = 0; i < 35; i++) {
      const firstName = getRandomItem(firstNames);
      const lastName = getRandomItem(lastNames);

      contactsToInsert.push({
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
        phone: `555-${String(1000 + i).padStart(4, '0')}`,
        title: getRandomItem(["Mr.", "Mrs.", "Ms.", "Dr."]),
        address: `${getRandomInt(100, 9999)} ${getRandomItem(["Main", "Oak", "Maple", "Cedar", "Pine"])} ${getRandomItem(["St", "Ave", "Blvd", "Rd"])}`,
        locationId: LOCATION_ID,
      });
    }

    // Insert contacts one by one to avoid column issues
    const insertedContacts = [];
    for (const contactData of contactsToInsert) {
      const [inserted] = await db
        .insert(contact)
        .values(contactData)
        .returning({
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName
        });
      insertedContacts.push(inserted);
    }

    console.log(`Created ${insertedContacts.length} contacts`);

    // 6. Create Manual Donations for each contact
    console.log("\n6. Creating manual donations...");

    const donationsToInsert = [];

    // Create a map of categoryId to its category items for proper associations
    const categoryItemsByCategoryId = new Map<number, typeof insertedCategoryItems>();
    for (const item of insertedCategoryItems) {
      if (!categoryItemsByCategoryId.has(item.categoryId)) {
        categoryItemsByCategoryId.set(item.categoryId, []);
      }
      categoryItemsByCategoryId.get(item.categoryId)!.push(item);
    }

    // Generate 1-4 donations per contact
    for (const insertedContact of insertedContacts) {
      const numDonations = getRandomInt(1, 4);

      for (let d = 0; d < numDonations; d++) {
        const paymentMethod = getRandomItem(paymentMethodsList);
        const paymentDate = getRandomDate();
        const amount = getRandomItem(donationAmounts);

        // Get random category
        const selectedCategory = getRandomItem(insertedCategories);

        // Get random category item that belongs to this category
        const itemsForCategory = categoryItemsByCategoryId.get(selectedCategory.id) || [];
        const selectedCategoryItem = getRandomItem(itemsForCategory);

        // Get random campaign ID
        const campaignId = getRandomItem(campaignIds);

        donationsToInsert.push({
          contactId: insertedContact.id,
          categoryId: selectedCategory.id, // Set to the actual category ID
          categoryItemId: selectedCategoryItem.id,
          amount: amount.toString(),
          currency: "USD" as const,
          amountUsd: amount.toString(),
          exchangeRate: "1.0000",
          paymentDate,
          receivedDate: paymentDate,
          checkDate: paymentMethod === "check" ? paymentDate : null,
          paymentMethod,
          methodDetail: paymentMethod === "check" ? getRandomItem(checkNumbers) : null,
          paymentStatus: "completed" as const,
          referenceNumber: getRandomItem(referenceNumbers),
          checkNumber: paymentMethod === "check" ? getRandomItem(checkNumbers) : null,
          receiptNumber: `RCP-${getRandomInt(10000, 99999)}`,
          receiptType: "receipt" as const,
          receiptIssued: Math.random() > 0.3,
          campaignId,
          notes: `Sandbox donation for testing purposes`,
        });
      }
    }

    // Insert donations in batches
    const batchSize = 20; // Reduced batch size to avoid parameter limits
    let totalInserted = 0;

    for (let i = 0; i < donationsToInsert.length; i += batchSize) {
      const batch = donationsToInsert.slice(i, i + batchSize);
      await db.insert(manualDonation).values(batch);
      totalInserted += batch.length;
      console.log(`Inserted donations ${i + 1} to ${Math.min(i + batchSize, donationsToInsert.length)} (${totalInserted}/${donationsToInsert.length})`);
    }

    console.log(`\n✓ Created ${donationsToInsert.length} manual donations`);

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("SANDBOX DATA SEEDING COMPLETE!");
    console.log("=".repeat(50));
    console.log(`Location ID: ${LOCATION_ID}`);
    console.log(`Categories: ${insertedCategories.length}`);
    console.log(`Category Items: ${insertedCategoryItems.length}`);
    console.log(`Payment Methods: ${insertedPaymentMethods.length}`);
    console.log(`Campaigns: ${insertedCampaigns.length}`);
    console.log(`Contacts: ${insertedContacts.length}`);
    console.log(`Manual Donations: ${donationsToInsert.length}`);
    console.log("=".repeat(50));

  } catch (error) {
    console.error("Error seeding sandbox data:", error);
    process.exit(1);
  }

  console.log("\n✅ Seeding complete! Exiting...\n");
  process.exit(0);
}

seed();