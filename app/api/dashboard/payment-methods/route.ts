import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql, eq, and, gte, lt, lte, SQL } from "drizzle-orm";
import { payment, user, pledge, contact, manualDonation } from "@/lib/db/schema";
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

    let whereCondition: SQL<unknown> | undefined = eq(payment.paymentStatus, "completed");

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      whereCondition = and(
        eq(payment.paymentStatus, "completed"),
        gte(payment.paymentDate, start.toISOString().split('T')[0]),
        lte(payment.paymentDate, end.toISOString().split('T')[0])
      );
    }

    // Get payment method stats from payments table
    const paymentMethodStats = await db
      .select({
        method: payment.paymentMethod,
        totalAmount: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(payment)
      .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(
        whereCondition,
        eq(contact.locationId, adminLocationId)
      ))
      .groupBy(payment.paymentMethod);

    // Get manual donation method stats
    const manualDonationMethodStats = await db
      .select({
        method: manualDonation.paymentMethod,
        totalAmount: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(manualDonation)
      .innerJoin(contact, eq(manualDonation.contactId, contact.id))
      .where(and(
        eq(manualDonation.paymentStatus, "completed"),
        eq(contact.locationId, adminLocationId),
        startDate && endDate ? and(
          gte(manualDonation.paymentDate, startDate),
          lte(manualDonation.paymentDate, endDate)
        ) : sql`1=1`
      ))
      .groupBy(manualDonation.paymentMethod);

    // Combine and aggregate the stats
    const combinedStats = new Map<string, { totalAmount: number; count: number }>();

    // Add payment method stats
    paymentMethodStats.forEach(stat => {
      if (stat.method) {
        combinedStats.set(stat.method, {
          totalAmount: stat.totalAmount,
          count: stat.count,
        });
      }
    });

    // Add manual donation method stats
    manualDonationMethodStats.forEach(stat => {
      if (stat.method) {
        const existing = combinedStats.get(stat.method);
        if (existing) {
          existing.totalAmount += stat.totalAmount;
          existing.count += stat.count;
        } else {
          combinedStats.set(stat.method, {
            totalAmount: stat.totalAmount,
            count: stat.count,
          });
        }
      }
    });

    // Convert to array and sort by total amount descending
    const methodStats = Array.from(combinedStats.entries())
      .map(([method, stats]) => ({
        method,
        totalAmount: stats.totalAmount,
        count: stats.count,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    const labels = methodStats.map(stat => stat.method);
    const values = methodStats.map(stat => stat.totalAmount);
    const counts = methodStats.map(stat => stat.count);

    return NextResponse.json({
      labels,
      values,
      counts,
    });
  } catch (error) {
    console.error("Error fetching payment methods:", error);
    return NextResponse.json(
      { error: "Failed to fetch payment methods" },
      { status: 500 }
    );
  }
}
