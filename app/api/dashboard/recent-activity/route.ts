import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql, eq, desc, and, gte, lt, lte, SQL } from "drizzle-orm";
import { contact, manualDonation, user } from "@/lib/db/schema";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
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

    // Build where conditions for manual donations
    let whereCondition = eq(contact.locationId, adminLocationId);

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      whereCondition = and(
        whereCondition,
        gte(manualDonation.paymentDate, start.toISOString().split('T')[0]),
        lte(manualDonation.paymentDate, end.toISOString().split('T')[0])
      )!;
    }

    // Recent manual donations (filter by admin's location)
    const recentManualDonations = await db
      .select({
        type: sql<string>`'manual_donation'`,
        contactName: sql<string>`COALESCE(CONCAT(${contact.firstName}, ' ', ${contact.lastName}), 'Unknown')`,
        amount: manualDonation.amountUsd,
        date: manualDonation.paymentDate,
        method: manualDonation.paymentMethod,
        id: manualDonation.id,
      })
      .from(manualDonation)
      .innerJoin(contact, eq(manualDonation.contactId, contact.id))
      .where(whereCondition)
      .orderBy(desc(manualDonation.paymentDate))
      .limit(limit);

    // Return manual donations directly
    const combined = recentManualDonations;

    return NextResponse.json(combined);
  } catch (error) {
    console.error("Error fetching recent activity:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent activity" },
      { status: 500 }
    );
  }
}
