// app/api/campaigns/merge/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { campaign, manualDonation } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { sourceCampaignIds, targetCampaignId } = await request.json();

    // Validation
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

    // Remove target campaign from source list if it exists
    const actualSourceIds = sourceCampaignIds.filter(id => id !== targetCampaignId);

    if (actualSourceIds.length === 0) {
      return NextResponse.json(
        { error: "At least one source campaign (other than the target) is required" },
        { status: 400 }
      );
    }

    // Verify all campaigns exist
    const allCampaignIds = [...actualSourceIds, targetCampaignId];
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

    // Get counts before merge
    const donationsToUpdate = await db
      .select({ count: manualDonation.id })
      .from(manualDonation)
      .where(inArray(manualDonation.campaignId, actualSourceIds));

    const donationCount = donationsToUpdate.length;

    // Update manual donations to point to target campaign
    // (No transaction needed - operations are independent)
    if (donationCount > 0) {
      await db
        .update(manualDonation)
        .set({ 
          campaignId: targetCampaignId,
          updatedAt: new Date()
        })
        .where(inArray(manualDonation.campaignId, actualSourceIds));
    }

    // Delete source campaigns
    await db
      .delete(campaign)
      .where(inArray(campaign.id, actualSourceIds));

    const targetCampaign = existingCampaigns.find(c => c.id === targetCampaignId);

    return NextResponse.json({
      success: true,
      message: `Successfully merged ${actualSourceIds.length} campaign${actualSourceIds.length !== 1 ? 's' : ''} into "${targetCampaign?.name}"`,
      details: {
        mergedCampaigns: actualSourceIds.length,
        updatedDonations: donationCount,
        targetCampaignId,
        targetCampaignName: targetCampaign?.name
      }
    });
  } catch (error) {
    console.error("Error merging campaigns:", error);
    return NextResponse.json(
      { 
        error: "Failed to merge campaigns",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}