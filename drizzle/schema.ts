import { pgTable, foreignKey, serial, text, integer, timestamp, index, numeric, date, boolean, unique, uniqueIndex, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const bonusPaymentType = pgEnum("bonus_payment_type", ['tuition', 'donation', 'both'])
export const campaignStatus = pgEnum("campaign_status", ['active', 'inactive', 'completed'])
export const currency = pgEnum("currency", ['USD', 'ILS', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'ZAR'])
export const distributionType = pgEnum("distribution_type", ['fixed', 'custom'])
export const frequency = pgEnum("frequency", ['weekly', 'monthly', 'quarterly', 'biannual', 'annual', 'one_time', 'custom'])
export const gender = pgEnum("gender", ['male', 'female'])
export const installmentStatus = pgEnum("installment_status", ['pending', 'paid', 'overdue', 'cancelled'])
export const machzor = pgEnum("machzor", ['10.5', '10', '9.5', '9', '8.5', '8'])
export const paymentStatus = pgEnum("payment_status", ['pending', 'completed', 'failed', 'cancelled', 'refunded', 'processing', 'expected'])
export const planStatus = pgEnum("plan_status", ['active', 'completed', 'cancelled', 'paused', 'overdue'])
export const program = pgEnum("program", ['LH', 'LLC', 'ML', 'Kollel', 'Madrich'])
export const receiptType = pgEnum("receipt_type", ['invoice', 'confirmation', 'receipt', 'other'])
export const relationship = pgEnum("relationship", ['mother', 'father', 'grandmother', 'grandchild', 'grandfather', 'grandparent', 'parent', 'step-parent', 'stepmother', 'stepfather', 'sister', 'brother', 'step-sister', 'step-brother', 'stepson', 'daughter', 'son', 'aunt', 'uncle', 'aunt/uncle', 'nephew', 'niece', 'grandson', 'granddaughter', 'cousin (m)', 'cousin (f)', 'spouse', 'partner', 'wife', 'husband', 'former husband', 'former wife', 'fiance', 'divorced co-parent', 'separated co-parent', 'legal guardian', 'legal guardian partner', 'friend', 'neighbor', 'relative', 'business', 'owner', 'chevrusa', 'congregant', 'rabbi', 'contact', 'foundation', 'donor', 'fund', 'rebbi contact', 'rebbi contact for', 'employee', 'employer', 'machatunim', 'His Sister', 'Her Sister', 'Her Brother', 'His Brother', 'His Aunt', 'Her Aunt', 'His Uncle', 'Her Uncle', 'His Parents', 'Her Parents', 'Her Mother', 'His Mother', 'His Father', 'Her Nephew', 'His Nephew', 'His Niece', 'Her Niece', 'His Grandparents', 'Her Grandparents', 'Her Father', 'Their Daughter', 'Their Son', 'His Daughter', 'His Son', 'Her Daughter', 'Her Son', 'His Cousin (M)', 'Her Grandfather', 'Her Grandmother', 'His Grandfather', 'His Grandmother', 'His Wife', 'Her Husband', 'Her Former Husband', 'His Former Wife', 'His Cousin (F)', 'Her Cousin (M)', 'Her Cousin (F)', 'Partner', 'Friend', 'Neighbor', 'Relative', 'Business', 'Chevrusa', 'Congregant', 'Contact', 'Donor', 'Fiance', 'Foundation', 'Fund', 'Her Step Son', 'His Step Mother', 'Owner', 'Rabbi', 'Their Granddaughter', 'Their Grandson', 'Employee', 'Employer'])
export const role = pgEnum("role", ['admin', 'user', 'super_admin'])
export const solicitorStatus = pgEnum("solicitor_status", ['active', 'inactive', 'suspended'])
export const status = pgEnum("status", ['Student', 'Active Soldier', 'Staff', 'Withdrew', 'Transferred Out', 'Left Early', 'Asked to Leave'])
export const title = pgEnum("title", ['mr', 'mrs', 'ms', 'dr', 'prof', 'eng', 'other', 'rabbi'])
export const track = pgEnum("track", ['Alef', 'Bet', 'Gimmel', 'Dalet', 'Heh', 'March Draft', 'August Draft', 'Room & Board', 'Other Draft'])
export const trackDetail = pgEnum("track_detail", ['Full Year', 'Fall', 'Spring', 'Until Pesach'])
export const userStatus = pgEnum("user_status", ['active', 'suspended'])


export const auditLog = pgTable("audit_log", {
	id: serial().primaryKey().notNull(),
	action: text().notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: integer("user_id"),
	userEmail: text("user_email").notNull(),
	details: text(),
	timestamp: timestamp({ mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "audit_log_user_id_user_id_fk"
		}).onDelete("set null"),
]);

export const contact = pgTable("contact", {
	id: serial().primaryKey().notNull(),
	firstName: text("first_name").notNull(),
	lastName: text("last_name").notNull(),
	email: text(),
	phone: text(),
	title: text(),
	gender: gender(),
	address: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	displayName: text("display_name"),
	ghlContactId: text("ghl_contact_id"),
	locationId: text("location_id"),
});

export const payment = pgTable("payment", {
	id: serial().primaryKey().notNull(),
	pledgeId: integer("pledge_id"),
	paymentPlanId: integer("payment_plan_id"),
	installmentScheduleId: integer("installment_schedule_id"),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: currency().notNull(),
	amountUsd: numeric("amount_usd", { precision: 10, scale:  2 }),
	amountInPledgeCurrency: numeric("amount_in_pledge_currency", { precision: 10, scale:  2 }),
	exchangeRate: numeric("exchange_rate", { precision: 10, scale:  4 }),
	paymentDate: date("payment_date").notNull(),
	receivedDate: date("received_date"),
	paymentMethod: text("payment_method"),
	methodDetail: text("method_detail"),
	paymentStatus: paymentStatus("payment_status").default('completed').notNull(),
	referenceNumber: text("reference_number"),
	checkNumber: text("check_number"),
	receiptNumber: text("receipt_number"),
	receiptType: receiptType("receipt_type"),
	receiptIssued: boolean("receipt_issued").default(false).notNull(),
	solicitorId: integer("solicitor_id"),
	bonusPercentage: numeric("bonus_percentage", { precision: 5, scale:  2 }),
	bonusAmount: numeric("bonus_amount", { precision: 10, scale:  2 }),
	bonusRuleId: integer("bonus_rule_id"),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	checkDate: date("check_date"),
	account: text(),
	relationshipId: integer("relationship_id"),
	payerContactId: integer("payer_contact_id"),
	isThirdPartyPayment: boolean("is_third_party_payment").default(false).notNull(),
	pledgeCurrencyExchangeRate: numeric("pledge_currency_exchange_rate", { precision: 10, scale:  4 }),
	amountInPlanCurrency: numeric("amount_in_plan_currency", { precision: 10, scale:  2 }),
	planCurrencyExchangeRate: numeric("plan_currency_exchange_rate", { precision: 10, scale:  4 }),
}, (table) => [
	index("payment_currency_idx").using("btree", table.currency.asc().nullsLast().op("enum_ops")),
	index("payment_installment_schedule_id_idx").using("btree", table.installmentScheduleId.asc().nullsLast().op("int4_ops")),
	index("payment_is_third_party_idx").using("btree", table.isThirdPartyPayment.asc().nullsLast().op("bool_ops")),
	index("payment_payer_contact_id_idx").using("btree", table.payerContactId.asc().nullsLast().op("int4_ops")),
	index("payment_payment_date_idx").using("btree", table.paymentDate.asc().nullsLast().op("date_ops")),
	index("payment_payment_plan_id_idx").using("btree", table.paymentPlanId.asc().nullsLast().op("int4_ops")),
	index("payment_pledge_id_idx").using("btree", table.pledgeId.asc().nullsLast().op("int4_ops")),
	index("payment_reference_idx").using("btree", table.referenceNumber.asc().nullsLast().op("text_ops")),
	index("payment_relationship_id_idx").using("btree", table.relationshipId.asc().nullsLast().op("int4_ops")),
	index("payment_solicitor_id_idx").using("btree", table.solicitorId.asc().nullsLast().op("int4_ops")),
	index("payment_status_idx").using("btree", table.paymentStatus.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.paymentPlanId],
			foreignColumns: [paymentPlan.id],
			name: "payment_payment_plan_id_payment_plan_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.installmentScheduleId],
			foreignColumns: [installmentSchedule.id],
			name: "payment_installment_schedule_id_installment_schedule_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.solicitorId],
			foreignColumns: [solicitor.id],
			name: "payment_solicitor_id_solicitor_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.bonusRuleId],
			foreignColumns: [bonusRule.id],
			name: "payment_bonus_rule_id_bonus_rule_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.pledgeId],
			foreignColumns: [pledge.id],
			name: "payment_pledge_id_pledge_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.relationshipId],
			foreignColumns: [relationships.id],
			name: "payment_relationship_id_relationships_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.payerContactId],
			foreignColumns: [contact.id],
			name: "payment_payer_contact_id_contact_id_fk"
		}).onDelete("set null"),
]);

export const bonusRule = pgTable("bonus_rule", {
	id: serial().primaryKey().notNull(),
	solicitorId: integer("solicitor_id").notNull(),
	ruleName: text("rule_name").notNull(),
	bonusPercentage: numeric("bonus_percentage", { precision: 5, scale:  2 }).notNull(),
	paymentType: bonusPaymentType("payment_type").default('both').notNull(),
	minAmount: numeric("min_amount", { precision: 10, scale:  2 }),
	maxAmount: numeric("max_amount", { precision: 10, scale:  2 }),
	effectiveFrom: date("effective_from").notNull(),
	effectiveTo: date("effective_to"),
	isActive: boolean("is_active").default(true).notNull(),
	priority: integer().default(1).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("bonus_rule_effective_dates_idx").using("btree", table.effectiveFrom.asc().nullsLast().op("date_ops"), table.effectiveTo.asc().nullsLast().op("date_ops")),
	index("bonus_rule_priority_idx").using("btree", table.priority.asc().nullsLast().op("int4_ops")),
	index("bonus_rule_solicitor_id_idx").using("btree", table.solicitorId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.solicitorId],
			foreignColumns: [solicitor.id],
			name: "bonus_rule_solicitor_id_solicitor_id_fk"
		}).onDelete("cascade"),
]);

export const installmentSchedule = pgTable("installment_schedule", {
	id: serial().primaryKey().notNull(),
	paymentPlanId: integer("payment_plan_id").notNull(),
	installmentDate: date("installment_date").notNull(),
	installmentAmount: numeric("installment_amount", { precision: 10, scale:  2 }).notNull(),
	currency: currency().notNull(),
	status: installmentStatus().default('pending').notNull(),
	paidDate: date("paid_date"),
	paymentId: integer("payment_id"),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	installmentAmountUsd: numeric("installment_amount_usd", { precision: 10, scale:  2 }),
}, (table) => [
	index("installment_schedule_installment_date_idx").using("btree", table.installmentDate.asc().nullsLast().op("date_ops")),
	index("installment_schedule_payment_id_idx").using("btree", table.paymentId.asc().nullsLast().op("int4_ops")),
	index("installment_schedule_payment_plan_id_idx").using("btree", table.paymentPlanId.asc().nullsLast().op("int4_ops")),
	index("installment_schedule_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.paymentPlanId],
			foreignColumns: [paymentPlan.id],
			name: "installment_schedule_payment_plan_id_payment_plan_id_fk"
		}).onDelete("cascade"),
]);

export const paymentPlan = pgTable("payment_plan", {
	id: serial().primaryKey().notNull(),
	pledgeId: integer("pledge_id").notNull(),
	planName: text("plan_name"),
	frequency: frequency().notNull(),
	distributionType: distributionType("distribution_type").default('fixed').notNull(),
	totalPlannedAmount: numeric("total_planned_amount", { precision: 10, scale:  2 }).notNull(),
	currency: currency().notNull(),
	installmentAmount: numeric("installment_amount", { precision: 10, scale:  2 }).notNull(),
	numberOfInstallments: integer("number_of_installments").notNull(),
	exchangeRate: numeric("exchange_rate", { precision: 10, scale:  2 }),
	startDate: date("start_date").notNull(),
	endDate: date("end_date"),
	nextPaymentDate: date("next_payment_date"),
	installmentsPaid: integer("installments_paid").default(0).notNull(),
	totalPaid: numeric("total_paid", { precision: 10, scale:  2 }).default('0').notNull(),
	totalPaidUsd: numeric("total_paid_usd", { precision: 10, scale:  2 }),
	remainingAmount: numeric("remaining_amount", { precision: 10, scale:  2 }).notNull(),
	planStatus: planStatus("plan_status").default('active').notNull(),
	autoRenew: boolean("auto_renew").default(false).notNull(),
	remindersSent: integer("reminders_sent").default(0).notNull(),
	lastReminderDate: date("last_reminder_date"),
	isActive: boolean("is_active").default(true).notNull(),
	notes: text(),
	internalNotes: text("internal_notes"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	relationshipId: integer("relationship_id"),
	totalPlannedAmountUsd: numeric("total_planned_amount_usd", { precision: 10, scale:  2 }),
	installmentAmountUsd: numeric("installment_amount_usd", { precision: 10, scale:  2 }),
	remainingAmountUsd: numeric("remaining_amount_usd", { precision: 10, scale:  2 }),
	currencyPriority: integer("currency_priority").default(1).notNull(),
}, (table) => [
	index("payment_plan_currency_idx").using("btree", table.currency.asc().nullsLast().op("enum_ops")),
	index("payment_plan_currency_priority_idx").using("btree", table.pledgeId.asc().nullsLast().op("int4_ops"), table.currencyPriority.asc().nullsLast().op("int4_ops")),
	index("payment_plan_next_payment_idx").using("btree", table.nextPaymentDate.asc().nullsLast().op("date_ops")),
	index("payment_plan_pledge_id_idx").using("btree", table.pledgeId.asc().nullsLast().op("int4_ops")),
	index("payment_plan_relationship_id_idx").using("btree", table.relationshipId.asc().nullsLast().op("int4_ops")),
	index("payment_plan_status_idx").using("btree", table.planStatus.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.pledgeId],
			foreignColumns: [pledge.id],
			name: "payment_plan_pledge_id_pledge_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.relationshipId],
			foreignColumns: [relationships.id],
			name: "payment_plan_relationship_id_relationships_id_fk"
		}).onDelete("set null"),
]);

export const contactRoles = pgTable("contact_roles", {
	id: serial().primaryKey().notNull(),
	contactId: integer("contact_id").notNull(),
	roleName: text("role_name").notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	startDate: date("start_date"),
	endDate: date("end_date"),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	locationId: text("location_id"),
}, (table) => [
	index("contact_roles_contact_id_idx").using("btree", table.contactId.asc().nullsLast().op("int4_ops")),
	index("contact_roles_role_name_idx").using("btree", table.roleName.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contact.id],
			name: "contact_roles_contact_id_contact_id_fk"
		}).onDelete("cascade"),
]);

export const category = pgTable("category", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	locationId: text("location_id"),
});

export const bonusCalculation = pgTable("bonus_calculation", {
	id: serial().primaryKey().notNull(),
	paymentId: integer("payment_id").notNull(),
	solicitorId: integer("solicitor_id").notNull(),
	bonusRuleId: integer("bonus_rule_id"),
	paymentAmount: numeric("payment_amount", { precision: 10, scale:  2 }).notNull(),
	bonusPercentage: numeric("bonus_percentage", { precision: 5, scale:  2 }).notNull(),
	bonusAmount: numeric("bonus_amount", { precision: 10, scale:  2 }).notNull(),
	calculatedAt: timestamp("calculated_at", { mode: 'string' }).defaultNow().notNull(),
	isPaid: boolean("is_paid").default(false).notNull(),
	paidAt: timestamp("paid_at", { mode: 'string' }),
	notes: text(),
}, (table) => [
	index("bonus_calculation_calculated_at_idx").using("btree", table.calculatedAt.asc().nullsLast().op("timestamp_ops")),
	index("bonus_calculation_is_paid_idx").using("btree", table.isPaid.asc().nullsLast().op("bool_ops")),
	index("bonus_calculation_payment_id_idx").using("btree", table.paymentId.asc().nullsLast().op("int4_ops")),
	index("bonus_calculation_solicitor_id_idx").using("btree", table.solicitorId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [payment.id],
			name: "bonus_calculation_payment_id_payment_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.solicitorId],
			foreignColumns: [solicitor.id],
			name: "bonus_calculation_solicitor_id_solicitor_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.bonusRuleId],
			foreignColumns: [bonusRule.id],
			name: "bonus_calculation_bonus_rule_id_bonus_rule_id_fk"
		}).onDelete("set null"),
	unique("bonus_calculation_payment_id_unique").on(table.paymentId),
]);

export const solicitor = pgTable("solicitor", {
	id: serial().primaryKey().notNull(),
	contactId: integer("contact_id").notNull(),
	solicitorCode: text("solicitor_code"),
	status: solicitorStatus().default('active').notNull(),
	commissionRate: numeric("commission_rate", { precision: 5, scale:  2 }),
	hireDate: date("hire_date"),
	terminationDate: date("termination_date"),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	locationId: text("location_id"),
}, (table) => [
	index("solicitor_code_idx").using("btree", table.solicitorCode.asc().nullsLast().op("text_ops")),
	index("solicitor_contact_id_idx").using("btree", table.contactId.asc().nullsLast().op("int4_ops")),
	index("solicitor_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contact.id],
			name: "solicitor_contact_id_contact_id_fk"
		}).onDelete("cascade"),
	unique("solicitor_contact_id_unique").on(table.contactId),
	unique("solicitor_solicitor_code_unique").on(table.solicitorCode),
]);

export const relationships = pgTable("relationships", {
	id: serial().primaryKey().notNull(),
	contactId: integer("contact_id").notNull(),
	relatedContactId: integer("related_contact_id").notNull(),
	relationshipType: relationship("relationship_type").notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	locationId: text("location_id"),
}, (table) => [
	index("relationships_contact_id_idx").using("btree", table.contactId.asc().nullsLast().op("int4_ops")),
	index("relationships_related_contact_id_idx").using("btree", table.relatedContactId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("relationships_unique").using("btree", table.contactId.asc().nullsLast().op("enum_ops"), table.relatedContactId.asc().nullsLast().op("int4_ops"), table.relationshipType.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contact.id],
			name: "relationships_contact_id_contact_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.relatedContactId],
			foreignColumns: [contact.id],
			name: "relationships_related_contact_id_contact_id_fk"
		}).onDelete("cascade"),
]);

export const studentRoles = pgTable("student_roles", {
	id: serial().primaryKey().notNull(),
	contactId: integer("contact_id").notNull(),
	year: text().default('2024-2025').notNull(),
	program: program().notNull(),
	track: track().notNull(),
	trackDetail: trackDetail("track_detail"),
	status: status().notNull(),
	machzor: machzor(),
	startDate: date("start_date"),
	endDate: date("end_date"),
	isActive: boolean("is_active").default(true).notNull(),
	additionalNotes: text("additional_notes"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	locationId: text("location_id"),
}, (table) => [
	index("student_roles_contact_id_idx").using("btree", table.contactId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contact.id],
			name: "student_roles_contact_id_contact_id_fk"
		}).onDelete("cascade"),
]);

export const categoryItem = pgTable("category_item", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	categoryId: integer("category_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	occId: integer("occ_id"),
	isActive: boolean("is_active").default(true).notNull(),
	locationId: text("location_id"),
}, (table) => [
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [category.id],
			name: "category_item_category_id_category_id_fk"
		}).onDelete("cascade"),
]);

export const exchangeRate = pgTable("exchange_rate", {
	id: serial().primaryKey().notNull(),
	baseCurrency: currency("base_currency").default('USD').notNull(),
	targetCurrency: currency("target_currency").notNull(),
	rate: numeric({ precision: 18, scale:  6 }).notNull(),
	date: date().notNull(),
	createdAt: date("created_at").defaultNow().notNull(),
	updatedAt: date("updated_at").defaultNow().notNull(),
}, (table) => [
	index("exchange_rate_base_currency_idx").using("btree", table.baseCurrency.asc().nullsLast().op("enum_ops")),
	index("exchange_rate_date_idx").using("btree", table.date.asc().nullsLast().op("date_ops")),
	index("exchange_rate_target_currency_idx").using("btree", table.targetCurrency.asc().nullsLast().op("enum_ops")),
	uniqueIndex("exchange_rate_unique_idx").using("btree", table.baseCurrency.asc().nullsLast().op("date_ops"), table.targetCurrency.asc().nullsLast().op("enum_ops"), table.date.asc().nullsLast().op("enum_ops")),
]);

export const pledge = pgTable("pledge", {
	id: serial().primaryKey().notNull(),
	contactId: integer("contact_id").notNull(),
	categoryId: integer("category_id"),
	pledgeDate: date("pledge_date").notNull(),
	description: text(),
	originalAmount: numeric("original_amount", { precision: 10, scale:  2 }).notNull(),
	currency: currency().default('USD').notNull(),
	totalPaid: numeric("total_paid", { precision: 10, scale:  2 }).default('0').notNull(),
	balance: numeric({ precision: 10, scale:  2 }).notNull(),
	originalAmountUsd: numeric("original_amount_usd", { precision: 10, scale:  2 }),
	totalPaidUsd: numeric("total_paid_usd", { precision: 10, scale:  2 }).default('0'),
	exchangeRate: numeric("exchange_rate", { precision: 10, scale:  2 }),
	balanceUsd: numeric("balance_usd", { precision: 10, scale:  2 }),
	isActive: boolean("is_active").default(true).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	campaignCode: text("campaign_code"),
	relationshipId: integer("relationship_id"),
}, (table) => [
	index("pledge_category_id_idx").using("btree", table.categoryId.asc().nullsLast().op("int4_ops")),
	index("pledge_contact_id_idx").using("btree", table.contactId.asc().nullsLast().op("int4_ops")),
	index("pledge_currency_idx").using("btree", table.currency.asc().nullsLast().op("enum_ops")),
	index("pledge_pledge_date_idx").using("btree", table.pledgeDate.asc().nullsLast().op("date_ops")),
	index("pledge_relationship_id_idx").using("btree", table.relationshipId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contact.id],
			name: "pledge_contact_id_contact_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [category.id],
			name: "pledge_category_id_category_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.relationshipId],
			foreignColumns: [relationships.id],
			name: "pledge_relationship_id_relationships_id_fk"
		}).onDelete("set null"),
]);

export const paymentTags = pgTable("payment_tags", {
	id: serial().primaryKey().notNull(),
	paymentId: integer("payment_id").notNull(),
	tagId: integer("tag_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("payment_tags_payment_id_idx").using("btree", table.paymentId.asc().nullsLast().op("int4_ops")),
	index("payment_tags_tag_id_idx").using("btree", table.tagId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("payment_tags_unique").using("btree", table.paymentId.asc().nullsLast().op("int4_ops"), table.tagId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [payment.id],
			name: "payment_tags_payment_id_payment_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.tagId],
			foreignColumns: [tag.id],
			name: "payment_tags_tag_id_tag_id_fk"
		}).onDelete("cascade"),
]);

export const pledgeTags = pgTable("pledge_tags", {
	id: serial().primaryKey().notNull(),
	pledgeId: integer("pledge_id").notNull(),
	tagId: integer("tag_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("pledge_tags_pledge_id_idx").using("btree", table.pledgeId.asc().nullsLast().op("int4_ops")),
	index("pledge_tags_tag_id_idx").using("btree", table.tagId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("pledge_tags_unique").using("btree", table.pledgeId.asc().nullsLast().op("int4_ops"), table.tagId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.pledgeId],
			foreignColumns: [pledge.id],
			name: "pledge_tags_pledge_id_pledge_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.tagId],
			foreignColumns: [tag.id],
			name: "pledge_tags_tag_id_tag_id_fk"
		}).onDelete("cascade"),
]);

export const paymentAllocations = pgTable("payment_allocations", {
	id: serial().primaryKey().notNull(),
	paymentId: integer("payment_id").notNull(),
	pledgeId: integer("pledge_id").notNull(),
	installmentScheduleId: integer("installment_schedule_id"),
	allocatedAmount: numeric("allocated_amount", { precision: 10, scale:  2 }).notNull(),
	currency: currency().notNull(),
	allocatedAmountUsd: numeric("allocated_amount_usd", { precision: 10, scale:  2 }),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	receiptNumber: text("receipt_number"),
	receiptType: receiptType("receipt_type"),
	receiptIssued: boolean("receipt_issued").default(false).notNull(),
	payerContactId: integer("payer_contact_id"),
	allocatedAmountInPledgeCurrency: numeric("allocated_amount_in_pledge_currency", { precision: 10, scale:  2 }),
}, (table) => [
	index("payment_allocations_installment_schedule_id_idx").using("btree", table.installmentScheduleId.asc().nullsLast().op("int4_ops")),
	index("payment_allocations_payer_contact_id_idx").using("btree", table.payerContactId.asc().nullsLast().op("int4_ops")),
	index("payment_allocations_payment_id_idx").using("btree", table.paymentId.asc().nullsLast().op("int4_ops")),
	index("payment_allocations_pledge_id_idx").using("btree", table.pledgeId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("payment_allocations_unique").using("btree", table.paymentId.asc().nullsLast().op("int4_ops"), table.pledgeId.asc().nullsLast().op("int4_ops"), table.installmentScheduleId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [payment.id],
			name: "payment_allocations_payment_id_payment_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.pledgeId],
			foreignColumns: [pledge.id],
			name: "payment_allocations_pledge_id_pledge_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.payerContactId],
			foreignColumns: [contact.id],
			name: "payment_allocations_payer_contact_id_contact_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.installmentScheduleId],
			foreignColumns: [installmentSchedule.id],
			name: "payment_allocations_installment_schedule_id_installment_schedul"
		}).onDelete("set null"),
]);

export const currencyConversionLog = pgTable("currency_conversion_log", {
	id: serial().primaryKey().notNull(),
	paymentId: integer("payment_id").notNull(),
	fromCurrency: currency("from_currency").notNull(),
	toCurrency: currency("to_currency").notNull(),
	fromAmount: numeric("from_amount", { precision: 10, scale:  2 }).notNull(),
	toAmount: numeric("to_amount", { precision: 10, scale:  2 }).notNull(),
	exchangeRate: numeric("exchange_rate", { precision: 10, scale:  4 }).notNull(),
	conversionDate: date("conversion_date").notNull(),
	conversionType: text("conversion_type").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("currency_conversion_log_date_idx").using("btree", table.conversionDate.asc().nullsLast().op("date_ops")),
	index("currency_conversion_log_payment_id_idx").using("btree", table.paymentId.asc().nullsLast().op("int4_ops")),
	index("currency_conversion_log_type_idx").using("btree", table.conversionType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [payment.id],
			name: "currency_conversion_log_payment_id_payment_id_fk"
		}).onDelete("cascade"),
]);

export const user = pgTable("user", {
	id: serial().primaryKey().notNull(),
	email: text().notNull(),
	passwordHash: text("password_hash").notNull(),
	role: role().default('user').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	status: userStatus().default('active').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	locationId: text("location_id"),
});

export const tag = pgTable("tag", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	showOnPayment: boolean("show_on_payment").default(true).notNull(),
	showOnPledge: boolean("show_on_pledge").default(true).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	locationId: text("location_id"),
});

export const categoryGroup = pgTable("category_group", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	categoryId: integer("category_id").notNull(),
	categoryItemId: integer("category_item_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	locationId: text("location_id"),
}, (table) => [
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [category.id],
			name: "category_group_category_id_category_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.categoryItemId],
			foreignColumns: [categoryItem.id],
			name: "category_group_category_item_id_category_item_id_fk"
		}).onDelete("cascade"),
]);

export const account = pgTable("account", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	locationId: text("location_id"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const paymentMethods = pgTable("payment_methods", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	locationId: text("location_id"),
});

export const paymentMethodDetails = pgTable("payment_method_details", {
	id: serial().primaryKey().notNull(),
	paymentMethodId: integer("payment_method_id").notNull(),
	key: text().notNull(),
	value: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	locationId: text("location_id"),
}, (table) => [
	foreignKey({
			columns: [table.paymentMethodId],
			foreignColumns: [paymentMethods.id],
			name: "payment_method_details_payment_method_id_payment_methods_id_fk"
		}).onDelete("cascade"),
]);

export const campaign = pgTable("campaign", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	status: campaignStatus().default('active').notNull(),
	locationId: text("location_id"),
	createdBy: integer("created_by"),
	updatedBy: integer("updated_by"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "campaign_created_by_user_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [user.id],
			name: "campaign_updated_by_user_id_fk"
		}).onDelete("set null"),
]);

export const manualDonation = pgTable("manual_donation", {
	id: serial().primaryKey().notNull(),
	contactId: integer("contact_id").notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: currency().notNull(),
	amountUsd: numeric("amount_usd", { precision: 10, scale:  2 }),
	exchangeRate: numeric("exchange_rate", { precision: 10, scale:  4 }),
	paymentDate: date("payment_date").notNull(),
	receivedDate: date("received_date"),
	checkDate: date("check_date"),
	accountId: integer("account_id"),
	paymentMethod: text("payment_method"),
	methodDetail: text("method_detail"),
	paymentStatus: paymentStatus("payment_status").default('completed').notNull(),
	referenceNumber: text("reference_number"),
	checkNumber: text("check_number"),
	receiptNumber: text("receipt_number"),
	receiptType: receiptType("receipt_type"),
	receiptIssued: boolean("receipt_issued").default(false).notNull(),
	solicitorId: integer("solicitor_id"),
	bonusPercentage: numeric("bonus_percentage", { precision: 5, scale:  2 }),
	bonusAmount: numeric("bonus_amount", { precision: 10, scale:  2 }),
	bonusRuleId: integer("bonus_rule_id"),
	notes: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	campaignId: integer("campaign_id"),
}, (table) => [
	index("manual_donation_campaign_id_idx").using("btree", table.campaignId.asc().nullsLast().op("int4_ops")),
	index("manual_donation_contact_id_idx").using("btree", table.contactId.asc().nullsLast().op("int4_ops")),
	index("manual_donation_currency_idx").using("btree", table.currency.asc().nullsLast().op("enum_ops")),
	index("manual_donation_payment_date_idx").using("btree", table.paymentDate.asc().nullsLast().op("date_ops")),
	index("manual_donation_reference_idx").using("btree", table.referenceNumber.asc().nullsLast().op("text_ops")),
	index("manual_donation_solicitor_id_idx").using("btree", table.solicitorId.asc().nullsLast().op("int4_ops")),
	index("manual_donation_status_idx").using("btree", table.paymentStatus.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contact.id],
			name: "manual_donation_contact_id_contact_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [account.id],
			name: "manual_donation_account_id_account_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.solicitorId],
			foreignColumns: [solicitor.id],
			name: "manual_donation_solicitor_id_solicitor_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.bonusRuleId],
			foreignColumns: [bonusRule.id],
			name: "manual_donation_bonus_rule_id_bonus_rule_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [campaign.id],
			name: "manual_donation_campaign_id_campaign_id_fk"
		}).onDelete("set null"),
]);
