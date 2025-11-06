import { relations } from "drizzle-orm/relations";
import { user, auditLog, paymentPlan, payment, installmentSchedule, solicitor, bonusRule, pledge, relationships, contact, contactRoles, bonusCalculation, studentRoles, category, categoryItem, paymentTags, tag, pledgeTags, paymentAllocations, currencyConversionLog, categoryGroup, paymentMethods, paymentMethodDetails, campaign, manualDonation, account } from "./schema";

export const auditLogRelations = relations(auditLog, ({one}) => ({
	user: one(user, {
		fields: [auditLog.userId],
		references: [user.id]
	}),
}));

export const userRelations = relations(user, ({many}) => ({
	auditLogs: many(auditLog),
	campaigns_createdBy: many(campaign, {
		relationName: "campaign_createdBy_user_id"
	}),
	campaigns_updatedBy: many(campaign, {
		relationName: "campaign_updatedBy_user_id"
	}),
}));

export const paymentRelations = relations(payment, ({one, many}) => ({
	paymentPlan: one(paymentPlan, {
		fields: [payment.paymentPlanId],
		references: [paymentPlan.id]
	}),
	installmentSchedule: one(installmentSchedule, {
		fields: [payment.installmentScheduleId],
		references: [installmentSchedule.id]
	}),
	solicitor: one(solicitor, {
		fields: [payment.solicitorId],
		references: [solicitor.id]
	}),
	bonusRule: one(bonusRule, {
		fields: [payment.bonusRuleId],
		references: [bonusRule.id]
	}),
	pledge: one(pledge, {
		fields: [payment.pledgeId],
		references: [pledge.id]
	}),
	relationship: one(relationships, {
		fields: [payment.relationshipId],
		references: [relationships.id]
	}),
	contact: one(contact, {
		fields: [payment.payerContactId],
		references: [contact.id]
	}),
	bonusCalculations: many(bonusCalculation),
	paymentTags: many(paymentTags),
	paymentAllocations: many(paymentAllocations),
	currencyConversionLogs: many(currencyConversionLog),
}));

export const paymentPlanRelations = relations(paymentPlan, ({one, many}) => ({
	payments: many(payment),
	installmentSchedules: many(installmentSchedule),
	pledge: one(pledge, {
		fields: [paymentPlan.pledgeId],
		references: [pledge.id]
	}),
	relationship: one(relationships, {
		fields: [paymentPlan.relationshipId],
		references: [relationships.id]
	}),
}));

export const installmentScheduleRelations = relations(installmentSchedule, ({one, many}) => ({
	payments: many(payment),
	paymentPlan: one(paymentPlan, {
		fields: [installmentSchedule.paymentPlanId],
		references: [paymentPlan.id]
	}),
	paymentAllocations: many(paymentAllocations),
}));

export const solicitorRelations = relations(solicitor, ({one, many}) => ({
	payments: many(payment),
	bonusRules: many(bonusRule),
	bonusCalculations: many(bonusCalculation),
	contact: one(contact, {
		fields: [solicitor.contactId],
		references: [contact.id]
	}),
	manualDonations: many(manualDonation),
}));

export const bonusRuleRelations = relations(bonusRule, ({one, many}) => ({
	payments: many(payment),
	solicitor: one(solicitor, {
		fields: [bonusRule.solicitorId],
		references: [solicitor.id]
	}),
	bonusCalculations: many(bonusCalculation),
	manualDonations: many(manualDonation),
}));

export const pledgeRelations = relations(pledge, ({one, many}) => ({
	payments: many(payment),
	paymentPlans: many(paymentPlan),
	contact: one(contact, {
		fields: [pledge.contactId],
		references: [contact.id]
	}),
	category: one(category, {
		fields: [pledge.categoryId],
		references: [category.id]
	}),
	relationship: one(relationships, {
		fields: [pledge.relationshipId],
		references: [relationships.id]
	}),
	pledgeTags: many(pledgeTags),
	paymentAllocations: many(paymentAllocations),
}));

export const relationshipsRelations = relations(relationships, ({one, many}) => ({
	payments: many(payment),
	paymentPlans: many(paymentPlan),
	contact_contactId: one(contact, {
		fields: [relationships.contactId],
		references: [contact.id],
		relationName: "relationships_contactId_contact_id"
	}),
	contact_relatedContactId: one(contact, {
		fields: [relationships.relatedContactId],
		references: [contact.id],
		relationName: "relationships_relatedContactId_contact_id"
	}),
	pledges: many(pledge),
}));

export const contactRelations = relations(contact, ({many}) => ({
	payments: many(payment),
	contactRoles: many(contactRoles),
	solicitors: many(solicitor),
	relationships_contactId: many(relationships, {
		relationName: "relationships_contactId_contact_id"
	}),
	relationships_relatedContactId: many(relationships, {
		relationName: "relationships_relatedContactId_contact_id"
	}),
	studentRoles: many(studentRoles),
	pledges: many(pledge),
	paymentAllocations: many(paymentAllocations),
	manualDonations: many(manualDonation),
}));

export const contactRolesRelations = relations(contactRoles, ({one}) => ({
	contact: one(contact, {
		fields: [contactRoles.contactId],
		references: [contact.id]
	}),
}));

export const bonusCalculationRelations = relations(bonusCalculation, ({one}) => ({
	payment: one(payment, {
		fields: [bonusCalculation.paymentId],
		references: [payment.id]
	}),
	solicitor: one(solicitor, {
		fields: [bonusCalculation.solicitorId],
		references: [solicitor.id]
	}),
	bonusRule: one(bonusRule, {
		fields: [bonusCalculation.bonusRuleId],
		references: [bonusRule.id]
	}),
}));

export const studentRolesRelations = relations(studentRoles, ({one}) => ({
	contact: one(contact, {
		fields: [studentRoles.contactId],
		references: [contact.id]
	}),
}));

export const categoryItemRelations = relations(categoryItem, ({one, many}) => ({
	category: one(category, {
		fields: [categoryItem.categoryId],
		references: [category.id]
	}),
	categoryGroups: many(categoryGroup),
}));

export const categoryRelations = relations(category, ({many}) => ({
	categoryItems: many(categoryItem),
	pledges: many(pledge),
	categoryGroups: many(categoryGroup),
}));

export const paymentTagsRelations = relations(paymentTags, ({one}) => ({
	payment: one(payment, {
		fields: [paymentTags.paymentId],
		references: [payment.id]
	}),
	tag: one(tag, {
		fields: [paymentTags.tagId],
		references: [tag.id]
	}),
}));

export const tagRelations = relations(tag, ({many}) => ({
	paymentTags: many(paymentTags),
	pledgeTags: many(pledgeTags),
}));

export const pledgeTagsRelations = relations(pledgeTags, ({one}) => ({
	pledge: one(pledge, {
		fields: [pledgeTags.pledgeId],
		references: [pledge.id]
	}),
	tag: one(tag, {
		fields: [pledgeTags.tagId],
		references: [tag.id]
	}),
}));

export const paymentAllocationsRelations = relations(paymentAllocations, ({one}) => ({
	payment: one(payment, {
		fields: [paymentAllocations.paymentId],
		references: [payment.id]
	}),
	pledge: one(pledge, {
		fields: [paymentAllocations.pledgeId],
		references: [pledge.id]
	}),
	contact: one(contact, {
		fields: [paymentAllocations.payerContactId],
		references: [contact.id]
	}),
	installmentSchedule: one(installmentSchedule, {
		fields: [paymentAllocations.installmentScheduleId],
		references: [installmentSchedule.id]
	}),
}));

export const currencyConversionLogRelations = relations(currencyConversionLog, ({one}) => ({
	payment: one(payment, {
		fields: [currencyConversionLog.paymentId],
		references: [payment.id]
	}),
}));

export const categoryGroupRelations = relations(categoryGroup, ({one}) => ({
	category: one(category, {
		fields: [categoryGroup.categoryId],
		references: [category.id]
	}),
	categoryItem: one(categoryItem, {
		fields: [categoryGroup.categoryItemId],
		references: [categoryItem.id]
	}),
}));

export const paymentMethodDetailsRelations = relations(paymentMethodDetails, ({one}) => ({
	paymentMethod: one(paymentMethods, {
		fields: [paymentMethodDetails.paymentMethodId],
		references: [paymentMethods.id]
	}),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({many}) => ({
	paymentMethodDetails: many(paymentMethodDetails),
}));

export const campaignRelations = relations(campaign, ({one, many}) => ({
	user_createdBy: one(user, {
		fields: [campaign.createdBy],
		references: [user.id],
		relationName: "campaign_createdBy_user_id"
	}),
	user_updatedBy: one(user, {
		fields: [campaign.updatedBy],
		references: [user.id],
		relationName: "campaign_updatedBy_user_id"
	}),
	manualDonations: many(manualDonation),
}));

export const manualDonationRelations = relations(manualDonation, ({one}) => ({
	contact: one(contact, {
		fields: [manualDonation.contactId],
		references: [contact.id]
	}),
	account: one(account, {
		fields: [manualDonation.accountId],
		references: [account.id]
	}),
	solicitor: one(solicitor, {
		fields: [manualDonation.solicitorId],
		references: [solicitor.id]
	}),
	bonusRule: one(bonusRule, {
		fields: [manualDonation.bonusRuleId],
		references: [bonusRule.id]
	}),
	campaign: one(campaign, {
		fields: [manualDonation.campaignId],
		references: [campaign.id]
	}),
}));

export const accountRelations = relations(account, ({many}) => ({
	manualDonations: many(manualDonation),
}));