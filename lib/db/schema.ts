import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  date,
  boolean,
  numeric,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const titleEnum = pgEnum("title", [
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "eng",
  "other",
  "rabbi",
]);

export const genderEnum = pgEnum("gender", ["male", "female"]);

export const receiptTypeEnum = pgEnum("receipt_type", [
  "invoice",
  "confirmation",
  "receipt",
  "other",
]);

export const relationshipEnum = pgEnum("relationship", [
  "mother",
  "father",
  "grandmother",
  "grandchild",
  "grandfather",
  "grandparent",
  "parent",
  "step-parent",
  "stepmother",
  "stepfather",
  "sister",
  "brother",
  "step-sister",
  "step-brother",
  "stepson",
  "daughter",
  "son",
  "aunt",
  "uncle",
  "aunt/uncle",
  "nephew",
  "niece",
  "grandson",
  "granddaughter",
  "cousin (m)",
  "cousin (f)",
  "spouse",
  "partner",
  "wife",
  "husband",
  "former husband",
  "former wife",
  "fiance",
  "divorced co-parent",
  "separated co-parent",
  "legal guardian",
  "legal guardian partner",
  "friend",
  "neighbor",
  "relative",
  "business",
  "owner",
  "chevrusa",
  "congregant",
  "rabbi",
  "contact",
  "foundation",
  "donor",
  "fund",
  "rebbi contact",
  "rebbi contact for",
  "employee",
  "employer",
  "machatunim",
  "His Sister",
  "Her Sister",
  "Her Brother",
  "His Brother",
  "His Aunt",
  "Her Aunt",
  "His Uncle",
  "Her Uncle",
  "His Parents",
  "Her Parents",
  "Her Mother",
  "His Mother",
  "His Father",
  "Her Nephew",
  "His Nephew",
  "His Niece",
  "Her Niece",
  "His Grandparents",
  "Her Grandparents",
  "Her Father",
  "Their Daughter",
  "Their Son",
  "His Daughter",
  "His Son",
  "Her Daughter",
  "Her Son",
  "His Cousin (M)",
  "Her Grandfather",
  "Her Grandmother",
  "His Grandfather",
  "His Grandmother",
  "His Wife",
  "Her Husband",
  "Her Former Husband",
  "His Former Wife",
  "His Cousin (F)",
  "Her Cousin (M)",
  "Her Cousin (F)",
  "Partner",
  "Friend",
  "Neighbor",
  "Relative",
  "Business",
  "Chevrusa",
  "Congregant",
  "Contact",
  "Donor",
  "Fiance",
  "Foundation",
  "Fund",
  "Her Step Son",
  "His Step Mother",
  "Owner",
  "Rabbi",
  "Their Granddaughter",
  "Their Grandson",
  "Employee",
  "Employer"
]);

export const programEnum = pgEnum("program", [
  "LH",
  "LLC",
  "ML",
  "Kollel",
  "Madrich",
]);

export const trackEnum = pgEnum("track", [
  "Alef",
  "Bet",
  "Gimmel",
  "Dalet",
  "Heh",
  "March Draft",
  "August Draft",
  "Room & Board",
  "Other Draft",
]);

export const trackDetailEnum = pgEnum("track_detail", [
  "Full Year",
  "Fall",
  "Spring",
  "Until Pesach",
]);

export const statusEnum = pgEnum("status", [
  "Student",
  "Active Soldier",
  "Staff",
  "Withdrew",
  "Transferred Out",
  "Left Early",
  "Asked to Leave",
]);

export const machzorEnum = pgEnum("machzor", [
  "10.5",
  "10",
  "9.5",
  "9",
  "8.5",
  "8",
]);

// REMOVED: paymentMethodEnum to avoid conflict with payment_method table
// Old enum values were: "ach", "bill_pay", "cash", "check", "credit", etc.

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "completed",
  "failed",
  "cancelled",
  "refunded",
  "processing",
  "expected"
]);

export const frequencyEnum = pgEnum("frequency", [
  "weekly",
  "monthly",
  "quarterly",
  "biannual",
  "annual",
  "one_time",
  "custom",
]);

export const planStatusEnum = pgEnum("plan_status", [
  "active",
  "completed",
  "cancelled",
  "paused",
  "overdue",
]);

export const currencyEnum = pgEnum("currency", [
  "USD",
  "ILS",
  "EUR",
  "JPY",
  "GBP",
  "AUD",
  "CAD",
  "ZAR",
]);

export const solicitorStatusEnum = pgEnum("solicitor_status", [
  "active",
  "inactive",
  "suspended",
]);

export const bonusPaymentTypeEnum = pgEnum("bonus_payment_type", [
  "tuition",
  "donation",
  "both",
]);

export const distributionTypeEnum = pgEnum("distribution_type", [
  "fixed",
  "custom",
]);

export const installmentStatusEnum = pgEnum("installment_status", [
  "pending",
  "paid",
  "overdue",
  "cancelled",
]);

export const roleEnum = pgEnum("role", ["admin", "user", "super_admin"]);

export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);

export const user = pgTable("user", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  locationId: text("location_id"),
  role: roleEnum("role").notNull().default("user"),
  status: userStatusEnum("status").notNull().default("active"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;

export const campaignStatusEnum = pgEnum("campaign_status", ["active", "inactive", "completed"]);

export const campaign = pgTable("campaign", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: campaignStatusEnum("status").notNull().default("active"),
  locationId: text("location_id"),
  createdBy: integer("created_by").references(() => user.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Campaign = typeof campaign.$inferSelect;
export type NewCampaign = typeof campaign.$inferInsert;

export const contact = pgTable("contact", {
  id: serial("id").primaryKey(),
  ghlContactId: text("ghl_contact_id"),
  locationId: text("location_id"),
  firstName: text("first_name").notNull(),
  displayName: text("display_name"),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  title: text("title"),
  gender: genderEnum("gender"),
  address: text("address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Contact = typeof contact.$inferSelect;
export type NewContact = typeof contact.$inferInsert;

export const paymentMethods = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  locationId: text("location_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type NewPaymentMethod = typeof paymentMethods.$inferInsert;

export const paymentMethodDetails = pgTable("payment_method_details", {
  id: serial("id").primaryKey(),
  paymentMethodId: integer("payment_method_id")
    .references(() => paymentMethods.id, { onDelete: "cascade" })
    .notNull(),
  key: text("key").notNull(),
  value: text("value"),
  locationId: text("location_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PaymentMethodDetail = typeof paymentMethodDetails.$inferSelect;
export type NewPaymentMethodDetail = typeof paymentMethodDetails.$inferInsert;

// Table definitions continue below


export const studentRoles = pgTable(
  "student_roles",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .references(() => contact.id, { onDelete: "cascade" })
      .notNull(),
    year: text("year").notNull().default("2024-2025"),
    program: programEnum("program").notNull(),
    track: trackEnum("track").notNull(),
    trackDetail: trackDetailEnum("track_detail"),
    locationId: text("location_id"),
    status: statusEnum("status").notNull(),
    machzor: machzorEnum("machzor"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    isActive: boolean("is_active").default(true).notNull(),
    additionalNotes: text("additional_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    contactIdIdx: index("student_roles_contact_id_idx").on(table.contactId),
  })
);

export type StudentRole = typeof studentRoles.$inferSelect;
export type NewStudentRole = typeof studentRoles.$inferInsert;

export const contactRoles = pgTable(
  "contact_roles",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .references(() => contact.id, { onDelete: "cascade" })
      .notNull(),
    roleName: text("role_name").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    notes: text("notes"),
    locationId: text("location_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    contactIdIdx: index("contact_roles_contact_id_idx").on(table.contactId),
    roleNameIdx: index("contact_roles_role_name_idx").on(table.roleName),
  })
);

export type ContactRole = typeof contactRoles.$inferSelect;
export type NewContactRole = typeof contactRoles.$inferInsert;

export const relationships = pgTable(
  "relationships",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .references(() => contact.id, { onDelete: "cascade" })
      .notNull(),
    relatedContactId: integer("related_contact_id")
      .references(() => contact.id, { onDelete: "cascade" })
      .notNull(),
    relationshipType: relationshipEnum("relationship_type").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    notes: text("notes"),
    locationId: text("location_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    contactIdIdx: index("relationships_contact_id_idx").on(table.contactId),
    relatedContactIdIdx: index("relationships_related_contact_id_idx").on(
      table.relatedContactId
    ),
    uniqueRelationship: uniqueIndex("relationships_unique").on(
      table.contactId,
      table.relatedContactId,
      table.relationshipType
    ),
  })
);

export type Relationship = typeof relationships.$inferSelect;
export type NewRelationship = typeof relationships.$inferInsert;

export const category = pgTable("category", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  locationId: text("location_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Category = typeof category.$inferSelect;
export type NewCategory = typeof category.$inferInsert;

export const categoryItem = pgTable("category_item", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  occId: integer("occ_id"),
  categoryId: integer("category_id")
    .notNull()
    .references(() => category.id, { onDelete: "cascade" }),
  isActive: boolean("is_active").default(true).notNull(),
  locationId: text("location_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CategoryItem = typeof categoryItem.$inferSelect;
export type NewCategoryItem = typeof categoryItem.$inferInsert;

export const categoryGroup = pgTable("category_group", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  locationId: text("location_id"),
  categoryId: integer("category_id")
    .notNull()
    .references(() => category.id, { onDelete: "cascade" }),
  categoryItemId: integer("category_item_id")
    .notNull()
    .references(() => categoryItem.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CategoryGroup = typeof categoryGroup.$inferSelect;
export type NewCategoryGroup = typeof categoryGroup.$inferInsert;

export const tag = pgTable("tag", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  locationId: text("location_id"),
  showOnPayment: boolean("show_on_payment").default(true).notNull(),
  showOnPledge: boolean("show_on_pledge").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Tag = typeof tag.$inferSelect;
export type NewTag = typeof tag.$inferInsert;

export const paymentTags = pgTable(
  "payment_tags",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id")
      .references(() => payment.id, { onDelete: "cascade" })
      .notNull(),
    tagId: integer("tag_id")
      .references(() => tag.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    paymentIdIdx: index("payment_tags_payment_id_idx").on(table.paymentId),
    tagIdIdx: index("payment_tags_tag_id_idx").on(table.tagId),
    uniquePaymentTag: uniqueIndex("payment_tags_unique").on(table.paymentId, table.tagId),
  })
);

export type PaymentTag = typeof paymentTags.$inferSelect;
export type NewPaymentTag = typeof paymentTags.$inferInsert;

export const pledgeTags = pgTable(
  "pledge_tags",
  {
    id: serial("id").primaryKey(),
    pledgeId: integer("pledge_id")
      .references(() => pledge.id, { onDelete: "cascade" })
      .notNull(),
    tagId: integer("tag_id")
      .references(() => tag.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pledgeIdIdx: index("pledge_tags_pledge_id_idx").on(table.pledgeId),
    tagIdIdx: index("pledge_tags_tag_id_idx").on(table.tagId),
    uniquePledgeTag: uniqueIndex("pledge_tags_unique").on(table.pledgeId, table.tagId),
  })
);

export type PledgeTag = typeof pledgeTags.$inferSelect;
export type NewPledgeTag = typeof pledgeTags.$inferInsert;

export const pledge = pgTable(
  "pledge",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .references(() => contact.id, { onDelete: "cascade" })
      .notNull(),
    categoryId: integer("category_id").references(() => category.id, {
      onDelete: "set null",
    }),
    relationshipId: integer("relationship_id").references(() => relationships.id, {
      onDelete: "set null",
    }),
    pledgeDate: date("pledge_date").notNull(),
    description: text("description"),
    originalAmount: numeric("original_amount", {
      precision: 10,
      scale: 2,
    }).notNull(),
    currency: currencyEnum("currency").notNull().default("USD"),
    totalPaid: numeric("total_paid", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    balance: numeric("balance", { precision: 10, scale: 2 }).notNull(),
    originalAmountUsd: numeric("original_amount_usd", {
      precision: 10,
      scale: 2,
    }),
    totalPaidUsd: numeric("total_paid_usd", { precision: 10, scale: 2 }).default(
      "0"
    ),
    exchangeRate: numeric("exchange_rate", { precision: 10, scale: 2 }),
    balanceUsd: numeric("balance_usd", { precision: 10, scale: 2 }),
    campaignCode: text("campaign_code"),
    isActive: boolean("is_active").default(true).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    contactIdIdx: index("pledge_contact_id_idx").on(table.contactId),
    categoryIdIdx: index("pledge_category_id_idx").on(table.categoryId),
    relationshipIdIdx: index("pledge_relationship_id_idx").on(table.relationshipId),
    pledgeDateIdx: index("pledge_pledge_date_idx").on(table.pledgeDate),
    currencyIdx: index("pledge_currency_idx").on(table.currency),
  })
);

export type Pledge = typeof pledge.$inferSelect;
export type NewPledge = typeof pledge.$inferInsert;

export const paymentPlan = pgTable(
  "payment_plan",
  {
    id: serial("id").primaryKey(),
    pledgeId: integer("pledge_id")
      .references(() => pledge.id, { onDelete: "cascade" })
      .notNull(),
    relationshipId: integer("relationship_id").references(() => relationships.id, {
      onDelete: "set null",
    }),
    planName: text("plan_name"),
    frequency: frequencyEnum("frequency").notNull(),
    distributionType: distributionTypeEnum("distribution_type").notNull().default("fixed"),
    totalPlannedAmount: numeric("total_planned_amount", {
      precision: 10,
      scale: 2,
    }).notNull(),
    currency: currencyEnum("currency").notNull(),
    totalPlannedAmountUsd: numeric("total_planned_amount_usd", {
      precision: 10,
      scale: 2,
    }),
    installmentAmount: numeric("installment_amount", {
      precision: 10,
      scale: 2,
    }).notNull(),
    installmentAmountUsd: numeric("installment_amount_usd", {
      precision: 10,
      scale: 2,
    }),
    numberOfInstallments: integer("number_of_installments").notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 10, scale: 2 }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    nextPaymentDate: date("next_payment_date"),
    installmentsPaid: integer("installments_paid").default(0).notNull(),
    totalPaid: numeric("total_paid", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    totalPaidUsd: numeric("total_paid_usd", { precision: 10, scale: 2 }),
    remainingAmount: numeric("remaining_amount", {
      precision: 10,
      scale: 2,
    }).notNull(),
    remainingAmountUsd: numeric("remaining_amount_usd", {
      precision: 10,
      scale: 2,
    }),
    planStatus: planStatusEnum("plan_status").notNull().default("active"),
    autoRenew: boolean("auto_renew").default(false).notNull(),
    remindersSent: integer("reminders_sent").default(0).notNull(),
    lastReminderDate: date("last_reminder_date"),
    currencyPriority: integer("currency_priority").default(1).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    notes: text("notes"),
    internalNotes: text("internal_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    pledgeIdIdx: index("payment_plan_pledge_id_idx").on(table.pledgeId),
    relationshipIdIdx: index("payment_plan_relationship_id_idx").on(table.relationshipId),
    statusIdx: index("payment_plan_status_idx").on(table.planStatus),
    nextPaymentIdx: index("payment_plan_next_payment_idx").on(
      table.nextPaymentDate
    ),
    currencyIdx: index("payment_plan_currency_idx").on(table.currency),
    currencyPriorityIdx: index("payment_plan_currency_priority_idx").on(table.pledgeId, table.currencyPriority),
  })
);

export type PaymentPlan = typeof paymentPlan.$inferSelect;
export type NewPaymentPlan = typeof paymentPlan.$inferInsert;

export const exchangeRate = pgTable(
  "exchange_rate",
  {
    id: serial("id").primaryKey(),
    baseCurrency: currencyEnum("base_currency").notNull().default("USD"),
    targetCurrency: currencyEnum("target_currency").notNull(),
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    date: date("date").notNull(),
    createdAt: date("created_at").defaultNow().notNull(),
    updatedAt: date("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueRate: uniqueIndex("exchange_rate_unique_idx").on(
      table.baseCurrency,
      table.targetCurrency,
      table.date
    ),
    baseCurrencyIdx: index("exchange_rate_base_currency_idx").on(table.baseCurrency),
    targetCurrencyIdx: index("exchange_rate_target_currency_idx").on(table.targetCurrency),
    dateIdx: index("exchange_rate_date_idx").on(table.date),
  })
);

export type ExchangeRate = typeof exchangeRate.$inferSelect;
export type NewExchangeRate = typeof exchangeRate.$inferInsert;

export const solicitor = pgTable(
  "solicitor",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .references(() => contact.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    solicitorCode: text("solicitor_code").unique(),
    status: solicitorStatusEnum("status").notNull().default("active"),
    commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }),
    hireDate: date("hire_date"),
    terminationDate: date("termination_date"),
    locationId: text("location_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    contactIdIdx: index("solicitor_contact_id_idx").on(table.contactId),
    statusIdx: index("solicitor_status_idx").on(table.status),
    codeIdx: index("solicitor_code_idx").on(table.solicitorCode),
  })
);

export type Solicitor = typeof solicitor.$inferSelect;
export type NewSolicitor = typeof solicitor.$inferInsert;

export const bonusRule = pgTable(
  "bonus_rule",
  {
    id: serial("id").primaryKey(),
    solicitorId: integer("solicitor_id")
      .references(() => solicitor.id, { onDelete: "cascade" })
      .notNull(),
    ruleName: text("rule_name").notNull(),
    bonusPercentage: numeric("bonus_percentage", {
      precision: 5,
      scale: 2,
    }).notNull(),
    paymentType: bonusPaymentTypeEnum("payment_type").notNull().default("both"),
    minAmount: numeric("min_amount", { precision: 10, scale: 2 }),
    maxAmount: numeric("max_amount", { precision: 10, scale: 2 }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    isActive: boolean("is_active").default(true).notNull(),
    priority: integer("priority").default(1).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    solicitorIdIdx: index("bonus_rule_solicitor_id_idx").on(table.solicitorId),
    effectiveDatesIdx: index("bonus_rule_effective_dates_idx").on(
      table.effectiveFrom,
      table.effectiveTo
    ),
    priorityIdx: index("bonus_rule_priority_idx").on(table.priority),
  })
);

export type BonusRule = typeof bonusRule.$inferSelect;
export type NewBonusRule = typeof bonusRule.$inferInsert;

export const installmentSchedule = pgTable(
  "installment_schedule",
  {
    id: serial("id").primaryKey(),
    paymentPlanId: integer("payment_plan_id")
      .references(() => paymentPlan.id, { onDelete: "cascade" })
      .notNull(),
    installmentDate: date("installment_date").notNull(),
    installmentAmount: numeric("installment_amount", {
      precision: 10,
      scale: 2,
    }).notNull(),
    currency: currencyEnum("currency").notNull(),
    installmentAmountUsd: numeric("installment_amount_usd", {
      precision: 10,
      scale: 2,
    }),
    status: installmentStatusEnum("status").notNull().default("pending"),
    paidDate: date("paid_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    paymentId: integer("payment_id"),
  },
  (table) => ({
    paymentPlanIdIdx: index("installment_schedule_payment_plan_id_idx").on(
      table.paymentPlanId
    ),
    installmentDateIdx: index("installment_schedule_installment_date_idx").on(
      table.installmentDate
    ),
    statusIdx: index("installment_schedule_status_idx").on(table.status),
    paymentIdIdx: index("installment_schedule_payment_id_idx").on(table.paymentId),
  })
);

export type InstallmentSchedule = typeof installmentSchedule.$inferSelect;
export type NewInstallmentSchedule = typeof installmentSchedule.$inferInsert;

export const account = pgTable("account", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  locationId: text("location_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;

export const manualDonation = pgTable(
  "manual_donation",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .references(() => contact.id, { onDelete: "cascade" })
      .notNull(),

    // Core donation amount and currency
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: currencyEnum("currency").notNull(),

    // USD conversion (for reporting)
    amountUsd: numeric("amount_usd", { precision: 10, scale: 2 }),
    exchangeRate: numeric("exchange_rate", { precision: 10, scale: 4 }),

    paymentDate: date("payment_date").notNull(),
    receivedDate: date("received_date"),
    checkDate: date("check_date"),
    accountId: integer("account_id").references(() => account.id, {
      onDelete: "set null",
    }),

    // Payment method details
    paymentMethod: text("payment_method"),
    methodDetail: text("method_detail"),
    paymentStatus: paymentStatusEnum("payment_status")
      .notNull()
      .default("completed"),
    referenceNumber: text("reference_number"),
    checkNumber: text("check_number"),
    receiptNumber: text("receipt_number"),
    receiptType: receiptTypeEnum("receipt_type"),
    receiptIssued: boolean("receipt_issued").default(false).notNull(),

    // Solicitor and bonus information
    solicitorId: integer("solicitor_id").references(() => solicitor.id, {
      onDelete: "set null",
    }),
    bonusPercentage: numeric("bonus_percentage", { precision: 5, scale: 2 }),
    bonusAmount: numeric("bonus_amount", { precision: 10, scale: 2 }),
    bonusRuleId: integer("bonus_rule_id").references(() => bonusRule.id, {
      onDelete: "set null",
    }),

    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    contactIdIdx: index("manual_donation_contact_id_idx").on(table.contactId),
    paymentDateIdx: index("manual_donation_payment_date_idx").on(table.paymentDate),
    statusIdx: index("manual_donation_status_idx").on(table.paymentStatus),
    referenceIdx: index("manual_donation_reference_idx").on(table.referenceNumber),
    solicitorIdIdx: index("manual_donation_solicitor_id_idx").on(table.solicitorId),
    currencyIdx: index("manual_donation_currency_idx").on(table.currency),
  })
);

export type ManualDonation = typeof manualDonation.$inferSelect;
export type NewManualDonation = typeof manualDonation.$inferInsert;

export const payment = pgTable(
  "payment",
  {
    id: serial("id").primaryKey(),
    pledgeId: integer("pledge_id").references(() => pledge.id, {
      onDelete: "set null",
    }),
    paymentPlanId: integer("payment_plan_id").references(() => paymentPlan.id, {
      onDelete: "set null",
    }),
    installmentScheduleId: integer("installment_schedule_id").references(
      () => installmentSchedule.id,
      { onDelete: "set null" }
    ),
    relationshipId: integer("relationship_id").references(() => relationships.id, {
      onDelete: "set null",
    }),

    // Third-party payment fields
    payerContactId: integer("payer_contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    isThirdPartyPayment: boolean("is_third_party_payment").default(false).notNull(),

    // Core payment amount and currency
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: currencyEnum("currency").notNull(),

    // USD conversion (for reporting)
    amountUsd: numeric("amount_usd", { precision: 10, scale: 2 }),
    exchangeRate: numeric("exchange_rate", { precision: 10, scale: 4 }),

    // Pledge currency conversion (for pledge balance calculations)
    amountInPledgeCurrency: numeric("amount_in_pledge_currency", {
      precision: 10,
      scale: 2,
    }),
    pledgeCurrencyExchangeRate: numeric("pledge_currency_exchange_rate", {
      precision: 10,
      scale: 4,
    }),

    // Plan currency conversion (for plan tracking)
    amountInPlanCurrency: numeric("amount_in_plan_currency", {
      precision: 10,
      scale: 2,
    }),
    planCurrencyExchangeRate: numeric("plan_currency_exchange_rate", {
      precision: 10,
      scale: 4,
    }),

    paymentDate: date("payment_date").notNull(),
    receivedDate: date("received_date"),
    checkDate: date("check_date"),
    account: text("account"),

    // UPDATED: Changed from enum to text field to preserve data
    paymentMethod: text("payment_method"),
    methodDetail: text("method_detail"),
    paymentStatus: paymentStatusEnum("payment_status")
      .notNull()
      .default("completed"),
    referenceNumber: text("reference_number"),
    checkNumber: text("check_number"),
    receiptNumber: text("receipt_number"),
    receiptType: receiptTypeEnum("receipt_type"),
    receiptIssued: boolean("receipt_issued").default(false).notNull(),
    solicitorId: integer("solicitor_id").references(() => solicitor.id, {
      onDelete: "set null",
    }),
    bonusPercentage: numeric("bonus_percentage", { precision: 5, scale: 2 }),
    bonusAmount: numeric("bonus_amount", { precision: 10, scale: 2 }),
    bonusRuleId: integer("bonus_rule_id").references(() => bonusRule.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    pledgeIdIdx: index("payment_pledge_id_idx").on(table.pledgeId),
    paymentPlanIdIdx: index("payment_payment_plan_id_idx").on(table.paymentPlanId),
    relationshipIdIdx: index("payment_relationship_id_idx").on(table.relationshipId),
    payerContactIdIdx: index("payment_payer_contact_id_idx").on(table.payerContactId),
    isThirdPartyIdx: index("payment_is_third_party_idx").on(table.isThirdPartyPayment),
    paymentDateIdx: index("payment_payment_date_idx").on(table.paymentDate),
    statusIdx: index("payment_status_idx").on(table.paymentStatus),
    referenceIdx: index("payment_reference_idx").on(table.referenceNumber),
    solicitorIdIdx: index("payment_solicitor_id_idx").on(table.solicitorId),
    installmentScheduleIdIdx: index("payment_installment_schedule_id_idx").on(table.installmentScheduleId),
    currencyIdx: index("payment_currency_idx").on(table.currency),
  })
);

export type Payment = typeof payment.$inferSelect;
export type NewPayment = typeof payment.$inferInsert;

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id")
      .references(() => payment.id, { onDelete: "cascade" })
      .notNull(),
    pledgeId: integer("pledge_id")
      .references(() => pledge.id, { onDelete: "cascade" })
      .notNull(),
    installmentScheduleId: integer("installment_schedule_id").references(
      () => installmentSchedule.id,
      { onDelete: "set null" }
    ),

    // Third-party tracking
    payerContactId: integer("payer_contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),

    allocatedAmount: numeric("allocated_amount", {
      precision: 10,
      scale: 2,
    }).notNull(),
    currency: currencyEnum("currency").notNull(),
    allocatedAmountUsd: numeric("allocated_amount_usd", {
      precision: 10,
      scale: 2,
    }),
    allocatedAmountInPledgeCurrency: numeric("allocated_amount_in_pledge_currency", {
      precision: 10,
      scale: 2,
    }),
    receiptNumber: text("receipt_number"),
    receiptType: receiptTypeEnum("receipt_type"),
    receiptIssued: boolean("receipt_issued").default(false).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    paymentIdIdx: index("payment_allocations_payment_id_idx").on(table.paymentId),
    pledgeIdIdx: index("payment_allocations_pledge_id_idx").on(table.pledgeId),
    payerContactIdIdx: index("payment_allocations_payer_contact_id_idx").on(table.payerContactId),
    installmentScheduleIdIdx: index("payment_allocations_installment_schedule_id_idx").on(table.installmentScheduleId),
    uniqueAllocation: uniqueIndex("payment_allocations_unique").on(
      table.paymentId,
      table.pledgeId,
      table.installmentScheduleId
    ),
  })
);

export type PaymentAllocation = typeof paymentAllocations.$inferSelect;
export type NewPaymentAllocation = typeof paymentAllocations.$inferInsert;

export const currencyConversionLog = pgTable(
  "currency_conversion_log",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id")
      .references(() => payment.id, { onDelete: "cascade" })
      .notNull(),
    fromCurrency: currencyEnum("from_currency").notNull(),
    toCurrency: currencyEnum("to_currency").notNull(),
    fromAmount: numeric("from_amount", { precision: 10, scale: 2 }).notNull(),
    toAmount: numeric("to_amount", { precision: 10, scale: 2 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 10, scale: 4 }).notNull(),
    conversionDate: date("conversion_date").notNull(),
    conversionType: text("conversion_type").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    paymentIdIdx: index("currency_conversion_log_payment_id_idx").on(table.paymentId),
    dateIdx: index("currency_conversion_log_date_idx").on(table.conversionDate),
    typeIdx: index("currency_conversion_log_type_idx").on(table.conversionType),
  })
);

export type CurrencyConversionLog = typeof currencyConversionLog.$inferSelect;
export type NewCurrencyConversionLog = typeof currencyConversionLog.$inferInsert;

export const bonusCalculation = pgTable(
  "bonus_calculation",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id")
      .references(() => payment.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    solicitorId: integer("solicitor_id")
      .references(() => solicitor.id, { onDelete: "cascade" })
      .notNull(),
    bonusRuleId: integer("bonus_rule_id").references(() => bonusRule.id, {
      onDelete: "set null",
    }),
    paymentAmount: numeric("payment_amount", {
      precision: 10,
      scale: 2,
    }).notNull(),
    bonusPercentage: numeric("bonus_percentage", {
      precision: 5,
      scale: 2,
    }).notNull(),
    bonusAmount: numeric("bonus_amount", { precision: 10, scale: 2 }).notNull(),
    calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
    isPaid: boolean("is_paid").default(false).notNull(),
    paidAt: timestamp("paid_at"),
    notes: text("notes"),
  },
  (table) => ({
    paymentIdIdx: index("bonus_calculation_payment_id_idx").on(table.paymentId),
    solicitorIdIdx: index("bonus_calculation_solicitor_id_idx").on(
      table.solicitorId
    ),
    calculatedAtIdx: index("bonus_calculation_calculated_at_idx").on(
      table.calculatedAt
    ),
    isPaidIdx: index("bonus_calculation_is_paid_idx").on(table.isPaid),
  })
);

export type BonusCalculation = typeof bonusCalculation.$inferSelect;
export type NewBonusCalculation = typeof bonusCalculation.$inferInsert;

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  userEmail: text("user_email").notNull(),
  action: text("action").notNull(),
  details: text("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

// *** RELATIONS ***

export const contactRelations = relations(contact, ({ many }) => ({
  contactRoles: many(contactRoles),
  studentRoles: many(studentRoles),
  relationshipsAsSource: many(relationships, {
    relationName: "relationSource",
  }),
  relationshipsAsTarget: many(relationships, {
    relationName: "relationTarget",
  }),
  pledges: many(pledge),
  solicitor: many(solicitor),
  paymentsAsPayer: many(payment, {
    relationName: "payerPayments",
  }),
}));

export const contactRolesRelations = relations(contactRoles, ({ one }) => ({
  contact: one(contact, {
    fields: [contactRoles.contactId],
    references: [contact.id],
  }),
}));

export const studentRolesRelations = relations(studentRoles, ({ one }) => ({
  contact: one(contact, {
    fields: [studentRoles.contactId],
    references: [contact.id],
  }),
}));

export const relationshipsRelations = relations(relationships, ({ one, many }) => ({
  contact: one(contact, {
    fields: [relationships.contactId],
    references: [contact.id],
    relationName: "relationSource",
  }),
  relatedContact: one(contact, {
    fields: [relationships.relatedContactId],
    references: [contact.id],
    relationName: "relationTarget",
  }),
  pledges: many(pledge),
  payments: many(payment),
  paymentPlans: many(paymentPlan),
}));

export const categoryGroupRelations = relations(categoryGroup, ({ one }) => ({
  category: one(category, {
    fields: [categoryGroup.categoryId],
    references: [category.id],
  }),
  categoryItem: one(categoryItem, {
    fields: [categoryGroup.categoryItemId],
    references: [categoryItem.id],
  }),
}));

export const categoryRelations = relations(category, ({ many }) => ({
  pledges: many(pledge),
  categoryItems: many(categoryItem),
  categoryGroups: many(categoryGroup),
}));

export const categoryItemRelations = relations(categoryItem, ({ one, many }) => ({
  category: one(category, {
    fields: [categoryItem.categoryId],
    references: [category.id],
  }),
  categoryGroups: many(categoryGroup),
}));

export const tagRelations = relations(tag, ({ many }) => ({
  paymentTags: many(paymentTags),
  pledgeTags: many(pledgeTags),
}));

export const paymentTagsRelations = relations(paymentTags, ({ one }) => ({
  payment: one(payment, {
    fields: [paymentTags.paymentId],
    references: [payment.id],
  }),
  tag: one(tag, {
    fields: [paymentTags.tagId],
    references: [tag.id],
  }),
}));

export const pledgeTagsRelations = relations(pledgeTags, ({ one }) => ({
  pledge: one(pledge, {
    fields: [pledgeTags.pledgeId],
    references: [pledge.id],
  }),
  tag: one(tag, {
    fields: [pledgeTags.tagId],
    references: [tag.id],
  }),
}));

export const pledgeRelations = relations(pledge, ({ one, many }) => ({
  contact: one(contact, {
    fields: [pledge.contactId],
    references: [contact.id],
  }),
  category: one(category, {
    fields: [pledge.categoryId],
    references: [category.id],
  }),
  relationship: one(relationships, {
    fields: [pledge.relationshipId],
    references: [relationships.id],
  }),
  paymentPlans: many(paymentPlan),
  payments: many(payment),
  paymentAllocations: many(paymentAllocations),
  pledgeTags: many(pledgeTags),
}));

export const paymentPlanRelations = relations(paymentPlan, ({ one, many }) => ({
  pledge: one(pledge, {
    fields: [paymentPlan.pledgeId],
    references: [pledge.id],
  }),
  relationship: one(relationships, {
    fields: [paymentPlan.relationshipId],
    references: [relationships.id],
  }),
  payments: many(payment),
  installmentSchedules: many(installmentSchedule),
}));

export const installmentScheduleRelations = relations(
  installmentSchedule,
  ({ one, many }) => ({
    paymentPlan: one(paymentPlan, {
      fields: [installmentSchedule.paymentPlanId],
      references: [paymentPlan.id],
    }),
    payment: one(payment, {
      fields: [installmentSchedule.paymentId],
      references: [payment.id],
    }),
    paymentAllocations: many(paymentAllocations),
  })
);

export const paymentRelations = relations(payment, ({ one, many }) => ({
  pledge: one(pledge, {
    fields: [payment.pledgeId],
    references: [pledge.id],
  }),
  paymentPlan: one(paymentPlan, {
    fields: [payment.paymentPlanId],
    references: [paymentPlan.id],
  }),
  installmentSchedule: one(installmentSchedule, {
    fields: [payment.installmentScheduleId],
    references: [installmentSchedule.id],
  }),
  relationship: one(relationships, {
    fields: [payment.relationshipId],
    references: [relationships.id],
  }),
  payerContact: one(contact, {
    fields: [payment.payerContactId],
    references: [contact.id],
    relationName: "payerPayments",
  }),
  solicitor: one(solicitor, {
    fields: [payment.solicitorId],
    references: [solicitor.id],
  }),
  bonusRule: one(bonusRule, {
    fields: [payment.bonusRuleId],
    references: [bonusRule.id],
  }),
  bonusCalculation: one(bonusCalculation, {
    fields: [payment.id],
    references: [bonusCalculation.paymentId],
  }),
  paymentAllocations: many(paymentAllocations),
  currencyConversions: many(currencyConversionLog),
  paymentTags: many(paymentTags),
}));

export const solicitorRelations = relations(solicitor, ({ one, many }) => ({
  contact: one(contact, {
    fields: [solicitor.contactId],
    references: [contact.id],
  }),
  bonusRules: many(bonusRule),
  bonusCalculations: many(bonusCalculation),
  payments: many(payment),
}));

export const bonusRuleRelations = relations(bonusRule, ({ one, many }) => ({
  solicitor: one(solicitor, {
    fields: [bonusRule.solicitorId],
    references: [solicitor.id],
  }),
  bonusCalculations: many(bonusCalculation),
  payments: many(payment),
}));

export const bonusCalculationRelations = relations(
  bonusCalculation,
  ({ one }) => ({
    payment: one(payment, {
      fields: [bonusCalculation.paymentId],
      references: [payment.id],
    }),
    solicitor: one(solicitor, {
      fields: [bonusCalculation.solicitorId],
      references: [solicitor.id],
    }),
    bonusRule: one(bonusRule, {
      fields: [bonusCalculation.bonusRuleId],
      references: [bonusRule.id],
    }),
  })
);

export const paymentAllocationsRelations = relations(
  paymentAllocations,
  ({ one }) => ({
    payment: one(payment, {
      fields: [paymentAllocations.paymentId],
      references: [payment.id],
    }),
    pledge: one(pledge, {
      fields: [paymentAllocations.pledgeId],
      references: [pledge.id],
    }),
    installmentSchedule: one(installmentSchedule, {
      fields: [paymentAllocations.installmentScheduleId],
      references: [installmentSchedule.id],
    }),
  })
);

export const currencyConversionLogRelations = relations(
  currencyConversionLog,
  ({ one }) => ({
    payment: one(payment, {
      fields: [currencyConversionLog.paymentId],
      references: [payment.id],
    }),
  })
);

export const exchangeRateRelations = relations(exchangeRate, ({ }) => ({}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(user, {
    fields: [auditLog.userId],
    references: [user.id],
  }),
}));

export const userRelations = relations(user, ({ many }) => ({
  auditLogs: many(auditLog),
  createdCampaigns: many(campaign, { relationName: "createdBy" }),
  updatedCampaigns: many(campaign, { relationName: "updatedBy" }),
}));

export const campaignRelations = relations(campaign, ({ one }) => ({
  createdBy: one(user, {
    fields: [campaign.createdBy],
    references: [user.id],
    relationName: "createdBy",
  }),
  updatedBy: one(user, {
    fields: [campaign.updatedBy],
    references: [user.id],
    relationName: "updatedBy",
  }),
}));
