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
import { generateReportPDF, generateReportFilename } from "@/lib/pdf-report-generator";

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
  minAmount: z.coerce.number().optional(),
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
      minAmount: searchParams.get("minAmount") ?? undefined,
    });

    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsedParams.error },
        { status: 400 }
      );
    }

    const { page, limit, sortBy, sortOrder, search, startDate, endDate, minAmount } = parsedParams.data;
    const offset = (page - 1) * limit;

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

    const manualDonationSum = createManualDonationSum(startDate, endDate);
    const paymentSum = createPaymentSum(startDate, endDate);

    const mostRecentManualDonationAmount = createMostRecentManualDonationAmount(manualDonationSum);
    const mostRecentPaymentAmount = createMostRecentPaymentAmount(paymentSum);

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

    const baseSelect = {
      id: contact.id,
      title: contact.title,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      address: contact.address,
      totalManualDonation: manualDonationSum.totalManualDonation,
      totalPayments: paymentSum.totalPayments,
      maxManualDonationDate: manualDonationSum.maxManualDonationDate,
      maxPaymentDate: paymentSum.maxPaymentDate,
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
      );

    const rawContacts = await query.execute();

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
        title: row.title,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        phone: row.phone,
        address: row.address,
        totalDonations,
        mostRecentDonationDate,
        mostRecentDonationAmount,
      };
    });

    const pdfData = contacts.map((item) => ({
      "Contact ID": item.id?.toString() || "",
      "Title": item.title || "",
      "First Name": item.firstName || "",
      "Last Name": item.lastName || "",
      "Email": item.email || "",
      "Phone": item.phone || "",
      "Address": item.address || "",
      "Total Donations": parseFloat(item.totalDonations?.toString() || "0").toFixed(2),
      "Most Recent Donation Date": item.mostRecentDonationDate
        ? new Date(item.mostRecentDonationDate).toLocaleDateString("en-US")
        : "",
      "Most Recent Donation Amount": item.mostRecentDonationAmount
        ? parseFloat(item.mostRecentDonationAmount.toString()).toFixed(2)
        : "",
    }));

    const pdfBuffer = generateReportPDF({
      title: "Contacts Donations Report",
      subtitle: `Contacts Donations Report${
        startDate && endDate ? ` - ${startDate} to ${endDate}` : ""
      }`,
      data: pdfData,
      filename: generateReportFilename("contacts-donations"),
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${generateReportFilename(
          "contacts-donations"
        )}"`,
      },
    });
  } catch (error) {
    console.error("Error generating contacts-donations PDF:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
