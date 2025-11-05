import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, sql, desc, asc, or, ilike, and, isNotNull } from "drizzle-orm";
import type {
  Column,
  ColumnBaseConfig,
  ColumnDataType,
  SQL,
} from "drizzle-orm";
import {
  contact,
  pledge,
  manualDonation,
  NewContact,
  user,
  payment,
} from "@/lib/db/schema";
import { z } from "zod";
import { contactFormSchema } from "@/lib/form-schemas/contact";
import { ErrorHandler } from "@/lib/error-handler";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

interface ContactResponse {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  gender: string | null;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
  totalPledgedUsd: number;
  totalPaidUsd: number;
  currentBalanceUsd: number;
}

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z
    .enum([
      "updatedAt",
      "firstName",
      "lastName",
      "displayName",
      "totalPledgedUsd",
    ])
    .default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsedParams = querySchema.safeParse({
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      sortBy: searchParams.get("sortBy") ?? undefined,
      sortOrder: searchParams.get("sortOrder") ?? undefined,
    });

    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsedParams.error },
        { status: 400 }
      );
    }

    const { page, limit, search, sortBy, sortOrder } = parsedParams.data;
    const offset = (page - 1) * limit;

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

    // Get user's contactId for non-admin users
    let userContactId: number | null = null;
    if (!isAdmin) {
      const contactResult = await db
        .select({ id: contact.id })
        .from(contact)
        .where(eq(contact.email, session.user.email))
        .limit(1);
      userContactId = contactResult.length > 0 ? contactResult[0].id : null;
    }

    // Apply role-based filtering
    let baseWhereClause: SQL | undefined;

    if (isAdmin) {
      // Admin: only contacts with matching locationId and not null
      if (currentUser.locationId) {
        baseWhereClause = and(
          eq(contact.locationId, currentUser.locationId),
          isNotNull(contact.locationId)
        );
      } else {
        // If admin has no locationId, they see no contacts
        baseWhereClause = sql`FALSE`;
      }
    } else {
      // Regular user: only their own contact
      baseWhereClause = eq(contact.email, session.user.email);
    }

    // ✅ Aggregate pledge totals per contact
    const pledgeSummary = db
      .select({
        contactId: pledge.contactId,
        totalPledgedUsd: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)`.as(
          "totalPledgedUsd"
        ),
        pledgeTotalPaidUsd: sql<number>`COALESCE(SUM(${pledge.totalPaidUsd}), 0)`.as(
          "pledgeTotalPaidUsd"
        ),
        currentBalanceUsd: sql<number>`COALESCE(SUM(${pledge.balanceUsd}), 0)`.as(
          "currentBalanceUsd"
        ),
      })
      .from(pledge)
      .groupBy(pledge.contactId)
      .as("pledgeSummary");

    // ✅ Aggregate manual donation totals per contact
    const manualDonationSummary = db
      .select({
        contactId: manualDonation.contactId,
        manualDonationTotalPaidUsd: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)`.as(
          "manualDonationTotalPaidUsd"
        ),
      })
      .from(manualDonation)
      .groupBy(manualDonation.contactId)
      .as("manualDonationSummary");

    // ✅ Search: match the entire input string against name (firstName, lastName, displayName), email, and phone fields
    const searchWhereClause = search
      ? or(
          ilike(contact.firstName, `%${search}%`),
          ilike(contact.lastName, `%${search}%`),
          ilike(contact.displayName, `%${search}%`),
          ilike(contact.email, `%${search}%`),
          ilike(contact.phone, `%${search}%`)
        )
      : undefined;

    // Combine base filtering with search
    const whereClause = baseWhereClause && searchWhereClause
      ? and(baseWhereClause, searchWhereClause)
      : baseWhereClause || searchWhereClause;

    const selectedFields = {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      title: contact.title,
      gender: contact.gender,
      address: contact.address,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
      totalPledgedUsd: pledgeSummary.totalPledgedUsd,
      totalPaidUsd: sql<number>`COALESCE(${pledgeSummary.pledgeTotalPaidUsd}, 0) + COALESCE(${manualDonationSummary.manualDonationTotalPaidUsd}, 0)`.as("totalPaidUsd"),
      currentBalanceUsd: pledgeSummary.currentBalanceUsd,
    };

    const query = db
      .select(selectedFields)
      .from(contact)
      .leftJoin(pledgeSummary, eq(contact.id, pledgeSummary.contactId))
      .leftJoin(manualDonationSummary, eq(contact.id, manualDonationSummary.contactId))
      .where(whereClause)
      .groupBy(
        contact.id,
        contact.firstName,
        contact.lastName,
        contact.displayName,
        contact.email,
        contact.phone,
        contact.title,
        contact.gender,
        contact.address,
        contact.createdAt,
        contact.updatedAt,
        pledgeSummary.totalPledgedUsd,
        pledgeSummary.pledgeTotalPaidUsd,
        pledgeSummary.currentBalanceUsd,
        manualDonationSummary.manualDonationTotalPaidUsd
      );

    let orderByField:
      | SQL<unknown>
      | Column<ColumnBaseConfig<ColumnDataType, string>, object, object>;
    switch (sortBy) {
      case "updatedAt":
        orderByField = selectedFields.updatedAt;
        break;
      case "displayName":
        orderByField = selectedFields.displayName;
        break;
      case "firstName":
        orderByField = selectedFields.firstName;
        break;
      case "lastName":
        orderByField = selectedFields.lastName;
        break;
      case "totalPledgedUsd":
        orderByField = sql`${pledgeSummary.totalPledgedUsd}`;
        break;
      default:
        orderByField = selectedFields.updatedAt;
    }

    const contactsQuery = query
      .orderBy(sortOrder === "asc" ? asc(orderByField) : desc(orderByField))
      .limit(limit)
      .offset(offset);

    const countQuery = db
      .select({
        count: sql<number>`count(distinct ${contact.id})`.as("count"),
      })
      .from(contact)
      .where(whereClause);
      
    const [contacts, totalCountResult] = await Promise.all([
      contactsQuery.execute(),
      countQuery.execute(),
    ]);

    const totalCount = Number(totalCountResult[0]?.count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    // Calculate total pledged amount across all contacts (filtered by location for admin)
    let totalPledgedWhereClause: SQL | undefined;
    if (isAdmin) {
      if (currentUser.locationId) {
        totalPledgedWhereClause = and(
          eq(pledge.contactId, contact.id),
          eq(contact.locationId, currentUser.locationId)
        );
      } else {
        // If admin has no locationId, no pledges should be counted
        totalPledgedWhereClause = sql`FALSE`;
      }
    }

    const totalPledgedQuery = db
      .select({
        totalPledgedUsd: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)`.as(
          "totalPledgedUsd"
        ),
      })
      .from(pledge)
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(totalPledgedWhereClause);

    const totalPledgedResult = await totalPledgedQuery.execute();
    const totalPledgedAmount = Number(totalPledgedResult[0]?.totalPledgedUsd || 0);

    // Calculate total paid amount across all contacts (pledges + manual donations, filtered by location for admin)
    let totalPaidWhereClause: SQL | undefined;
    if (isAdmin) {
      if (currentUser.locationId) {
        totalPaidWhereClause = eq(contact.locationId, currentUser.locationId);
      } else {
        // If admin has no locationId, no payments should be counted
        totalPaidWhereClause = sql`FALSE`;
      }
    }

    // Calculate total paid amount from actual payments (not pledge.totalPaidUsd)
    const totalPaidQuery = db
      .select({
        totalPaidUsd: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0) + COALESCE(SUM(${manualDonation.amountUsd}), 0)`.as(
          "totalPaidUsd"
        ),
      })
      .from(contact)
      .leftJoin(pledge, eq(pledge.contactId, contact.id))
      .leftJoin(payment, eq(payment.pledgeId, pledge.id))
      .leftJoin(manualDonation, eq(manualDonation.contactId, contact.id))
      .where(totalPaidWhereClause);

    const totalPaidResult = await totalPaidQuery.execute();
    const totalPaidAmount = Number(totalPaidResult[0]?.totalPaidUsd || 0);

    // Calculate contacts with pledges (filtered by location for admin)
    let contactsWithPledgesWhereClause: SQL | undefined;
    if (isAdmin) {
      if (currentUser.locationId) {
        contactsWithPledgesWhereClause = and(
          sql`${pledge.originalAmountUsd} > 0`,
          eq(contact.locationId, currentUser.locationId)
        );
      } else {
        // If admin has no locationId, no contacts with pledges should be counted
        contactsWithPledgesWhereClause = sql`FALSE`;
      }
    } else {
      contactsWithPledgesWhereClause = sql`${pledge.originalAmountUsd} > 0`;
    }

    const contactsWithPledgesQuery = db
      .select({
        count: sql<number>`COUNT(DISTINCT ${pledge.contactId})`.as("count"),
      })
      .from(pledge)
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(contactsWithPledgesWhereClause);

    const contactsWithPledgesResult = await contactsWithPledgesQuery.execute();
    const contactsWithPledges = Number(contactsWithPledgesResult[0]?.count || 0);

    // Calculate recent contacts (last 30 days, filtered by location for admin)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let recentContactsWhereClause: SQL | undefined = sql`${contact.createdAt} >= ${thirtyDaysAgo}`;
    if (isAdmin && currentUser.locationId) {
      recentContactsWhereClause = and(
        sql`${contact.createdAt} >= ${thirtyDaysAgo}`,
        eq(contact.locationId, currentUser.locationId)
      );
    }

    const recentContactsQuery = db
      .select({
        count: sql<number>`COUNT(*)`.as("count"),
      })
      .from(contact)
      .where(recentContactsWhereClause);

    const recentContactsResult = await recentContactsQuery.execute();
    const recentContacts = Number(recentContactsResult[0]?.count || 0);

    return NextResponse.json({
      contacts: contacts as ContactResponse[],
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      summary: {
        totalContacts: totalCount,
        totalPledgedAmount,
        totalPaidAmount,
        contactsWithPledges,
        recentContacts,
      },
    });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch contacts",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validatedData = contactFormSchema.parse(body);
    const newContact: NewContact = {
      firstName: validatedData.firstName,
      lastName: validatedData.lastName,
      email: validatedData.email,
      phone: validatedData.phone,
      title: validatedData.title,
      gender: validatedData.gender,
      address: validatedData.address,
    };

    const result = await db.insert(contact).values(newContact).returning();

    return NextResponse.json(
      {
        message: "Contact created successfully",
        contact: result[0],
      },
      { status: 201 }
    );
  } catch (error) {
    return ErrorHandler.handle(error);
  }
}
