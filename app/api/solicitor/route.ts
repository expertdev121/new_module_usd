/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, desc, sql, and, isNotNull } from "drizzle-orm";
import { solicitor, contact, payment, user } from "@/lib/db/schema";
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
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    // Build where conditions array
    const whereConditions = [];

    if (status && status !== "all") {
      whereConditions.push(eq(solicitor.status, status as any));
    }

    if (search) {
      whereConditions.push(
        sql`(
          LOWER(${contact.firstName}) LIKE LOWER(${"%" + search + "%"}) OR
          LOWER(${contact.lastName}) LIKE LOWER(${"%" + search + "%"}) OR
          LOWER(${contact.email}) LIKE LOWER(${"%" + search + "%"}) OR
          LOWER(${solicitor.solicitorCode}) LIKE LOWER(${"%" + search + "%"})
        )`
      );
    }

    // Add locationId filtering for admins
    if (isAdmin && currentUser.locationId) {
      whereConditions.push(eq(solicitor.locationId, currentUser.locationId));
      whereConditions.push(isNotNull(solicitor.locationId));
    }

    // Get total count for pagination
    const countQuery = db
      .select({ count: sql<number>`COUNT(DISTINCT ${solicitor.id})` })
      .from(solicitor)
      .innerJoin(contact, eq(solicitor.contactId, contact.id))
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

    const totalCountResult = await countQuery;
    const totalCount = totalCountResult[0]?.count || 0;

    // Build the complete query with where conditions applied before groupBy
    const query = db
      .select({
        id: solicitor.id,
        contactId: solicitor.contactId,
        solicitorCode: solicitor.solicitorCode,
        status: solicitor.status,
        commissionRate: solicitor.commissionRate,
        hireDate: solicitor.hireDate,
        terminationDate: solicitor.terminationDate,
        notes: solicitor.notes,
        // Contact info
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        // Performance metrics (calculated)
        paymentsCount: sql<number>`COUNT(${payment.id})`,
        lastActivity: sql<string>`MAX(${payment.paymentDate})`,
      })
      .from(solicitor)
      .innerJoin(contact, eq(solicitor.contactId, contact.id))
      .leftJoin(payment, eq(payment.solicitorId, solicitor.id))

      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .groupBy(
        solicitor.id,
        solicitor.contactId,
        solicitor.solicitorCode,
        solicitor.status,
        solicitor.commissionRate,
        solicitor.hireDate,
        solicitor.terminationDate,
        solicitor.notes,
        contact.firstName,
        contact.lastName,
        contact.email,
        contact.phone
      )
      .orderBy(desc(solicitor.id))
      .limit(limit)
      .offset(offset);

    const solicitors = await query;

    return NextResponse.json({
      solicitors,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching solicitors:", error);
    return NextResponse.json(
      { error: "Failed to fetch solicitors" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const {
      contactId,
      solicitorCode,
      status = "active",
      commissionRate,
      hireDate,
      notes,
    } = body;

    // Validate required fields
    if (!contactId) {
      return NextResponse.json(
        { error: "Contact ID is required" },
        { status: 400 }
      );
    }

    // Check if contact exists
    const existingContact = await db
      .select()
      .from(contact)
      .where(eq(contact.id, contactId))
      .limit(1);

    if (existingContact.length === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    // Check if solicitor already exists for this contact
    const existingSolicitor = await db
      .select()
      .from(solicitor)
      .where(eq(solicitor.contactId, contactId))
      .limit(1);

    if (existingSolicitor.length > 0) {
      return NextResponse.json(
        { error: "Solicitor already exists for this contact" },
        { status: 409 }
      );
    }

    const newSolicitor = await db
      .insert(solicitor)
      .values({
        contactId,
        solicitorCode,
        status,
        commissionRate,
        hireDate,
        notes,
        locationId: isAdmin ? currentUser.locationId : null,
      })
      .returning();

    return NextResponse.json({ solicitor: newSolicitor[0] }, { status: 201 });
  } catch (error) {
    console.error("Error creating solicitor:", error);
    return NextResponse.json(
      { error: "Failed to create solicitor" },
      { status: 500 }
    );
  }
}
