import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql, eq, and, gte, lt, lte, SQL } from "drizzle-orm";
import { contact, pledge, payment, user, manualDonation } from "@/lib/db/schema";
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
    const limit = parseInt(searchParams.get("limit") || "5");
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

    let pledgeWhereCondition: SQL<unknown> | undefined = undefined;
    let paymentWhereCondition: SQL<unknown> | undefined = undefined;

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      pledgeWhereCondition = and(
        gte(pledge.pledgeDate, start.toISOString().split('T')[0]),
        lte(pledge.pledgeDate, end.toISOString().split('T')[0])
      );
      paymentWhereCondition = and(
        eq(payment.paymentStatus, "completed"),
        gte(payment.paymentDate, start.toISOString().split('T')[0]),
        lte(payment.paymentDate, end.toISOString().split('T')[0])
      );
    }

    const topDonors = await db
      .select({
        contactId: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        pledgesCount: sql<number>`COUNT(DISTINCT ${pledge.id})`,
        totalPledged: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)`,
        pledgeAmount: sql<number>`COALESCE(SUM(CASE WHEN ${payment.isThirdPartyPayment} = false AND ${payment.paymentStatus} = 'completed' THEN ${payment.amountUsd} ELSE 0 END), 0)`,
        thirdPartyAmount: sql<number>`COALESCE(SUM(CASE WHEN ${payment.isThirdPartyPayment} = true AND ${payment.paymentStatus} = 'completed' THEN ${payment.amountUsd} ELSE 0 END), 0)`,
        manualDonationAmount: sql<number>`COALESCE(SUM(CASE WHEN ${manualDonation.paymentStatus} = 'completed' THEN ${manualDonation.amountUsd} ELSE 0 END), 0)`,
      })
      .from(contact)
      .leftJoin(pledge, eq(pledge.contactId, contact.id))
      .leftJoin(payment, sql`(${payment.pledgeId} = ${pledge.id} AND ${payment.isThirdPartyPayment} = false) OR (${payment.payerContactId} = ${contact.id} AND ${payment.isThirdPartyPayment} = true)`)
      .leftJoin(manualDonation, eq(manualDonation.contactId, contact.id))
      .where(and(
        eq(contact.locationId, adminLocationId),
        pledgeWhereCondition || paymentWhereCondition ? and(
          pledgeWhereCondition || sql`1=1`,
          paymentWhereCondition || sql`1=1`
        ) : sql`1=1`
      ))
      .groupBy(contact.id, contact.firstName, contact.lastName)
      .having(sql`COUNT(DISTINCT ${pledge.id}) > 0 OR COALESCE(SUM(CASE WHEN ${payment.isThirdPartyPayment} = true AND ${payment.paymentStatus} = 'completed' THEN ${payment.amountUsd} ELSE 0 END), 0) > 0 OR COALESCE(SUM(CASE WHEN ${manualDonation.paymentStatus} = 'completed' THEN ${manualDonation.amountUsd} ELSE 0 END), 0) > 0`)
      .orderBy(sql`(COALESCE(SUM(CASE WHEN ${payment.isThirdPartyPayment} = false AND ${payment.paymentStatus} = 'completed' THEN ${payment.amountUsd} ELSE 0 END), 0) + COALESCE(SUM(CASE WHEN ${payment.isThirdPartyPayment} = true AND ${payment.paymentStatus} = 'completed' THEN ${payment.amountUsd} ELSE 0 END), 0) + COALESCE(SUM(CASE WHEN ${manualDonation.paymentStatus} = 'completed' THEN ${manualDonation.amountUsd} ELSE 0 END), 0)) DESC`)
      .limit(limit);

    const donors = topDonors.map(donor => {
      const totalAmount = donor.pledgeAmount + donor.thirdPartyAmount + donor.manualDonationAmount;
      return {
        name: `${donor.firstName} ${donor.lastName}`,
        pledges: donor.pledgesCount,
        pledgeAmount: donor.pledgeAmount,
        thirdPartyAmount: donor.thirdPartyAmount,
        manualDonationAmount: donor.manualDonationAmount,
        amount: totalAmount,
        pledgedAmount: donor.totalPledged,
        completion: donor.totalPledged > 0 ? (donor.pledgeAmount / donor.totalPledged) * 100 : 0,
      };
    });

    return NextResponse.json(donors);
  } catch (error) {
    console.error("Error fetching top donors:", error);
    return NextResponse.json(
      { error: "Failed to fetch top donors" },
      { status: 500 }
    );
  }
}
