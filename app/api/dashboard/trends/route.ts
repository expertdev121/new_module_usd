import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql, eq, and, gte, lt, lte } from "drizzle-orm";
import { pledge, payment, user, contact, manualDonation } from "@/lib/db/schema";
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

    const labels = [];
    const pledgesData = [];
    const paymentsData = [];
    const manualDonationsData = [];

    if (startDate && endDate) {
      // Custom date range - determine granularity based on range length
      const start = new Date(startDate);
      const end = new Date(endDate);
      const rangeInDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

      if (rangeInDays <= 60) {
        // Less than 2 months - show daily data
        const days = [];
        const current = new Date(start);

        while (current <= end) {
          days.push(new Date(current));
          current.setDate(current.getDate() + 1);
        }

        for (const day of days) {
          const dayStart = new Date(day);
          const dayEnd = new Date(day);
          dayEnd.setDate(dayEnd.getDate() + 1);
          const startDateStr = dayStart.toISOString().split('T')[0];
          const endDateStr = dayEnd.toISOString().split('T')[0];
          const dayLabel = dayStart.toLocaleString('en-US', { month: 'short', day: 'numeric' });
          labels.push(dayLabel);

          // Pledges for this day
          const pledgeResult = await db
            .select({ total: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)` })
            .from(pledge)
            .innerJoin(contact, eq(pledge.contactId, contact.id))
            .where(and(
              gte(pledge.pledgeDate, startDateStr),
              lte(pledge.pledgeDate, endDateStr),
              eq(contact.locationId, adminLocationId)
            ));

          // Payments for this day
          const paymentResult = await db
            .select({ total: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)` })
            .from(payment)
            .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
            .innerJoin(contact, eq(pledge.contactId, contact.id))
            .where(and(
              eq(payment.paymentStatus, "completed"),
              gte(payment.paymentDate, startDateStr),
              lte(payment.paymentDate, endDateStr),
              eq(contact.locationId, adminLocationId)
            ));

          // Manual donations for this day
          const manualDonationResult = await db
            .select({ total: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)` })
            .from(manualDonation)
            .innerJoin(contact, eq(manualDonation.contactId, contact.id))
            .where(and(
              eq(manualDonation.paymentStatus, "completed"),
              gte(manualDonation.paymentDate, startDateStr),
              lte(manualDonation.paymentDate, endDateStr),
              eq(contact.locationId, adminLocationId)
            ));

          pledgesData.push(pledgeResult[0]?.total || 0);
          paymentsData.push(paymentResult[0]?.total || 0);
          manualDonationsData.push(manualDonationResult[0]?.total || 0);
        }
      } else {
        // 2 months or more - show monthly data
        const months = [];

        // Generate monthly intervals
        const current = new Date(start.getFullYear(), start.getMonth(), 1);
        while (current < end) {
          months.push(new Date(current));
          current.setMonth(current.getMonth() + 1);
        }

        for (const monthStart of months) {
          const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
          const startDateStr = monthStart.toISOString().split('T')[0];
          const endDateStr = monthEnd.toISOString().split('T')[0];
          const monthName = monthStart.toLocaleString('en-US', { month: 'short', year: 'numeric' });
          labels.push(monthName);

          // Pledges for this month
          const pledgeResult = await db
            .select({ total: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)` })
            .from(pledge)
            .innerJoin(contact, eq(pledge.contactId, contact.id))
            .where(and(
              gte(pledge.pledgeDate, startDateStr),
              lte(pledge.pledgeDate, endDateStr),
              eq(contact.locationId, adminLocationId)
            ));

          // Payments for this month
          const paymentResult = await db
            .select({ total: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)` })
            .from(payment)
            .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
            .innerJoin(contact, eq(pledge.contactId, contact.id))
            .where(and(
              eq(payment.paymentStatus, "completed"),
              gte(payment.paymentDate, startDateStr),
              lte(payment.paymentDate, endDateStr),
              eq(contact.locationId, adminLocationId)
            ));

          // Manual donations for this month
          const manualDonationResult = await db
            .select({ total: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)` })
            .from(manualDonation)
            .innerJoin(contact, eq(manualDonation.contactId, contact.id))
            .where(and(
              eq(manualDonation.paymentStatus, "completed"),
              gte(manualDonation.paymentDate, startDateStr),
              lte(manualDonation.paymentDate, endDateStr),
              eq(contact.locationId, adminLocationId)
            ));

          pledgesData.push(pledgeResult[0]?.total || 0);
          paymentsData.push(paymentResult[0]?.total || 0);
          manualDonationsData.push(manualDonationResult[0]?.total || 0);
        }
      }
    } else if (period === "1m") {
      // Show last 4 weeks
      const now = new Date();
      for (let i = 3; i >= 0; i--) {
        const startDate = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
        const endDate = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        const weekLabel = `Week ${4 - i}`;
        labels.push(weekLabel);

        // Pledges for this week
        const pledgeResult = await db
          .select({ total: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)` })
          .from(pledge)
          .innerJoin(contact, eq(pledge.contactId, contact.id))
          .where(and(
            gte(pledge.pledgeDate, startDateStr),
            lt(pledge.pledgeDate, endDateStr),
            eq(contact.locationId, adminLocationId)
          ));

        // Payments for this week
        const paymentResult = await db
          .select({ total: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)` })
          .from(payment)
          .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
          .innerJoin(contact, eq(pledge.contactId, contact.id))
          .where(and(
            eq(payment.paymentStatus, "completed"),
            gte(payment.paymentDate, startDateStr),
            lt(payment.paymentDate, endDateStr),
            eq(contact.locationId, adminLocationId)
          ));

        // Manual donations for this week
        const manualDonationResult = await db
          .select({ total: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)` })
          .from(manualDonation)
          .innerJoin(contact, eq(manualDonation.contactId, contact.id))
          .where(and(
            eq(manualDonation.paymentStatus, "completed"),
            gte(manualDonation.paymentDate, startDateStr),
            lt(manualDonation.paymentDate, endDateStr),
            eq(contact.locationId, adminLocationId)
          ));

        pledgesData.push(pledgeResult[0]?.total || 0);
        paymentsData.push(paymentResult[0]?.total || 0);
        manualDonationsData.push(manualDonationResult[0]?.total || 0);
      }
    } else if (period === "all") {
      // Show yearly data for all time
      const now = new Date();
      const currentYear = now.getFullYear();
      // Show last 5 years for "all"
      for (let i = 4; i >= 0; i--) {
        const year = currentYear - i;
        const startDate = new Date(year, 0, 1); // January 1st
        const endDate = new Date(year + 1, 0, 1); // January 1st of next year
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        labels.push(year.toString());

        // Pledges for this year
        const pledgeResult = await db
          .select({ total: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)` })
          .from(pledge)
          .innerJoin(contact, eq(pledge.contactId, contact.id))
          .where(and(
            gte(pledge.pledgeDate, startDateStr),
            lt(pledge.pledgeDate, endDateStr),
            eq(contact.locationId, adminLocationId)
          ));

        // Payments for this year
        const paymentResult = await db
          .select({ total: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)` })
          .from(payment)
          .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
          .innerJoin(contact, eq(pledge.contactId, contact.id))
          .where(and(
            eq(payment.paymentStatus, "completed"),
            gte(payment.paymentDate, startDateStr),
            lt(payment.paymentDate, endDateStr),
            eq(contact.locationId, adminLocationId)
          ));

        // Manual donations for this year
        const manualDonationResult = await db
          .select({ total: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)` })
          .from(manualDonation)
          .innerJoin(contact, eq(manualDonation.contactId, contact.id))
          .where(and(
            eq(manualDonation.paymentStatus, "completed"),
            gte(manualDonation.paymentDate, startDateStr),
            lt(manualDonation.paymentDate, endDateStr),
            eq(contact.locationId, adminLocationId)
          ));

        pledgesData.push(pledgeResult[0]?.total || 0);
        paymentsData.push(paymentResult[0]?.total || 0);
        manualDonationsData.push(manualDonationResult[0]?.total || 0);
      }
    } else {
      // Show monthly data
      const now = new Date();
      const months = period === "3m" ? 3 : period === "6m" ? 6 : period === "1y" ? 12 : 24;

      for (let i = months - 1; i >= 0; i--) {
        const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        const monthName = startDate.toLocaleString('en-US', { month: 'short' });
        labels.push(monthName);

        // Pledges for this month
        const pledgeResult = await db
          .select({ total: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)` })
          .from(pledge)
          .innerJoin(contact, eq(pledge.contactId, contact.id))
          .where(and(
            gte(pledge.pledgeDate, startDateStr),
            lt(pledge.pledgeDate, endDateStr),
            eq(contact.locationId, adminLocationId)
          ));

        // Payments for this month
        const paymentResult = await db
          .select({ total: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)` })
          .from(payment)
          .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
          .innerJoin(contact, eq(pledge.contactId, contact.id))
          .where(and(
            eq(payment.paymentStatus, "completed"),
            gte(payment.paymentDate, startDateStr),
            lt(payment.paymentDate, endDateStr),
            eq(contact.locationId, adminLocationId)
          ));

        // Manual donations for this month
        const manualDonationResult = await db
          .select({ total: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)` })
          .from(manualDonation)
          .innerJoin(contact, eq(manualDonation.contactId, contact.id))
          .where(and(
            eq(manualDonation.paymentStatus, "completed"),
            gte(manualDonation.paymentDate, startDateStr),
            lt(manualDonation.paymentDate, endDateStr),
            eq(contact.locationId, adminLocationId)
          ));

        pledgesData.push(pledgeResult[0]?.total || 0);
        paymentsData.push(paymentResult[0]?.total || 0);
        manualDonationsData.push(manualDonationResult[0]?.total || 0);
      }
    }

    return NextResponse.json({
      labels,
      pledges: pledgesData,
      payments: paymentsData,
      manualDonations: manualDonationsData,
    });
  } catch (error) {
    console.error("Error fetching dashboard trends:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard trends" },
      { status: 500 }
    );
  }
}
