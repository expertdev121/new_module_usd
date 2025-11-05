import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql, eq, and, gte, lt, lte, SQL } from "drizzle-orm";
import { contact, pledge, payment, paymentPlan, installmentSchedule, user, manualDonation } from "@/lib/db/schema";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    // Get admin's locationId
    const userResult = await db
      .select({ locationId: user.locationId })
      .from(user)
      .where(eq(user.email, session.user.email))
      .limit(1);

    if (!userResult.length || !userResult[0].locationId) {
      return NextResponse.json({ error: "Admin location not found" }, { status: 400 });
    }

    const adminLocationId = userResult[0].locationId;

    let contactsGrowthPercentage = 0;
    let totalContacts = 0;

    // Total contacts (always for the location, not filtered by date range)
    const totalContactsResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(contact)
      .where(eq(contact.locationId, adminLocationId));
    totalContacts = totalContactsResult[0]?.count || 0;

    if (startDate && endDate) {
      // For custom dates, we can't easily calculate growth percentage, so set to 0
      contactsGrowthPercentage = 0;
    } else {
      // Calculate period in days
      const periodDays = period === "1m" ? 30 : period === "3m" ? 90 : period === "6m" ? 180 : period === "1y" ? 365 : 730; // all = 2 years

      // Total contacts
      const totalContactsResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contact)
        .where(eq(contact.locationId, adminLocationId));
      totalContacts = totalContactsResult[0]?.count || 0;

      // Contacts growth percentage (current period vs previous period)
      const now = new Date();
      const currentPeriodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
      const previousPeriodStart = new Date(now.getTime() - 2 * periodDays * 24 * 60 * 60 * 1000);
      const previousPeriodEnd = currentPeriodStart;

      const currentPeriodContactsResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contact)
        .where(and(
          gte(contact.createdAt, currentPeriodStart),
          eq(contact.locationId, adminLocationId)
        ));
      const currentPeriodContacts = currentPeriodContactsResult[0]?.count || 0;

      const previousPeriodContactsResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contact)
        .where(and(
          gte(contact.createdAt, previousPeriodStart),
          lt(contact.createdAt, previousPeriodEnd),
          eq(contact.locationId, adminLocationId)
        ));
      const previousPeriodContacts = previousPeriodContactsResult[0]?.count || 0;

      contactsGrowthPercentage = previousPeriodContacts > 0
        ? ((currentPeriodContacts - previousPeriodContacts) / previousPeriodContacts) * 100
        : 0;
    }

    let pledgeWhereCondition: SQL<unknown> = sql`1=1`;
    let paymentWhereCondition: SQL<unknown> = eq(payment.paymentStatus, "completed");

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      pledgeWhereCondition = and(
        gte(pledge.pledgeDate, start.toISOString().split('T')[0]),
        lte(pledge.pledgeDate, end.toISOString().split('T')[0])
      ) as SQL<unknown>;
      paymentWhereCondition = and(
        eq(payment.paymentStatus, "completed"),
        gte(payment.paymentDate, start.toISOString().split('T')[0]),
        lte(payment.paymentDate, end.toISOString().split('T')[0])
      )as SQL<unknown>;
    }

    // Total pledges and amount (filter by admin's location)
    const pledgesResult = await db
      .select({
        count: sql<number>`COUNT(*)`,
        totalAmount: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)`,
        avgSize: sql<number>`COALESCE(AVG(${pledge.originalAmountUsd}), 0)`,
      })
      .from(pledge)
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(
        pledgeWhereCondition,
        eq(contact.locationId, adminLocationId)
      ));
    const totalPledges = pledgesResult[0]?.count || 0;
    const totalPledgeAmount = Number(pledgesResult[0]?.totalAmount) || 0;
    const avgPledgeSize = Number(pledgesResult[0]?.avgSize) || 0;

    // Total payments and amount (completed only, filter by admin's location)
    const paymentsResult = await db
      .select({
        count: sql<number>`COUNT(*)`,
        totalAmount: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)`,
        avgSize: sql<number>`COALESCE(AVG(${payment.amountUsd}), 0)`,
      })
      .from(payment)
      .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(
        paymentWhereCondition,
        eq(contact.locationId, adminLocationId)
      ));

    // Total manual donations (filter by admin's location and date range)
    let manualDonationWhereCondition: SQL<unknown> = eq(manualDonation.paymentStatus, "completed");
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      manualDonationWhereCondition = and(
        eq(manualDonation.paymentStatus, "completed"),
        gte(manualDonation.paymentDate, start.toISOString().split('T')[0]),
        lte(manualDonation.paymentDate, end.toISOString().split('T')[0])
      ) as SQL<unknown>;
    }

    const manualDonationsResult = await db
      .select({
        count: sql<number>`COUNT(*)`,
        totalAmount: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)`,
        avgSize: sql<number>`COALESCE(AVG(${manualDonation.amountUsd}), 0)`,
      })
      .from(manualDonation)
      .innerJoin(contact, eq(manualDonation.contactId, contact.id))
      .where(and(
        manualDonationWhereCondition,
        eq(contact.locationId, adminLocationId)
      ));

    const totalPayments = paymentsResult[0]?.count || 0;
    const totalPaymentAmount = Number(paymentsResult[0]?.totalAmount) || 0;
    const totalManualDonations = manualDonationsResult[0]?.count || 0;
    const totalManualDonationAmount = Number(manualDonationsResult[0]?.totalAmount) || 0;
    const totalAllPayments = totalPayments + totalManualDonations;
    const totalAllPaymentAmount = totalPaymentAmount + totalManualDonationAmount;
    const avgPaymentSize = totalAllPayments > 0 ? totalAllPaymentAmount / totalAllPayments : 0;

    // Active plans
    const activePlansResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(paymentPlan)
      .innerJoin(pledge, eq(paymentPlan.pledgeId, pledge.id))
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(
        eq(paymentPlan.planStatus, "active"),
        eq(contact.locationId, adminLocationId)
      ));
    const activePlans = activePlansResult[0]?.count || 0;

    // Scheduled payments (pending installments)
    const scheduledPaymentsResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(installmentSchedule)
      .innerJoin(paymentPlan, eq(installmentSchedule.paymentPlanId, paymentPlan.id))
      .innerJoin(pledge, eq(paymentPlan.pledgeId, pledge.id))
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(
        eq(installmentSchedule.status, "pending"),
        eq(contact.locationId, adminLocationId)
      ));
    const scheduledPayments = scheduledPaymentsResult[0]?.count || 0;

    // Unscheduled payments (completed payments not linked to installments)
    const unscheduledPaymentsResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(payment)
      .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(
        eq(payment.paymentStatus, "completed"),
        sql`${payment.installmentScheduleId} IS NULL`,
        eq(contact.locationId, adminLocationId)
      ));
    const unscheduledPayments = unscheduledPaymentsResult[0]?.count || 0;

    // Third party payments
    const thirdPartyPaymentsResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(payment)
      .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(
        eq(payment.paymentStatus, "completed"),
        eq(payment.isThirdPartyPayment, true),
        eq(contact.locationId, adminLocationId)
      ));
    const thirdPartyPayments = thirdPartyPaymentsResult[0]?.count || 0;

    // Collection rate
    const collectionRate = totalPledgeAmount > 0 ? (totalPaymentAmount / totalPledgeAmount) * 100 : 0;

    return NextResponse.json({
      totalContacts,
      contactsGrowthPercentage: Math.round(contactsGrowthPercentage * 100) / 100,
      totalPledges,
      totalPledgeAmount,
      totalPayments: totalAllPayments,
      totalPaymentAmount: totalAllPaymentAmount,
      totalManualDonations,
      totalManualDonationAmount,
      activePlans,
      scheduledPayments,
      unscheduledPayments,
      thirdPartyPayments,
      collectionRate: Math.round(collectionRate * 100) / 100, // Round to 2 decimals
      avgPledgeSize: Math.round(avgPledgeSize * 100) / 100,
      avgPaymentSize: Math.round(avgPaymentSize * 100) / 100,
    });
  } catch (error) {
    console.error("Error fetching dashboard overview:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard overview" },
      { status: 500 }
    );
  }
}
