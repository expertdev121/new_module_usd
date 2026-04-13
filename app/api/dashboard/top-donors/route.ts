import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql, eq, and, gte, lte, desc } from "drizzle-orm";
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
    const limit = Number.parseInt(searchParams.get("limit") || "5", 10);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const userResult = await db
      .select({ locationId: user.locationId })
      .from(user)
      .where(eq(user.email, session.user.email))
      .limit(1);

    if (!userResult.length || !userResult[0].locationId) {
      return NextResponse.json({ error: "Admin location not found" }, { status: 400 });
    }

    const adminLocationId = userResult[0].locationId;

    const pledgeFilters = [];
    if (startDate) {
      pledgeFilters.push(gte(pledge.pledgeDate, startDate));
    }
    if (endDate) {
      pledgeFilters.push(lte(pledge.pledgeDate, endDate));
    }

    const paymentFilters = [eq(payment.paymentStatus, "completed")];
    if (startDate) {
      paymentFilters.push(gte(payment.paymentDate, startDate));
    }
    if (endDate) {
      paymentFilters.push(lte(payment.paymentDate, endDate));
    }

    const manualDonationFilters = [eq(manualDonation.paymentStatus, "completed")];
    if (startDate) {
      manualDonationFilters.push(gte(manualDonation.paymentDate, startDate));
    }
    if (endDate) {
      manualDonationFilters.push(lte(manualDonation.paymentDate, endDate));
    }

    const pledgeAgg = db
      .select({
        contactId: pledge.contactId,
        pledgesCount: sql<number>`COUNT(*)`.as("pledgesCount"),
        totalPledged: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)`.as("totalPledged"),
      })
      .from(pledge)
      .where(pledgeFilters.length > 0 ? and(...pledgeFilters) : undefined)
      .groupBy(pledge.contactId)
      .as("pledge_agg");

    const directPaymentAgg = db
      .select({
        contactId: pledge.contactId,
        pledgeAmount: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)`.as("pledgeAmount"),
      })
      .from(payment)
      .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
      .where(and(...paymentFilters, sql`COALESCE(${payment.isThirdPartyPayment}, false) = false`))
      .groupBy(pledge.contactId)
      .as("direct_payment_agg");

    const thirdPartyPaymentAgg = db
      .select({
        contactId: payment.payerContactId,
        thirdPartyAmount: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)`.as("thirdPartyAmount"),
      })
      .from(payment)
      .where(and(...paymentFilters, sql`COALESCE(${payment.isThirdPartyPayment}, false) = true`, sql`${payment.payerContactId} IS NOT NULL`))
      .groupBy(payment.payerContactId)
      .as("third_party_payment_agg");

    const manualDonationAgg = db
      .select({
        contactId: manualDonation.contactId,
        manualDonationAmount: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)`.as("manualDonationAmount"),
      })
      .from(manualDonation)
      .where(and(...manualDonationFilters))
      .groupBy(manualDonation.contactId)
      .as("manual_donation_agg");

    const donors = await db
      .select({
        contactId: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        pledgesCount: sql<number>`COALESCE(${pledgeAgg.pledgesCount}, 0)`,
        totalPledged: sql<number>`COALESCE(${pledgeAgg.totalPledged}, 0)`,
        pledgeAmount: sql<number>`COALESCE(${directPaymentAgg.pledgeAmount}, 0)`,
        thirdPartyAmount: sql<number>`COALESCE(${thirdPartyPaymentAgg.thirdPartyAmount}, 0)`,
        manualDonationAmount: sql<number>`COALESCE(${manualDonationAgg.manualDonationAmount}, 0)`,
      })
      .from(contact)
      .leftJoin(pledgeAgg, eq(pledgeAgg.contactId, contact.id))
      .leftJoin(directPaymentAgg, eq(directPaymentAgg.contactId, contact.id))
      .leftJoin(thirdPartyPaymentAgg, eq(thirdPartyPaymentAgg.contactId, contact.id))
      .leftJoin(manualDonationAgg, eq(manualDonationAgg.contactId, contact.id))
      .where(eq(contact.locationId, adminLocationId))
      .orderBy(
        desc(sql`(
          COALESCE(${directPaymentAgg.pledgeAmount}, 0) +
          COALESCE(${thirdPartyPaymentAgg.thirdPartyAmount}, 0) +
          COALESCE(${manualDonationAgg.manualDonationAmount}, 0)
        )`)
      )
      .limit(Number.isFinite(limit) && limit > 0 ? limit : 5);

    const normalizedDonors = donors
      .map((donor) => {
        const pledgeAmount = Number(donor.pledgeAmount) || 0;
        const thirdPartyAmount = Number(donor.thirdPartyAmount) || 0;
        const manualDonationAmount = Number(donor.manualDonationAmount) || 0;
        const totalPledged = Number(donor.totalPledged) || 0;
        const pledgesCount = Number(donor.pledgesCount) || 0;
        const totalAmount = pledgeAmount + thirdPartyAmount + manualDonationAmount;

        return {
          name: `${donor.firstName} ${donor.lastName}`.trim(),
          pledges: pledgesCount,
          pledgeAmount,
          thirdPartyAmount,
          manualDonationAmount,
          amount: totalAmount,
          pledgedAmount: totalPledged,
          completion: totalPledged > 0 && pledgeAmount > 0 ? (pledgeAmount / totalPledged) * 100 : 0,
        };
      })
      .filter((donor) => donor.pledges > 0 || donor.amount > 0);

    return NextResponse.json(normalizedDonors);
  } catch (error) {
    console.error("Error fetching top donors:", error);
    return NextResponse.json(
      { error: "Failed to fetch top donors" },
      { status: 500 }
    );
  }
}
