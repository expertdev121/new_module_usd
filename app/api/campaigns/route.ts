import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { campaign, user, manualDonation } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const createCampaignSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  status: z.enum(["active", "inactive", "completed"]).default("active"),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    // Get campaigns for admin's location - ordered alphabetically by name
    const campaigns = await db
      .select()
      .from(campaign)
      .where(eq(campaign.locationId, adminLocationId))
      .orderBy(asc(campaign.name));

    return NextResponse.json(campaigns);
  } catch (error) {
    console.error("Error fetching campaigns:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaigns" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validationResult = createCampaignSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { name, description, status } = validationResult.data;

    // Get admin's locationId and userId
    const userResult = await db
      .select({ id: user.id, locationId: user.locationId })
      .from(user)
      .where(eq(user.email, session.user.email))
      .limit(1);

    if (!userResult.length || !userResult[0].locationId) {
      return NextResponse.json({ error: "Admin location not found" }, { status: 400 });
    }

    const adminUserId = userResult[0].id;
    const adminLocationId = userResult[0].locationId;

    // Create campaign
    const newCampaign = await db
      .insert(campaign)
      .values({
        name,
        description,
        status,
        locationId: adminLocationId,
        createdBy: adminUserId,
        updatedBy: adminUserId,
      })
      .returning();

    return NextResponse.json(newCampaign[0], { status: 201 });
  } catch (error) {
    console.error("Error creating campaign:", error);
    return NextResponse.json(
      { error: "Failed to create campaign" },
      { status: 500 }
    );
  }
}