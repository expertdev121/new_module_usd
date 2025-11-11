import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  payment,
  pledge,
  contact,
  paymentPlan,
  solicitor,
  category,
  bonusRule,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');

    const baseQuery = db
      .select({
        id: payment.id,
        amount: payment.amount,
        amountUsd: payment.amountUsd,
        currency: payment.currency,
        paymentDate: payment.paymentDate,
        receivedDate: payment.receivedDate,
        paymentMethod: payment.paymentMethod,
        methodDetail: payment.methodDetail,
        paymentStatus: payment.paymentStatus,
        referenceNumber: payment.referenceNumber,
        checkNumber: payment.checkNumber,
        receiptNumber: payment.receiptNumber,
        receiptType: payment.receiptType,
        receiptIssued: payment.receiptIssued,
        pledgeId: pledge.id,
        pledgeDescription: pledge.description,
        pledgeOriginalAmount: pledge.originalAmount,
        pledgeCurrency: pledge.currency,
        pledgeBalance: pledge.balance,
        contactId: contact.id,
        contactFirstName: contact.firstName,
        contactLastName: contact.lastName,
        contactEmail: contact.email,
        contactPhone: contact.phone,

        // Category details
        categoryId: category.id,
        categoryName: category.name,

        // Payment Plan details
        paymentPlanId: paymentPlan.id,
        planName: paymentPlan.planName,
        planFrequency: paymentPlan.frequency,
        planStatus: paymentPlan.planStatus,

        // Solicitor details
        solicitorId: solicitor.id,
        solicitorCode: solicitor.solicitorCode,
        solicitorStatus: solicitor.status,
        bonusPercentage: payment.bonusPercentage,
        bonusAmount: payment.bonusAmount,

        // Bonus Rule details
        bonusRuleId: bonusRule.id,
        bonusRuleName: bonusRule.ruleName,
        bonusRulePaymentType: bonusRule.paymentType,
      })
      .from(payment)
      .leftJoin(pledge, eq(payment.pledgeId, pledge.id))
      .leftJoin(contact, eq(pledge.contactId, contact.id))
      .leftJoin(category, eq(pledge.categoryId, category.id))
      .leftJoin(paymentPlan, eq(payment.paymentPlanId, paymentPlan.id))
      .leftJoin(solicitor, eq(payment.solicitorId, solicitor.id))
      .leftJoin(bonusRule, eq(payment.bonusRuleId, bonusRule.id));

    const paymentsWithDetails = locationId
      ? await db
          .select({
            id: payment.id,
            amount: payment.amount,
            amountUsd: payment.amountUsd,
            currency: payment.currency,
            paymentDate: payment.paymentDate,
            receivedDate: payment.receivedDate,
            paymentMethod: payment.paymentMethod,
            methodDetail: payment.methodDetail,
            paymentStatus: payment.paymentStatus,
            referenceNumber: payment.referenceNumber,
            checkNumber: payment.checkNumber,
            receiptNumber: payment.receiptNumber,
            receiptType: payment.receiptType,
            receiptIssued: payment.receiptIssued,
            pledgeId: pledge.id,
            pledgeDescription: pledge.description,
            pledgeOriginalAmount: pledge.originalAmount,
            pledgeCurrency: pledge.currency,
            pledgeBalance: pledge.balance,
            contactId: contact.id,
            contactFirstName: contact.firstName,
            contactLastName: contact.lastName,
            contactEmail: contact.email,
            contactPhone: contact.phone,

            // Category details
            categoryId: category.id,
            categoryName: category.name,

            // Payment Plan details
            paymentPlanId: paymentPlan.id,
            planName: paymentPlan.planName,
            planFrequency: paymentPlan.frequency,
            planStatus: paymentPlan.planStatus,

            // Solicitor details
            solicitorId: solicitor.id,
            solicitorCode: solicitor.solicitorCode,
            solicitorStatus: solicitor.status,
            bonusPercentage: payment.bonusPercentage,
            bonusAmount: payment.bonusAmount,

            // Bonus Rule details
            bonusRuleId: bonusRule.id,
            bonusRuleName: bonusRule.ruleName,
            bonusRulePaymentType: bonusRule.paymentType,
          })
          .from(payment)
          .leftJoin(pledge, eq(payment.pledgeId, pledge.id))
          .leftJoin(contact, eq(pledge.contactId, contact.id))
          .leftJoin(category, eq(pledge.categoryId, category.id))
          .leftJoin(paymentPlan, eq(payment.paymentPlanId, paymentPlan.id))
          .leftJoin(solicitor, eq(payment.solicitorId, solicitor.id))
          .leftJoin(bonusRule, eq(payment.bonusRuleId, bonusRule.id))
          .where(eq(payment.account, locationId))
      : await db
          .select({
            id: payment.id,
            amount: payment.amount,
            amountUsd: payment.amountUsd,
            currency: payment.currency,
            paymentDate: payment.paymentDate,
            receivedDate: payment.receivedDate,
            paymentMethod: payment.paymentMethod,
            methodDetail: payment.methodDetail,
            paymentStatus: payment.paymentStatus,
            referenceNumber: payment.referenceNumber,
            checkNumber: payment.checkNumber,
            receiptNumber: payment.receiptNumber,
            receiptType: payment.receiptType,
            receiptIssued: payment.receiptIssued,
            pledgeId: pledge.id,
            pledgeDescription: pledge.description,
            pledgeOriginalAmount: pledge.originalAmount,
            pledgeCurrency: pledge.currency,
            pledgeBalance: pledge.balance,
            contactId: contact.id,
            contactFirstName: contact.firstName,
            contactLastName: contact.lastName,
            contactEmail: contact.email,
            contactPhone: contact.phone,

            // Category details
            categoryId: category.id,
            categoryName: category.name,

            // Payment Plan details
            paymentPlanId: paymentPlan.id,
            planName: paymentPlan.planName,
            planFrequency: paymentPlan.frequency,
            planStatus: paymentPlan.planStatus,

            // Solicitor details
            solicitorId: solicitor.id,
            solicitorCode: solicitor.solicitorCode,
            solicitorStatus: solicitor.status,
            bonusPercentage: payment.bonusPercentage,
            bonusAmount: payment.bonusAmount,

            // Bonus Rule details
            bonusRuleId: bonusRule.id,
            bonusRuleName: bonusRule.ruleName,
            bonusRulePaymentType: bonusRule.paymentType,
          })
          .from(payment)
          .leftJoin(pledge, eq(payment.pledgeId, pledge.id))
          .leftJoin(contact, eq(pledge.contactId, contact.id))
          .leftJoin(category, eq(pledge.categoryId, category.id))
          .leftJoin(paymentPlan, eq(payment.paymentPlanId, paymentPlan.id))
          .leftJoin(solicitor, eq(payment.solicitorId, solicitor.id))
          .leftJoin(bonusRule, eq(payment.bonusRuleId, bonusRule.id));

    return NextResponse.json(paymentsWithDetails);
  } catch (error) {
    console.error("Error fetching payments with details:", error);
    return NextResponse.json(
      { error: "Failed to fetch payments with details" },
      { status: 500 }
    );
  }
}
