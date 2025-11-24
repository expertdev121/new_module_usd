import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, sql, or, and, isNotNull, gt, type SQL } from "drizzle-orm";
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
  startDate: z.string().optional(),
  endDate: z.string().optional(),
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
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
    });

    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsedParams.error },
        { status: 400 }
      );
    }

    const { page, limit, sortBy, sortOrder, search, startDate, endDate } = parsedParams.data;
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
    let baseWhereClause: SQL | undefined;
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

    // Helper function to create manual donation subquery with optional date filter parameters
    const createManualDonationSum = (startDate?: string, endDate?: string) => {
      let query = db
        .select({
          contactId: manualDonation.contactId,
          totalManualDonation: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)`.as(
            "totalManualDonation"
          ),
          maxManualDonationDate: sql<Date | null>`MAX(${manualDonation.paymentDate})`.as(
            "maxManualDonationDate"
          ),
        })
        .from(manualDonation);

      if (startDate && endDate) {
        query = query.where(
          and(
            sql`${manualDonation.paymentDate} >= ${startDate}`,
            sql`${manualDonation.paymentDate} <= ${endDate}`
          )
        ) as typeof query;
      } else if (startDate) {
        query = query.where(sql`${manualDonation.paymentDate} >= ${startDate}`) as typeof query;
      } else if (endDate) {
        query = query.where(sql`${manualDonation.paymentDate} <= ${endDate}`) as typeof query;
      }

      return query.groupBy(manualDonation.contactId).as("manualDonationSum");
    };



    // Helper function to create payment subquery with optional date filter parameters
    const createPaymentSum = (startDate?: string, endDate?: string) => {
      let query = db
        .select({
          contactId: pledge.contactId,
          totalPayments: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)`.as(
            "totalPayments"
          ),
          maxPaymentDate: sql<Date | null>`MAX(${payment.paymentDate})`.as("maxPaymentDate"),
        })
        .from(payment)
        .innerJoin(pledge, eq(payment.pledgeId, pledge.id));
      if (startDate && endDate) {
        query = query.where(
          and(
            sql`${payment.paymentDate} >= ${startDate}`,
            sql`${payment.paymentDate} <= ${endDate}`
          )
        ) as typeof query;
      } else if (startDate) {
        query = query.where(sql`${payment.paymentDate} >= ${startDate}`) as typeof query;
      } else if (endDate) {
        query = query.where(sql`${payment.paymentDate} <= ${endDate}`) as typeof query;
      }
      return query.groupBy(pledge.contactId).as("paymentSum");
    };


// Helper to get the most recent manual donation amount per contact by joining on max donation date
const createMostRecentManualDonationAmount = (
  manualDonationSumAlias: ReturnType<typeof createManualDonationSum>
) => {
  return db
    .select({
      contactId: manualDonation.contactId,
      recentManualDonationAmount: manualDonation.amountUsd,
      recentManualDonationDate: manualDonation.paymentDate,
    })
    .from(manualDonation)
    .innerJoin(
      manualDonationSumAlias,
      and(
        eq(manualDonation.contactId, manualDonationSumAlias.contactId),
        eq(manualDonation.paymentDate, manualDonationSumAlias.maxManualDonationDate)
      )
    )
    .as("mostRecentManualDonationAmount");
};

// Helper to get the most recent payment amount per contact by joining on max payment date
const createMostRecentPaymentAmount = (
  paymentSumAlias: ReturnType<typeof createPaymentSum>
) => {
  return db
    .select({
      contactId: pledge.contactId,
      recentPaymentAmount: payment.amountUsd,
      recentPaymentDate: payment.paymentDate,
    })
    .from(payment)
    .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
    .innerJoin(
      paymentSumAlias,
      and(
        eq(pledge.contactId, paymentSumAlias.contactId),
        eq(payment.paymentDate, paymentSumAlias.maxPaymentDate)
      )
    )
    .as("mostRecentPaymentAmount");
};

    // Create subqueries for main query
    const manualDonationSum = createManualDonationSum(startDate, endDate);
    const paymentSum = createPaymentSum(startDate, endDate);

    const mostRecentManualDonationAmount = createMostRecentManualDonationAmount(manualDonationSum);
    const mostRecentPaymentAmount = createMostRecentPaymentAmount(paymentSum);

    // Build where conditions array
    const whereConditions = [];
    if (baseWhereClause) {
      whereConditions.push(baseWhereClause);
    }
    if (searchWhereClause) {
      whereConditions.push(searchWhereClause);
    }

    // Main query selecting contacts, joining totals and recent donations
    const baseSelect = {
      id: contact.id,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      address: contact.address,
      totalManualDonation: manualDonationSum.totalManualDonation,
      totalPayments: paymentSum.totalPayments,
      maxManualDonationDate: manualDonationSum.maxManualDonationDate,
      maxPaymentDate: paymentSum.maxPaymentDate,
      // Add recent donation amounts from the new subqueries
      recentManualDonationAmount: mostRecentManualDonationAmount.recentManualDonationAmount,
      recentManualDonationDate: mostRecentManualDonationAmount.recentManualDonationDate,
      recentPaymentAmount: mostRecentPaymentAmount.recentPaymentAmount,
      recentPaymentDate: mostRecentPaymentAmount.recentPaymentDate,
    };

    const query = db
      .select(baseSelect)
      .from(contact)
      .leftJoin(manualDonationSum, eq(contact.id, manualDonationSum.contactId))
      .leftJoin(paymentSum, eq(contact.id, paymentSum.contactId))
      .leftJoin(
        mostRecentManualDonationAmount,
        eq(contact.id, mostRecentManualDonationAmount.contactId)
      )
      .leftJoin(mostRecentPaymentAmount, eq(contact.id, mostRecentPaymentAmount.contactId))
      .where(
        whereConditions.length > 0
          ? and(
              ...whereConditions,
              sql`(COALESCE(${manualDonationSum.totalManualDonation}, 0) + COALESCE(${paymentSum.totalPayments}, 0)) > 0`
            )
          : sql`(COALESCE(${manualDonationSum.totalManualDonation}, 0) + COALESCE(${paymentSum.totalPayments}, 0)) > 0`
      )
      .orderBy(
        sortBy === "mostRecentDonationDate"
          ? sortOrder === "asc"
            ? sql`GREATEST(COALESCE(${manualDonationSum.maxManualDonationDate}, '1900-01-01'), COALESCE(${paymentSum.maxPaymentDate}, '1900-01-01')) ASC`
            : sql`GREATEST(COALESCE(${manualDonationSum.maxManualDonationDate}, '1900-01-01'), COALESCE(${paymentSum.maxPaymentDate}, '1900-01-01')) DESC`
          : sortBy === "totalDonations"
          ? sortOrder === "asc"
            ? sql`(COALESCE(${manualDonationSum.totalManualDonation}, 0) + COALESCE(${paymentSum.totalPayments}, 0)) ASC`
            : sql`(COALESCE(${manualDonationSum.totalManualDonation}, 0) + COALESCE(${paymentSum.totalPayments}, 0)) DESC`
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

    // Create fresh subqueries for count query
    const manualDonationSumCount = createManualDonationSum(startDate, endDate);
    const paymentSumCount = createPaymentSum(startDate, endDate);

    // Count query
    const countQuery = db
      .select({
        totalCount: sql<number>`count(*)`.as("totalCount"),
      })
      .from(contact)
      .leftJoin(manualDonationSumCount, eq(contact.id, manualDonationSumCount.contactId))
      .leftJoin(paymentSumCount, eq(contact.id, paymentSumCount.contactId))
      .where(
        whereConditions.length > 0
          ? and(
              ...whereConditions,
              sql`(COALESCE(${manualDonationSumCount.totalManualDonation}, 0) + COALESCE(${paymentSumCount.totalPayments}, 0)) > 0`
            )
          : sql`(COALESCE(${manualDonationSumCount.totalManualDonation}, 0) + COALESCE(${paymentSumCount.totalPayments}, 0)) > 0`
      );

    const [rawContacts, totalCountResult] = await Promise.all([
      query.execute(),
      countQuery.execute(),
    ]);

    // Transform the results to compute derived fields
    const contacts = rawContacts.map((row) => {
      const totalDonations = (row.totalManualDonation || 0) + (row.totalPayments || 0);
      const mostRecentDonationDate =
        row.maxManualDonationDate && row.maxPaymentDate
          ? row.maxManualDonationDate > row.maxPaymentDate
            ? row.maxManualDonationDate
            : row.maxPaymentDate
          : row.maxManualDonationDate || row.maxPaymentDate || null;

      let mostRecentDonationAmount = null;
      if (row.recentManualDonationDate && row.recentPaymentDate) {
        mostRecentDonationAmount =
          row.recentManualDonationDate > row.recentPaymentDate
            ? row.recentManualDonationAmount
            : row.recentPaymentAmount;
      } else if (row.recentManualDonationDate) {
        mostRecentDonationAmount = row.recentManualDonationAmount;
      } else if (row.recentPaymentDate) {
        mostRecentDonationAmount = row.recentPaymentAmount;
      }

      return {
        id: row.id,
        displayName: row.displayName,
        email: row.email,
        phone: row.phone,
        address: row.address,
        totalDonations,
        mostRecentDonationDate,
        mostRecentDonationAmount,
      };
    });

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