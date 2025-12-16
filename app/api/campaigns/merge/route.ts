import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { campaign, manualDonation } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { sourceCampaignIds, targetCampaignId } = await request.json();

    if (!sourceCampaignIds || !Array.isArray(sourceCampaignIds) || sourceCampaignIds.length === 0) {
      return NextResponse.json(
        { error: "Source campaign IDs are required and must be an array" },
        { status: 400 }
      );
    }

    if (!targetCampaignId || typeof targetCampaignId !== "number") {
      return NextResponse.json(
        { error: "Target campaign ID is required and must be a number" },
        { status: 400 }
      );
    }

    if (sourceCampaignIds.includes(targetCampaignId)) {
      return NextResponse.json(
        { error: "Target campaign cannot be in the source campaigns list" },
        { status: 400 }
      );
    }

    // Verify all campaigns exist
    const allCampaignIds = [...sourceCampaignIds, targetCampaignId];
    const existingCampaigns = await db
      .select({ id: campaign.id, name: campaign.name })
      .from(campaign)
      .where(inArray(campaign.id, allCampaignIds));

    if (existingCampaigns.length !== allCampaignIds.length) {
      const foundIds = existingCampaigns.map(c => c.id);
      const missingIds = allCampaignIds.filter(id => !foundIds.includes(id));
      return NextResponse.json(
        { error: `Campaigns not found: ${missingIds.join(", ")}` },
        { status: 404 }
      );
    }

    // Start transaction
    await db.transaction(async (tx) => {
      // Update manual donations to point to target campaign
      await tx
        .update(manualDonation)
        .set({ campaignId: targetCampaignId })
        .where(inArray(manualDonation.campaignId, sourceCampaignIds));

      // Delete source campaigns
      await tx
        .delete(campaign)
        .where(inArray(campaign.id, sourceCampaignIds));
    });

    return NextResponse.json({
      success: true,
      message: `Successfully merged ${sourceCampaignIds.length} campaigns into target campaign ${targetCampaignId}`,
    });
  } catch (error) {
    console.error("Error merging campaigns:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
