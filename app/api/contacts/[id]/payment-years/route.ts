import { db } from "@/lib/db";
import { payment, manualDonation, pledge } from "@/lib/db/schema";
import { eq, or, sql, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contactId = parseInt(id, 10);

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get distinct years from payments
    const paymentYears = await db
      .selectDistinct({
        year: sql<number>`EXTRACT(YEAR FROM ${payment.receivedDate})`,
      })
      .from(payment)
      .leftJoin(pledge, eq(payment.pledgeId, pledge.id))
      .where(
        or(
          eq(pledge.contactId, contactId),
          eq(payment.payerContactId, contactId)
        )
      )
      .orderBy(desc(sql<number>`EXTRACT(YEAR FROM ${payment.receivedDate})`));

    // Get distinct years from manual donations
    const donationYears = await db
      .selectDistinct({
        year: sql<number>`EXTRACT(YEAR FROM ${manualDonation.receivedDate})`,
      })
      .from(manualDonation)
      .where(eq(manualDonation.contactId, contactId))
      .orderBy(desc(sql<number>`EXTRACT(YEAR FROM ${manualDonation.receivedDate})`));

    // Combine and deduplicate years
    const allYears = [...paymentYears, ...donationYears]
      .map(item => item.year)
      .filter((year, index, arr) => arr.indexOf(year) === index)
      .filter(year => year !== null && !isNaN(year))
      .sort((a, b) => b - a); // Most recent first

    return NextResponse.json({ years: allYears });
  } catch (error) {
    console.error("Payment years error:", error);
    return NextResponse.json(
      { error: "Failed to fetch payment years" },
      { status: 500 }
    );
  }
}