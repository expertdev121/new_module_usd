import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { campaign } from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { CMN_STRIPE_LOCATION_ID } from "@/lib/public-stripe-payments";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await db
      .select({ id: campaign.id, name: campaign.name })
      .from(campaign)
      .where(
        and(
          eq(campaign.locationId, CMN_STRIPE_LOCATION_ID),
          eq(campaign.status, "active")
        )
      )
      .orderBy(asc(campaign.name));

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error fetching CMN campaigns:", error);
    return NextResponse.json({ error: "Failed to load campaigns" }, { status: 500 });
  }
}
