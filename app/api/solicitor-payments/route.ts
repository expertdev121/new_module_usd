import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, desc, isNull, isNotNull, and, sql } from "drizzle-orm";
import { payment, contact, pledge, category, solicitor, user } from "@/lib/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user details including locationId
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

    const currentUser = userDetails[0];
    const isAdmin = currentUser.role === "admin";

    const { searchParams } = new URL(request.url);
    const assigned = searchParams.get("assigned");
    const solicitorId = searchParams.get("solicitorId");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;
    const whereConditions = [];

    if (assigned === "true") {
      whereConditions.push(isNotNull(payment.solicitorId));
    } else if (assigned === "false") {
      whereConditions.push(isNull(payment.solicitorId));
    }

    if (solicitorId) {
      whereConditions.push(eq(payment.solicitorId, parseInt(solicitorId)));
    }

    // Add locationId filtering for admins
    if (isAdmin && currentUser.locationId) {
      whereConditions.push(eq(contact.locationId, currentUser.locationId));
    }

    // Get total count for pagination
    const countQuery = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(payment)
      .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

    const totalCountResult = await countQuery;
    const totalCount = totalCountResult[0]?.count || 0;

    const solicitorContact = alias(contact, "s_contact");
    const payments = await db
      .select({
        id: payment.id,
        amount: payment.amount,
        amountUsd: payment.amountUsd,
        currency: payment.currency,
        paymentDate: payment.paymentDate,
        receivedDate: payment.receivedDate,
        paymentMethod: payment.paymentMethod,
        paymentStatus: payment.paymentStatus,
        referenceNumber: payment.referenceNumber,
        solicitorId: payment.solicitorId,
        bonusPercentage: payment.bonusPercentage,
        bonusAmount: payment.bonusAmount,
        bonusRuleId: payment.bonusRuleId,
        notes: payment.notes,

        contactFirstName: contact.firstName,
        contactLastName: contact.lastName,
        contactEmail: contact.email,
        pledgeDescription: pledge.description,
        categoryName: category.name,
        solicitorFirstName: solicitorContact.firstName,
        solicitorLastName: solicitorContact.lastName,
        solicitorCode: solicitor.solicitorCode,
      })
      .from(payment)
      .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .leftJoin(category, eq(pledge.categoryId, category.id))
      .leftJoin(solicitor, eq(payment.solicitorId, solicitor.id))
      .leftJoin(solicitorContact, eq(solicitor.contactId, solicitorContact.id))
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(payment.paymentDate))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      payments,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching payments:", error);
    return NextResponse.json(
      { error: "Failed to fetch payments" },
      { status: 500 }
    );
  }
}
