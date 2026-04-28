import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { campaign } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { PUBLIC_STRIPE_LOCATION_ID } from "@/lib/public-stripe-payments";

export const runtime = "nodejs";

const BENCHMARK_CAMPAIGN_NAMES = [
  "General Fund Donation",
  "Chaplains Partnership Initiative Donation",
] as const;

export async function GET() {
  try {
    const existing = await db
      .select({ id: campaign.id, name: campaign.name })
      .from(campaign)
      .where(
        and(
          eq(campaign.locationId, PUBLIC_STRIPE_LOCATION_ID),
          inArray(campaign.name, [...BENCHMARK_CAMPAIGN_NAMES]),
          eq(campaign.status, "active")
        )
      );

    // Always return both options in display order; id is null if not yet in DB
    // (the webhook will create the campaign on first successful payment)
    const result = BENCHMARK_CAMPAIGN_NAMES.map((name) => ({
      id: existing.find((c) => c.name === name)?.id ?? null,
      name,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching benchmark campaigns:", error);
    return NextResponse.json({ error: "Failed to load campaigns" }, { status: 500 });
  }
}
