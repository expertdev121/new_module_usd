import { db } from "@/lib/db";
import {
  user,
  contact,
  category,
  categoryItem,
  categoryGroup,
  tag,
  pledge,
  paymentPlan,
  payment,
  paymentAllocations,
  installmentSchedule,
  relationships,
  contactRoles,
  studentRoles,
  solicitor,
  bonusRule,
  exchangeRate,
  paymentTags,
  pledgeTags,
  bonusCalculation,
  auditLog,
  type NewUser,
  type NewContact,
  type NewCategory,
  type NewCategoryItem,
  type NewTag,
  type NewPledge,
  type NewPaymentPlan,
  type NewPayment,
  type NewPaymentAllocation,
  type NewInstallmentSchedule,
  type NewRelationship,
  type NewContactRole,
  type NewStudentRole,
  type NewSolicitor,
  type NewBonusRule,
  type NewExchangeRate,
  type NewPaymentTag,
  type NewPledgeTag,
  type NewBonusCalculation,
  type NewAuditLog,
} from "@/lib/db/schema";
import bcrypt from "bcryptjs";

// Set the environment variable directly
process.env.DATABASE_URL ='postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-delicate-smoke-a9zveme7-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require';
 
// Also set it in the global environment
import { config } from 'dotenv';
config();

// Simple faker replacement since @faker-js/faker might not be available
const simpleFaker = {
  string: {
    uuid: () => Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2),
    alphanumeric: (length: number) => Math.random().toString(36).substring(2, length + 2).toUpperCase(),
  },
  person: {
    firstName: () => ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emma', 'James', 'Olivia'][Math.floor(Math.random() * 8)],
    lastName: () => ['Smith', 'Johnson', 'Brown', 'Williams', 'Jones', 'Garcia', 'Miller', 'Davis'][Math.floor(Math.random() * 8)],
  },
  internet: {
    email: () => `user${Math.floor(Math.random() * 1000)}@example.com`,
    ip: () => `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
    userAgent: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
  phone: {
    number: () => `+1-${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
  },
  location: {
    streetAddress: () => `${Math.floor(Math.random() * 9999) + 1} Main St`,
  },
  commerce: {
    productName: () => ['Premium Service', 'Basic Package', 'Advanced Plan', 'Standard Offering'][Math.floor(Math.random() * 4)],
  },
  lorem: {
    sentence: () => 'This is a sample description for testing purposes.',
  },
  number: {
    int: ({ min, max }: { min: number; max: number }) => Math.floor(Math.random() * (max - min + 1)) + min,
    float: ({ min, max, precision }: { min: number; max: number; precision: number }) => {
      const value = Math.random() * (max - min) + min;
      return Math.round(value / precision) * precision;
    },
  },
  date: {
    between: ({ from, to }: { from: Date; to: Date }) => {
      const fromTime = from.getTime();
      const toTime = to.getTime();
      return new Date(fromTime + Math.random() * (toTime - fromTime));
    },
  },
  datatype: {
    boolean: () => Math.random() > 0.5,
  },
};

// Helper function to get random element from array
function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

// Helper function to generate random date within last year
function getRandomDate(): Date {
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  return simpleFaker.date.between({ from: oneYearAgo, to: now });
}

async function seedComprehensive() {
  try {
    console.log("Starting comprehensive database seeding...");

    // Clear existing data in reverse dependency order
    console.log("Clearing existing data...");
    await db.delete(auditLog).execute();
    await db.delete(bonusCalculation).execute();
    await db.delete(pledgeTags).execute();
    await db.delete(paymentTags).execute();
    await db.delete(paymentAllocations).execute();
    await db.delete(payment).execute();
    await db.delete(installmentSchedule).execute();
    await db.delete(paymentPlan).execute();
    await db.delete(pledge).execute();
    await db.delete(exchangeRate).execute();
    await db.delete(bonusRule).execute();
    await db.delete(solicitor).execute();
    await db.delete(studentRoles).execute();
    await db.delete(contactRoles).execute();
    await db.delete(relationships).execute();
    await db.delete(tag).execute();
    await db.delete(categoryItem).execute();
    await db.delete(category).execute();
    await db.delete(contact).execute();
    await db.delete(user).execute();
    console.log("Existing data cleared.");

    // 1. Seed Users (Admins and Users) - 10 users
    console.log("Seeding users...");
    const usersData = [];
    for (let i = 0; i < 10; i++) {
      const isAdmin = i < 2; // First 2 are admins
      const hashedPassword = await bcrypt.hash(isAdmin ? "admin123" : "user123", 10);
      usersData.push({
        email: isAdmin ? `admin${i + 1}@example.com` : `user${i - 1}@example.com`,
        passwordHash: hashedPassword,
        role: isAdmin ? ("admin" as const) : ("user" as const),
        status: "active" as const,
        isActive: true,
      });
    }
    const insertedUsers = await db.insert(user).values(usersData).returning({ id: user.id });
    console.log(`Seeded ${insertedUsers.length} users`);

    // 2. Seed Contacts - 50 contacts
    console.log("Seeding contacts...");
    const contactsData = [];
    for (let i = 0; i < 50; i++) {
      const fname = simpleFaker.person.firstName();
      const lname = simpleFaker.person.lastName();
      contactsData.push({
        ghlContactId: simpleFaker.string.uuid(),
        locationId: simpleFaker.string.uuid(),
        firstName: fname,
        lastName: lname,
        displayName: `${fname} ${lname}`,
        email: simpleFaker.internet.email(),
        phone: simpleFaker.phone.number(),
        title: getRandomElement(["mr", "mrs", "ms", "dr", "rabbi"]),
        gender: getRandomElement(["male", "female"] as const),
        address: simpleFaker.location.streetAddress(),
      });
    }
    const insertedContacts = await db.insert(contact).values(contactsData as NewContact[]).returning({ id: contact.id });
    console.log(`Seeded ${insertedContacts.length} contacts`);

    // 3. Seed Categories - 5 categories
    console.log("Seeding categories...");
    const categoriesData = [
      { name: "Tuition", description: "Tuition payments" },
      { name: "Donation", description: "General donations" },
      { name: "Scholarship", description: "Scholarship funds" },
      { name: "Building Fund", description: "Building maintenance" },
      { name: "Program Support", description: "Program specific support" },
    ];
    const insertedCategories = await db.insert(category).values(categoriesData as NewCategory[]).returning({ id: category.id, name: category.name });
    console.log(`Seeded ${insertedCategories.length} categories`);

    // 4. Seed Category Items - 20 items
    console.log("Seeding category items...");
    const categoryItemsData = [];
    for (let i = 0; i < 20; i++) {
      categoryItemsData.push({
        name: simpleFaker.commerce.productName(),
        occId: simpleFaker.number.int({ min: 1, max: 100 }),
        categoryId: getRandomElement(insertedCategories).id,
      });
    }
    const insertedCategoryItems = await db.insert(categoryItem).values(categoryItemsData as NewCategoryItem[]).returning({ id: categoryItem.id });
    console.log(`Seeded ${insertedCategoryItems.length} category items`);

    // 5. Seed Tags - 10 tags
    console.log("Seeding tags...");
    const tagsData = [
      { name: "Urgent", description: "Urgent payments", showOnPayment: true, showOnPledge: true },
      { name: "Recurring", description: "Recurring donations", showOnPayment: true, showOnPledge: true },
      { name: "Anonymous", description: "Anonymous donor", showOnPayment: false, showOnPledge: false },
      { name: "Matching", description: "Matching funds", showOnPayment: true, showOnPledge: true },
      { name: "Endowment", description: "Endowment funds", showOnPayment: true, showOnPledge: true },
      { name: "Memorial", description: "In memory of", showOnPayment: true, showOnPledge: true },
      { name: "Honor", description: "In honor of", showOnPayment: true, showOnPledge: true },
      { name: "Student", description: "Student specific", showOnPayment: true, showOnPledge: true },
      { name: "Alumni", description: "Alumni donation", showOnPayment: true, showOnPledge: true },
      { name: "Corporate", description: "Corporate sponsorship", showOnPayment: true, showOnPledge: true },
    ];
    const insertedTags = await db.insert(tag).values(tagsData as NewTag[]).returning({ id: tag.id });
    console.log(`Seeded ${insertedTags.length} tags`);

    // 6. Seed Relationships - 20 relationships
    console.log("Seeding relationships...");
    const relationshipsData = [];
    for (let i = 0; i < 20; i++) {
      const contactId = getRandomElement(insertedContacts).id;
      let relatedContactId;
      do {
        relatedContactId = getRandomElement(insertedContacts).id;
      } while (relatedContactId === contactId);

      relationshipsData.push({
        contactId,
        relatedContactId,
        relationshipType: getRandomElement(["father", "mother", "spouse", "friend", "donor"] as const),
        isActive: true,
        notes: simpleFaker.lorem.sentence(),
      });
    }
    const insertedRelationships = await db.insert(relationships).values(relationshipsData as NewRelationship[]).returning({ id: relationships.id });
    console.log(`Seeded ${insertedRelationships.length} relationships`);

    // 7. Seed Contact Roles - 30 roles
    console.log("Seeding contact roles...");
    const contactRolesData = [];
    for (let i = 0; i < 30; i++) {
      contactRolesData.push({
        contactId: getRandomElement(insertedContacts).id,
        roleName: getRandomElement(["Board Member", "Volunteer", "Donor", "Parent", "Student"]),
        isActive: true,
        startDate: getRandomDate().toISOString().split('T')[0],
        notes: simpleFaker.lorem.sentence(),
      });
    }
    await db.insert(contactRoles).values(contactRolesData as NewContactRole[]);
    console.log(`Seeded ${contactRolesData.length} contact roles`);

    // 8. Seed Student Roles - 20 student roles
    console.log("Seeding student roles...");
    const studentRolesData = [];
    for (let i = 0; i < 20; i++) {
      studentRolesData.push({
        contactId: getRandomElement(insertedContacts).id,
        year: "2024-2025",
        program: getRandomElement(["LH", "LLC", "ML", "Kollel"] as const),
        track: getRandomElement(["Alef", "Bet", "Gimmel"] as const),
        trackDetail: getRandomElement(["Full Year", "Fall", "Spring"] as const),
        status: getRandomElement(["Student", "Active Soldier", "Staff"] as const),
        machzor: getRandomElement(["10.5", "10", "9.5"] as const),
        startDate: getRandomDate().toISOString().split('T')[0],
        isActive: true,
        additionalNotes: simpleFaker.lorem.sentence(),
      });
    }
    await db.insert(studentRoles).values(studentRolesData as NewStudentRole[]);
    console.log(`Seeded ${studentRolesData.length} student roles`);

    // 9. Seed Solicitors - 10 solicitors
    console.log("Seeding solicitors...");
    const solicitorsData = [];
    for (let i = 0; i < 10; i++) {
      solicitorsData.push({
        contactId: getRandomElement(insertedContacts).id,
        solicitorCode: `SOL${simpleFaker.string.alphanumeric(4)}`,
        status: getRandomElement(["active", "inactive"] as const),
        commissionRate: simpleFaker.number.float({ min: 1, max: 10, precision: 0.01 }).toString(),
        hireDate: getRandomDate().toISOString().split('T')[0],
        notes: simpleFaker.lorem.sentence(),
      });
    }
    const insertedSolicitors = await db.insert(solicitor).values(solicitorsData as NewSolicitor[]).returning({ id: solicitor.id });
    console.log(`Seeded ${insertedSolicitors.length} solicitors`);

    // 10. Seed Bonus Rules - 15 bonus rules
    console.log("Seeding bonus rules...");
    const bonusRulesData = [];
    for (let i = 0; i < 15; i++) {
      bonusRulesData.push({
        solicitorId: getRandomElement(insertedSolicitors).id,
        ruleName: `Bonus Rule ${i + 1}`,
        bonusPercentage: simpleFaker.number.float({ min: 1, max: 15, precision: 0.01 }).toString(),
        paymentType: getRandomElement(["tuition", "donation", "both"] as const),
        minAmount: simpleFaker.number.float({ min: 100, max: 1000, precision: 0.01 }).toString(),
        maxAmount: simpleFaker.number.float({ min: 1000, max: 10000, precision: 0.01 }).toString(),
        effectiveFrom: getRandomDate().toISOString().split('T')[0],
        isActive: true,
        priority: simpleFaker.number.int({ min: 1, max: 5 }),
        notes: simpleFaker.lorem.sentence(),
      });
    }
    const insertedBonusRules = await db.insert(bonusRule).values(bonusRulesData as NewBonusRule[]).returning({ id: bonusRule.id });
    console.log(`Seeded ${insertedBonusRules.length} bonus rules`);

    // 11. Seed Exchange Rates - 10 rates
    console.log("Seeding exchange rates...");
    const exchangeRatesData = [];
    const currencies = ["USD", "ILS", "EUR", "GBP"] as const;
    for (let i = 0; i < 10; i++) {
      const base = "USD" as const;
      const target = getRandomElement(currencies.filter(c => c !== base));
      exchangeRatesData.push({
        baseCurrency: base,
        targetCurrency: target,
        rate: simpleFaker.number.float({ min: 0.5, max: 4.0, precision: 0.0001 }).toString(),
        date: getRandomDate().toISOString().split('T')[0],
      });
    }
    await db.insert(exchangeRate).values(exchangeRatesData as NewExchangeRate[]);
    console.log(`Seeded ${exchangeRatesData.length} exchange rates`);

    // 12. Seed Pledges - 30 pledges
    console.log("Seeding pledges...");
    const pledgesData = [];
    for (let i = 0; i < 30; i++) {
      const originalAmount = simpleFaker.number.float({ min: 100, max: 10000, precision: 0.01 });
      pledgesData.push({
        contactId: getRandomElement(insertedContacts).id,
        categoryId: getRandomElement(insertedCategories).id,
        relationshipId: getRandomElement(insertedRelationships).id,
        pledgeDate: getRandomDate().toISOString().split('T')[0],
        description: simpleFaker.lorem.sentence(),
        originalAmount: originalAmount.toString(),
        currency: getRandomElement(["USD", "ILS", "EUR"] as const),
        totalPaid: "0",
        balance: originalAmount.toString(),
        campaignCode: simpleFaker.string.alphanumeric(6).toUpperCase(),
        isActive: true,
        notes: simpleFaker.lorem.sentence(),
      });
    }
    const insertedPledges = await db.insert(pledge).values(pledgesData as NewPledge[]).returning({ id: pledge.id });
    console.log(`Seeded ${insertedPledges.length} pledges`);

    // 13. Seed Payment Plans - 20 payment plans
    console.log("Seeding payment plans...");
    const paymentPlansData = [];
    for (let i = 0; i < 20; i++) {
      const pledgeId = getRandomElement(insertedPledges).id;
      const totalPlannedAmount = simpleFaker.number.float({ min: 500, max: 5000, precision: 0.01 });
      const numberOfInstallments = simpleFaker.number.int({ min: 6, max: 24 });
      const installmentAmount = totalPlannedAmount / numberOfInstallments;
      paymentPlansData.push({
        pledgeId,
        relationshipId: getRandomElement(insertedRelationships).id,
        planName: `Plan ${i + 1}`,
        frequency: getRandomElement(["monthly", "quarterly", "annual"] as const),
        distributionType: "fixed" as const,
        totalPlannedAmount: totalPlannedAmount.toString(),
        currency: getRandomElement(["USD", "ILS"] as const),
        installmentAmount: installmentAmount.toString(),
        numberOfInstallments,
        startDate: getRandomDate().toISOString().split('T')[0],
        planStatus: getRandomElement(["active", "completed"] as const),
        isActive: true,
        notes: simpleFaker.lorem.sentence(),
      });
    }
    const insertedPaymentPlans = await db.insert(paymentPlan).values(paymentPlansData as NewPaymentPlan[]).returning({ id: paymentPlan.id, installmentAmount: paymentPlan.installmentAmount, currency: paymentPlan.currency });
    console.log(`Seeded ${insertedPaymentPlans.length} payment plans`);

    // 14. Seed Installment Schedules - 100 installments (approx 5 per plan)
    console.log("Seeding installment schedules...");
    const installmentSchedulesData = [];
    for (const plan of insertedPaymentPlans) {
      const installments = simpleFaker.number.int({ min: 3, max: 8 });
      for (let j = 0; j < installments; j++) {
        installmentSchedulesData.push({
          paymentPlanId: plan.id,
          installmentDate: new Date(Date.now() + j * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          installmentAmount: (parseFloat(plan.installmentAmount) / installments).toString(),
          currency: plan.currency,
          status: getRandomElement(["pending", "paid"] as const),
          notes: simpleFaker.lorem.sentence(),
        });
      }
    }
    const insertedInstallmentSchedules = await db.insert(installmentSchedule).values(installmentSchedulesData as NewInstallmentSchedule[]).returning({ id: installmentSchedule.id });
    console.log(`Seeded ${insertedInstallmentSchedules.length} installment schedules`);

    // 15. Seed Payments - 50 payments
    console.log("Seeding payments...");
    const paymentsData = [];
    for (let i = 0; i < 50; i++) {
      const amount = simpleFaker.number.float({ min: 50, max: 2000, precision: 0.01 });
      paymentsData.push({
        pledgeId: getRandomElement(insertedPledges).id,
        paymentPlanId: getRandomElement(insertedPaymentPlans).id,
        installmentScheduleId: getRandomElement(insertedInstallmentSchedules).id,
        relationshipId: getRandomElement(insertedRelationships).id,
        payerContactId: getRandomElement(insertedContacts).id,
        isThirdPartyPayment: simpleFaker.datatype.boolean(),
        amount: amount.toString(),
        currency: getRandomElement(["USD", "ILS"] as const),
        paymentDate: getRandomDate().toISOString().split('T')[0],
        paymentMethod: getRandomElement(["cash", "check", "credit_card", "bank_transfer"]),
        paymentStatus: getRandomElement(["completed", "pending"] as const),
        referenceNumber: simpleFaker.string.alphanumeric(10).toUpperCase(),
        checkNumber: simpleFaker.string.alphanumeric(6),
        receiptNumber: simpleFaker.string.alphanumeric(8),
        receiptType: getRandomElement(["invoice", "receipt"] as const),
        solicitorId: getRandomElement(insertedSolicitors).id,
        bonusPercentage: simpleFaker.number.float({ min: 1, max: 5, precision: 0.01 }).toString(),
        bonusAmount: (amount * 0.05).toString(),
        bonusRuleId: getRandomElement(insertedBonusRules).id,
        notes: simpleFaker.lorem.sentence(),
      });
    }
    const insertedPayments = await db.insert(payment).values(paymentsData as NewPayment[]).returning({ id: payment.id });
    console.log(`Seeded ${insertedPayments.length} payments`);

    // 16. Seed Payment Allocations - 50 allocations
    console.log("Seeding payment allocations...");
    const paymentAllocationsData = [];
    for (let i = 0; i < 50; i++) {
      const paymentId = getRandomElement(insertedPayments).id;
      const pledgeId = getRandomElement(insertedPledges).id;
      const allocatedAmount = simpleFaker.number.float({ min: 25, max: 1000, precision: 0.01 });
      paymentAllocationsData.push({
        paymentId,
        pledgeId,
        installmentScheduleId: getRandomElement(insertedInstallmentSchedules).id,
        payerContactId: getRandomElement(insertedContacts).id,
        allocatedAmount: allocatedAmount.toString(),
        currency: getRandomElement(["USD", "ILS"] as const),
        receiptNumber: simpleFaker.string.alphanumeric(8),
        receiptType: getRandomElement(["invoice", "receipt"] as const),
        notes: simpleFaker.lorem.sentence(),
      });
    }
    await db.insert(paymentAllocations).values(paymentAllocationsData as NewPaymentAllocation[]);
    console.log(`Seeded ${paymentAllocationsData.length} payment allocations`);

    // 17. Seed Payment Tags - 40 payment tags
    console.log("Seeding payment tags...");
    const paymentTagsData = [];
    for (let i = 0; i < 40; i++) {
      paymentTagsData.push({
        paymentId: getRandomElement(insertedPayments).id,
        tagId: getRandomElement(insertedTags).id,
      });
    }
    await db.insert(paymentTags).values(paymentTagsData);
    console.log(`Seeded ${paymentTagsData.length} payment tags`);

    // 18. Seed Pledge Tags - 30 pledge tags
    console.log("Seeding pledge tags...");
    const pledgeTagsData = [];
    for (let i = 0; i < 30; i++) {
      pledgeTagsData.push({
        pledgeId: getRandomElement(insertedPledges).id,
        tagId: getRandomElement(insertedTags).id,
      });
    }
    await db.insert(pledgeTags).values(pledgeTagsData);
    console.log(`Seeded ${pledgeTagsData.length} pledge tags`);

    // 19. Seed Bonus Calculations - 20 bonus calculations
    console.log("Seeding bonus calculations...");
    const bonusCalculationsData = [];
    for (let i = 0; i < 20; i++) {
      const paymentId = getRandomElement(insertedPayments).id;
      const solicitorId = getRandomElement(insertedSolicitors).id;
      const paymentAmount = simpleFaker.number.float({ min: 100, max: 2000, precision: 0.01 });
      const bonusPercentage = simpleFaker.number.float({ min: 1, max: 10, precision: 0.01 });
      bonusCalculationsData.push({
        paymentId,
        solicitorId,
        bonusRuleId: getRandomElement(insertedBonusRules).id,
        paymentAmount: paymentAmount.toString(),
        bonusPercentage: bonusPercentage.toString(),
        bonusAmount: (paymentAmount * bonusPercentage / 100).toString(),
        isPaid: simpleFaker.datatype.boolean(),
        notes: simpleFaker.lorem.sentence(),
      });
    }
    await db.insert(bonusCalculation).values(bonusCalculationsData);
    console.log(`Seeded ${bonusCalculationsData.length} bonus calculations`);

    // 20. Seed Audit Logs - 20 audit logs
    console.log("Seeding audit logs...");
    const auditLogsData = [];
    for (let i = 0; i < 20; i++) {
      auditLogsData.push({
        userId: getRandomElement(insertedUsers).id,
        userEmail: simpleFaker.internet.email(),
        action: getRandomElement(["CREATE", "UPDATE", "DELETE", "LOGIN"]),
        details: simpleFaker.lorem.sentence(),
        ipAddress: simpleFaker.internet.ip(),
        userAgent: simpleFaker.internet.userAgent(),
      });
    }
    await db.insert(auditLog).values(auditLogsData);
    console.log(`Seeded ${auditLogsData.length} audit logs`);

    console.log("Comprehensive database seeding completed successfully!");
    console.log("Total records created: ~300+");

  } catch (error) {
    console.error("Error during comprehensive seeding:", error);
  } finally {
    process.exit(0);
  }
}

seedComprehensive();