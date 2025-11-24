import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, sql, or, and, isNotNull, desc } from "drizzle-orm";
import {
  contact,
  pledge,
  manualDonation,
  payment,
  user,
} from "@/lib/db/schema";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  sortBy: z
    .enum([
      "updatedAt",
      "displayName",
      "totalDonations",
      "mostRecentDonationDate",
    ])
    .default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().optional(),
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
      sortBy: searchParams.get("sortBy") ?? undefined,
      sortOrder: searchParams.get("sortOrder") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });

    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsedParams.error },
        { status: 400 }
      );
    }

    const { page, limit, sortBy, sortOrder, search } = parsedParams.data;
    const offset = (page - 1) * limit;

    // Get current user and role for filtering
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

    // Base where clause with location filtering if admin
    let baseWhereClause: any;
    if (isAdmin) {
      if (currentUser.locationId) {
        baseWhereClause = and(
          eq(contact.locationId, currentUser.locationId),
          isNotNull(contact.locationId)
        );
      } else {
        baseWhereClause = sql`FALSE`;
      }
    } else {
      baseWhereClause = sql`FALSE`;
    }

    // Search filtering
    const normalizedSearch = search?.trim().toLowerCase();
    const searchWhereClause = normalizedSearch
      ? or(
          sql`lower(${contact.firstName}) like ${`%${normalizedSearch}%`}`,
          sql`lower(${contact.lastName}) like ${`%${normalizedSearch}%`}`,
          sql`lower(${contact.displayName}) like ${`%${normalizedSearch}%`}`,
          sql`lower(${contact.email}) like ${`%${normalizedSearch}%`}`,
          sql`lower(${contact.phone}) like ${`%${normalizedSearch}%`}`,
          sql`lower(${contact.address}) like ${`%${normalizedSearch}%`}`
        )
      : undefined;

    // Helper function to create manual donation subquery
    const createManualDonationSum = () =>
      db
        .select({
          contactId: manualDonation.contactId,
          totalManualDonation: sql`COALESCE(SUM(${manualDonation.amountUsd}), 0)`.as(
            "totalManualDonation"
          ),
          maxManualDonationDate: sql`MAX(${manualDonation.paymentDate})`.as(
            "maxManualDonationDate"
          ),
        })
        .from(manualDonation)
        .groupBy(manualDonation.contactId)
        .as("manualDonationSum");

    // Helper function to create payment subquery
    const createPaymentSum = () =>
      db
        .select({
          contactId: pledge.contactId,
          totalPayments: sql`COALESCE(SUM(${payment.amountUsd}), 0)`.as(
            "totalPayments"
          ),
          maxPaymentDate: sql`MAX(${payment.paymentDate})`.as("maxPaymentDate"),
        })
        .from(payment)
        .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
        .groupBy(pledge.contactId)
        .as("paymentSum");

    // Create subqueries for main query
    const manualDonationSum = createManualDonationSum();
    const paymentSum = createPaymentSum();

    const donationsPositiveClause = sql`(
      COALESCE(${manualDonationSum.totalManualDonation}, 0) +
      COALESCE(${paymentSum.totalPayments}, 0) > 0
    )`;

    const whereClause =
      baseWhereClause && searchWhereClause
        ? and(baseWhereClause, searchWhereClause, donationsPositiveClause)
        : baseWhereClause && donationsPositiveClause
        ? and(baseWhereClause, donationsPositiveClause)
        : searchWhereClause && donationsPositiveClause
        ? and(searchWhereClause, donationsPositiveClause)
        : donationsPositiveClause;

    // Main query selecting contacts, joining totals and recent donations
    const baseSelect = {
      id: contact.id,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      address: contact.address,
    };

    // Compute combined total donations and most recent donation date and amount per contact:
    // Coalesce totals from manualDonationSum and paymentSum
    // Pick latest date between maxManualDonationDate and maxPaymentDate and respective amount
    const query = db
      .select({
        ...baseSelect,
        totalDonations: sql`
          COALESCE(${manualDonationSum.totalManualDonation}, 0) +
          COALESCE(${paymentSum.totalPayments}, 0)
        `.as("totalDonations"),
        mostRecentDonationDate: sql`
          GREATEST(
            COALESCE(${manualDonationSum.maxManualDonationDate}, '1900-01-01'),
            COALESCE(${paymentSum.maxPaymentDate}, '1900-01-01')
          )
        `.as("mostRecentDonationDate"),
        mostRecentDonationAmount: sql`
          CASE
            WHEN COALESCE(${manualDonationSum.maxManualDonationDate}, '1900-01-01') >= 
                 COALESCE(${paymentSum.maxPaymentDate}, '1900-01-01')
            THEN (SELECT md.amount_usd
                  FROM ${manualDonation} md
                  WHERE md.contact_id = ${contact.id}
                  ORDER BY md.payment_date DESC
                  LIMIT 1)
            ELSE (SELECT p.amount_usd
                  FROM ${payment} p
                  INNER JOIN ${pledge} pl ON p.pledge_id = pl.id
                  WHERE pl.contact_id = ${contact.id}
                  ORDER BY p.payment_date DESC
                  LIMIT 1)
          END
        `.as("mostRecentDonationAmount"),
      })
      .from(contact)
      .leftJoin(manualDonationSum, eq(contact.id, manualDonationSum.contactId))
      .leftJoin(paymentSum, eq(contact.id, paymentSum.contactId))
      .where(whereClause)
      .orderBy(
        sortBy === "mostRecentDonationDate"
          ? sortOrder === "asc"
            ? sql`mostRecentDonationDate ASC`
            : sql`mostRecentDonationDate DESC`
          : sortBy === "totalDonations"
          ? sortOrder === "asc"
            ? sql`totalDonations ASC`
            : sql`totalDonations DESC`
          : sortBy === "displayName"
          ? sortOrder === "asc"
            ? sql`${contact.displayName} ASC`
            : sql`${contact.displayName} DESC`
          : sortOrder === "asc"
          ? sql`${contact.updatedAt} ASC`
          : sql`${contact.updatedAt} DESC`
      )
      .limit(limit)
      .offset(offset);

    // Create separate subqueries for count query
    const manualDonationSumCount = createManualDonationSum();
    const paymentSumCount = createPaymentSum();

    // Build separate where clause for count query
    const donationsPositiveClauseCount = sql`(
      COALESCE(${manualDonationSumCount.totalManualDonation}, 0) +
      COALESCE(${paymentSumCount.totalPayments}, 0) > 0
    )`;

    const whereClauseCount =
      baseWhereClause && searchWhereClause
        ? and(baseWhereClause, searchWhereClause, donationsPositiveClauseCount)
        : baseWhereClause && donationsPositiveClauseCount
        ? and(baseWhereClause, donationsPositiveClauseCount)
        : searchWhereClause && donationsPositiveClauseCount
        ? and(searchWhereClause, donationsPositiveClauseCount)
        : donationsPositiveClauseCount;

    // Count query - recreate with fresh subqueries and where clause
    const countQuery = db
      .select({
        totalCount: sql`count(*)`.as("totalCount"),
      })
      .from(contact)
      .leftJoin(manualDonationSumCount, eq(contact.id, manualDonationSumCount.contactId))
      .leftJoin(paymentSumCount, eq(contact.id, paymentSumCount.contactId))
      .where(whereClauseCount);

    const [contacts, totalCountResult] = await Promise.all([
      query.execute(),
      countQuery.execute(),
    ]);

    const totalCount = Number(totalCountResult[0]?.totalCount || 0);
    const totalPages = Math.ceil(totalCount / limit);

    return NextResponse.json({
      contacts,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching contacts-donations report:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch contacts-donations report",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}