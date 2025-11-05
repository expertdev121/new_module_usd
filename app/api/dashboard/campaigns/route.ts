import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { payment, pledge, contact, user, manualDonation, campaign } from "@/lib/db/schema";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const locationId = searchParams.get("locationId");

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

    const whereConditions = [eq(contact.locationId, adminLocationId)];

    if (startDate && endDate) {
      whereConditions.push(gte(payment.paymentDate, startDate));
      whereConditions.push(lte(payment.paymentDate, endDate));
    }

    if (locationId) {
      whereConditions.push(eq(contact.locationId, locationId));
    }

    // Get campaign summaries from pledges/payments
    const pledgeCampaignsData = await db
      .select({
        name: sql<string>`${pledge.campaignCode}`,
        amount: sql<number>`coalesce(sum(${payment.amountUsd}), 0)`,
        donations: sql<number>`count(${payment.id})`,
      })
      .from(payment)
      .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(...whereConditions))
      .groupBy(pledge.campaignCode)
      .having(sql`${pledge.campaignCode} is not null`)
      .orderBy(sql`coalesce(sum(${payment.amountUsd}), 0) desc`);

    // Get campaign summaries from manual donations
    const manualDonationCampaignsData = await db
      .select({
        name: sql<string>`${campaign.name}`,
        amount: sql<number>`coalesce(sum(${manualDonation.amountUsd}), 0)`,
        donations: sql<number>`count(${manualDonation.id})`,
      })
      .from(manualDonation)
      .leftJoin(campaign, eq(manualDonation.campaignId, campaign.id))
      .innerJoin(contact, eq(manualDonation.contactId, contact.id))
      .where(and(
        eq(contact.locationId, adminLocationId),
        ...(startDate && endDate ? [gte(manualDonation.paymentDate, startDate), lte(manualDonation.paymentDate, endDate)] : []),
        ...(locationId ? [eq(contact.locationId, locationId)] : []),
        sql`${campaign.name} is not null`
      ))
      .groupBy(campaign.name)
      .orderBy(sql`coalesce(sum(${manualDonation.amountUsd}), 0) desc`);

    // Combine and aggregate campaign data
    const campaignMap = new Map<string, { name: string; amount: number; donations: number }>();

    // Add pledge campaign data
    pledgeCampaignsData.forEach(campaign => {
      if (campaign.name) {
        const key = campaign.name;
        const existing = campaignMap.get(key);
        if (existing) {
          existing.amount += Number(campaign.amount) || 0;
          existing.donations += Number(campaign.donations) || 0;
        } else {
          campaignMap.set(key, {
            name: campaign.name,
            amount: Number(campaign.amount) || 0,
            donations: Number(campaign.donations) || 0,
          });
        }
      }
    });

    // Add manual donation campaign data
    manualDonationCampaignsData.forEach(campaign => {
      if (campaign.name) {
        const key = campaign.name;
        const existing = campaignMap.get(key);
        if (existing) {
          existing.amount += Number(campaign.amount) || 0;
          existing.donations += Number(campaign.donations) || 0;
        } else {
          campaignMap.set(key, {
            name: campaign.name,
            amount: Number(campaign.amount) || 0,
            donations: Number(campaign.donations) || 0,
          });
        }
      }
    });

    // Convert map to array and sort by amount descending
    const campaignsData = Array.from(campaignMap.values()).sort((a, b) => b.amount - a.amount);

    // Calculate totals
    const totalCampaigns = campaignsData.length;
    const totalRaised = campaignsData.reduce((sum, campaign) => {
      const amount = Number(campaign.amount) || 0;
      return sum + amount;
    }, 0);
    const averageDonation = totalCampaigns > 0 ? totalRaised / totalCampaigns : 0;
    const topCampaign = campaignsData.length > 0 ? {
      name: campaignsData[0].name,
      amount: Number(campaignsData[0].amount) || 0,
    } : { name: 'N/A', amount: 0 };

    // Get detailed payments for each campaign from pledges
    const pledgeDetailedData = await db
      .select({
        campaignCode: pledge.campaignCode,
        contactName: sql<string>`concat(${contact.firstName}, ' ', ${contact.lastName})`,
        paymentAmount: payment.amountUsd,
        paymentDate: payment.paymentDate,
        paymentMethod: payment.paymentMethod,
      })
      .from(payment)
      .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(and(...whereConditions, sql`${pledge.campaignCode} is not null`))
      .orderBy(pledge.campaignCode, payment.paymentDate);

    // Get detailed manual donations for each campaign
    const manualDonationDetailedData = await db
      .select({
        campaignCode: campaign.name,
        contactName: sql<string>`concat(${contact.firstName}, ' ', ${contact.lastName})`,
        paymentAmount: manualDonation.amountUsd,
        paymentDate: manualDonation.paymentDate,
        paymentMethod: manualDonation.paymentMethod,
      })
      .from(manualDonation)
      .leftJoin(campaign, eq(manualDonation.campaignId, campaign.id))
      .innerJoin(contact, eq(manualDonation.contactId, contact.id))
      .where(and(
        eq(contact.locationId, adminLocationId),
        ...(startDate && endDate ? [gte(manualDonation.paymentDate, startDate), lte(manualDonation.paymentDate, endDate)] : []),
        ...(locationId ? [eq(contact.locationId, locationId)] : []),
        sql`${campaign.name} is not null`
      ))
      .orderBy(campaign.name, manualDonation.paymentDate);

    // Combine detailed data
    const detailedData = [...pledgeDetailedData, ...manualDonationDetailedData];

    return NextResponse.json({
      totalCampaigns,
      totalRaised,
      averageDonation,
      topCampaign,
      campaigns: campaignsData,
      details: detailedData,
    });
  } catch (error) {
    console.error("Error fetching campaigns data:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaigns data" },
      { status: 500 }
    );
  }
}
