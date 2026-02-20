import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, sql, or, and, isNotNull, type SQL } from "drizzle-orm";
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
import { stringify } from "csv-stringify/sync";

const querySchema = z.object({
  sortBy: z.enum([
    "updatedAt",
    "displayName",
    "totalDonations",
    "mostRecentDonationDate",
  ]).default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  minAmount: z.coerce.number().optional(),
});

const createManualDonationSum = (startDate?: string, endDate?: string) => {
  let query = db
    .select({
      contactId: manualDonation.contactId,
      totalManualDonation: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)`.as("totalManualDonation"),
      maxManualDonationDate: sql`MAX(${manualDonation.paymentDate})`.as("maxManualDonationDate"),
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

const createPaymentSum = (startDate?: string, endDate?: string) => {
  let query = db
    .select({
      contactId: pledge.contactId,
      totalPayments: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)`.as("totalPayments"),
      maxPaymentDate: sql`MAX(${payment.paymentDate})`.as("maxPaymentDate"),
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

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsedParams = querySchema.safeParse({
      sortBy: searchParams.get("sortBy") ?? undefined,
      sortOrder: searchParams.get("sortOrder") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      minAmount: searchParams.get("minAmount") ?? undefined,
    });

    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsedParams.error },
        { status: 400 }
      );
    }

    const { sortBy, sortOrder, search, startDate, endDate, minAmount } = parsedParams.data;

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

    // Use helper functions with date filtering
    const manualDonationSum = createManualDonationSum(startDate, endDate);
    const paymentSum = createPaymentSum(startDate, endDate);

    // Build where conditions array
    const whereConditions: SQL[] = [];
    if (baseWhereClause) {
      whereConditions.push(baseWhereClause);
    }
    if (searchWhereClause) {
      whereConditions.push(searchWhereClause);
    }
    if (minAmount) {
      whereConditions.push(
        sql`(COALESCE(${manualDonationSum.totalManualDonation}, 0) + COALESCE(${paymentSum.totalPayments}, 0)) >= ${minAmount}`
      );
    }

    // Main query selecting contacts, joining totals and recent donations
    const baseSelect = {
      id: contact.id,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      address: contact.address,
    };

    const query = db
      .select({
        ...baseSelect,
        totalDonations: sql<number>`
          COALESCE(${manualDonationSum.totalManualDonation}, 0) + COALESCE(${paymentSum.totalPayments}, 0)
        `.as("totalDonations"),
        mostRecentDonationDate: sql<Date | null>`
          GREATEST(
            COALESCE(${manualDonationSum.maxManualDonationDate}, '1900-01-01'),
            COALESCE(${paymentSum.maxPaymentDate}, '1900-01-01')
          )
        `.as("mostRecentDonationDate"),
        mostRecentDonationAmount: sql<number | null>`
          CASE 
            WHEN COALESCE(${manualDonationSum.maxManualDonationDate}, '1900-01-01') >= COALESCE(${paymentSum.maxPaymentDate}, '1900-01-01')
          THEN (SELECT md.amount_usd FROM ${manualDonation} md WHERE md.contact_id = ${contact.id} ORDER BY md.payment_date DESC LIMIT 1)
          ELSE (SELECT p.amount_usd FROM ${payment} p INNER JOIN ${pledge} pl ON p.pledge_id = pl.id WHERE pl.contact_id = ${contact.id} ORDER BY p.payment_date DESC LIMIT 1)
          END
        `.as("mostRecentDonationAmount"),
      })
      .from(contact)
      .leftJoin(manualDonationSum, eq(contact.id, manualDonationSum.contactId))
      .leftJoin(paymentSum, eq(contact.id, paymentSum.contactId))
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
          ? (sortOrder === "asc" ? sql`mostRecentDonationDate ASC` : sql`mostRecentDonationDate DESC`)
          : sortBy === "totalDonations"
          ? (sortOrder === "asc" ? sql`totalDonations ASC` : sql`totalDonations DESC`)
          : sortBy === "displayName"
          ? (sortOrder === "asc" ? sql`${contact.displayName} ASC` : sql`${contact.displayName} DESC`)
          : (sortOrder === "asc" ? sql`${contact.updatedAt} ASC` : sql`${contact.updatedAt} DESC`)
      );

    const contacts = await query.execute();

    // Prepare CSV data
    const csvData = contacts.map((row) => ({
      "Display Name": row.displayName ?? "",
      Email: row.email ?? "",
      "Phone Number": row.phone ?? "",
      Address: row.address ?? "",
      "Total Donations": Number(row.totalDonations)?.toFixed(2) ?? "0.00",
      "Most Recent Donation Date": row.mostRecentDonationDate
        ? new Date(row.mostRecentDonationDate).toISOString().slice(0, 10)
        : "",
      "Most Recent Donation Amount": Number(row.mostRecentDonationAmount)?.toFixed(2) ?? "0.00",
    }));

    // Generate CSV string
    const csv = stringify(csvData, { header: true });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="contacts-donations-report-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error("Error generating contacts donations CSV:", error);
    return NextResponse.json(
      {
        error: "Failed to generate CSV",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
