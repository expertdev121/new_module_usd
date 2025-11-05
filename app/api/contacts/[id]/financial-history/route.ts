import { db } from "@/lib/db";
import {
  campaign,
  pledge,
  payment,
  manualDonation,
  user,
  contact,
  relationships,
  category,
  solicitor,
} from "@/lib/db/schema";
import { sql, eq, desc, and, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contactId = parseInt(id, 10);
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = (page - 1) * limit;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user details
    const userDetails = await db
      .select({
        role: user.role,
        locationId: user.locationId,
      })
      .from(user)
      .where(eq(user.email, session.user.email))
      .limit(1);

    if (userDetails.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Fetch pledges with related data
    const pledgesData = await db
      .select({
        id: pledge.id,
        type: sql<string>`'pledge'`,
        date: pledge.pledgeDate,
        campaign: pledge.campaignCode,
        categoryName: category.name,
        relationshipType: relationships.relationshipType,
        description: pledge.description,
        pledgeAmount: pledge.originalAmountUsd,
        paymentAmount: sql<number>`NULL`,
        balance: pledge.balanceUsd,
        paymentMethod: sql<string>`NULL`,
        referenceNumber: sql<string>`NULL`,
        solicitorName: sql<string>`NULL`,
        currency: pledge.currency,
        notes: pledge.notes,
      })
      .from(pledge)
      .leftJoin(category, eq(pledge.categoryId, category.id))
      .leftJoin(relationships, eq(pledge.relationshipId, relationships.id))
      .where(eq(pledge.contactId, contactId))
      .orderBy(desc(pledge.pledgeDate));

    // Fetch payments with related data
    const paymentsData = await db
      .select({
        id: payment.id,
        type: sql<string>`'payment'`,
        date: payment.paymentDate,
        campaign: pledge.campaignCode,
        categoryName: category.name,
        relationshipType: relationships.relationshipType,
        description: sql<string>`CONCAT('Payment for ', ${pledge.description})`,
        pledgeAmount: sql<number>`NULL`,
        paymentAmount: payment.amountUsd,
        balance: sql<number>`NULL`,
        paymentMethod: payment.paymentMethod,
        referenceNumber: payment.referenceNumber,
        solicitorName: sql<string>`CONCAT(${contact.firstName}, ' ', ${contact.lastName})`,
        currency: payment.currency,
        notes: payment.notes,
      })
      .from(payment)
      .leftJoin(pledge, eq(payment.pledgeId, pledge.id))
      .leftJoin(category, eq(pledge.categoryId, category.id))
      .leftJoin(relationships, eq(payment.relationshipId, relationships.id))
      .leftJoin(solicitor, eq(payment.solicitorId, solicitor.id))
      .leftJoin(contact, eq(solicitor.contactId, contact.id))
      .where(
        or(
          eq(pledge.contactId, contactId),
          eq(payment.payerContactId, contactId)
        )
      )
      .orderBy(desc(payment.paymentDate));

    // Fetch manual donations
    const donationsData = await db
      .select({
        id: manualDonation.id,
        type: sql<string>`'donation'`,
        date: manualDonation.paymentDate,
        campaign: campaign.name,
        categoryName: sql<string>`NULL`,
        relationshipType: sql<string>`NULL`,
        description: sql<string>`'Direct Donation'`,
        pledgeAmount: sql<number>`NULL`,
        paymentAmount: manualDonation.amountUsd,
        balance: sql<number>`NULL`,
        paymentMethod: manualDonation.paymentMethod,
        referenceNumber: manualDonation.referenceNumber,
        solicitorName: sql<string>`CONCAT(${contact.firstName}, ' ', ${contact.lastName})`,
        currency: manualDonation.currency,
        notes: manualDonation.notes,
      })
      .from(manualDonation)
      .leftJoin(campaign, eq(manualDonation.campaignId, campaign.id))
      .leftJoin(solicitor, eq(manualDonation.solicitorId, solicitor.id))
      .leftJoin(contact, eq(solicitor.contactId, contact.id))
      .where(eq(manualDonation.contactId, contactId))
      .orderBy(desc(manualDonation.paymentDate));

    // Combine all records
    const allRecords = [...pledgesData, ...paymentsData, ...donationsData]
      .sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateB - dateA; // Most recent first
      });

    // Calculate totals
    const totalPledged = pledgesData.reduce((sum, p) => {
      const amount = parseFloat(p.pledgeAmount?.toString() || "0");
      return sum + amount;
    }, 0);

    const totalPaid = paymentsData.reduce((sum, p) => {
      const amount = parseFloat(p.paymentAmount?.toString() || "0");
      return sum + amount;
    }, 0);

    const totalDonations = donationsData.reduce((sum, d) => {
      const amount = parseFloat(d.paymentAmount?.toString() || "0");
      return sum + amount;
    }, 0);

    const totalBalance = pledgesData.reduce((sum, p) => {
      const amount = parseFloat(p.balance?.toString() || "0");
      return sum + amount;
    }, 0);

    // Paginate results
    const paginatedRecords = allRecords.slice(offset, offset + limit);

    return NextResponse.json({
      records: paginatedRecords.map((record) => ({
        id: record.id,
        type: record.type,
        date: record.date,
        campaign: record.campaign,
        category: record.categoryName,
        relationship: record.relationshipType,
        description: record.description,
        pledgeAmount: record.pledgeAmount
          ? parseFloat(record.pledgeAmount.toString())
          : undefined,
        paymentAmount: record.paymentAmount
          ? parseFloat(record.paymentAmount.toString())
          : undefined,
        balance: record.balance
          ? parseFloat(record.balance.toString())
          : undefined,
        paymentMethod: record.paymentMethod,
        referenceNumber: record.referenceNumber,
        solicitor: record.solicitorName,
        currency: record.currency,
        notes: record.notes,
      })),
      pagination: {
        page,
        limit,
        total: allRecords.length,
        totalPages: Math.ceil(allRecords.length / limit),
      },
      summary: {
        totalPledged,
        totalPaid,
        totalBalance,
        totalDonations,
      },
    });
  } catch (error) {
    console.error("Financial history error:", error);
    return NextResponse.json(
      { error: "Failed to fetch financial history" },
      { status: 500 }
    );
  }
}