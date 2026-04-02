import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, sql, or, and, isNotNull } from "drizzle-orm";

import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

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
  currency: string | null;
  recentPaymentDate: string | null;
}

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z
    .enum([
      "updatedAt",
      "firstName",
      "lastName",
      "displayName",
      "fullName",
      "email",
      "phone",
      "totalPledgedUsd",
      "totalPaidUsd",
      "recentPaymentDate",
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
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      sortBy: searchParams.get("sortBy") ?? undefined,
      sortOrder: searchParams.get("sortOrder") ?? undefined,
    });

    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsedParams.error },
        { status: 400 }
      );
    }

    const { page, limit, search, startDate, endDate, sortBy, sortOrder } = parsedParams.data;
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

    let userContactId: number | null = null;
    if (!isAdmin) {
      const contactResult = await db
        .select({ id: contact.id })
        .from(contact)
        .where(eq(contact.email, session.user.email))
        .limit(1);
      userContactId = contactResult.length > 0 ? contactResult[0].id : null;
    }

    // Role filtering
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
      baseWhereClause = eq(contact.email, session.user.email);
    }

    // Aggregations with currency
    const pledgeSummary = db
      .select({
        contactId: pledge.contactId,
        totalPledgedUsd: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)`.as("totalPledgedUsd"),
        currentBalanceUsd: sql<number>`COALESCE(SUM(${pledge.balanceUsd}), 0)`.as("currentBalanceUsd"),
        currency: sql<string>`(
          SELECT ${pledge.currency} 
          FROM ${pledge} p2 
          WHERE p2.contact_id = ${pledge.contactId} 
          LIMIT 1
        )`.as("currency"),
      })
      .from(pledge)
      .groupBy(pledge.contactId)
      .as("pledgeSummary");

    const paymentDateExpression = sql`COALESCE(${payment.receivedDate}, ${payment.paymentDate})`;
    const manualDonationDateExpression = sql`COALESCE(${manualDonation.receivedDate}, ${manualDonation.paymentDate})`;

    const paymentFilters: SQL[] = [eq(payment.paymentStatus, "completed")];
    if (startDate) {
      paymentFilters.push(sql`${paymentDateExpression} >= ${startDate}`);
    }
    if (endDate) {
      paymentFilters.push(sql`${paymentDateExpression} <= ${endDate}`);
    }

    const paymentSummary = db
      .select({
        contactId: pledge.contactId,
        paymentTotalPaidUsd: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)`.as("paymentTotalPaidUsd"),
        recentPaymentDate: sql<string | null>`MAX(${paymentDateExpression})`.as("recentPaymentDate"),
      })
      .from(payment)
      .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
      .where(and(...paymentFilters))
      .groupBy(pledge.contactId)
      .as("paymentSummary");

    const manualDonationFilters: SQL[] = [eq(manualDonation.paymentStatus, "completed")];
    if (startDate) {
      manualDonationFilters.push(sql`${manualDonationDateExpression} >= ${startDate}`);
    }
    if (endDate) {
      manualDonationFilters.push(sql`${manualDonationDateExpression} <= ${endDate}`);
    }

    const manualDonationSummary = db
      .select({
        contactId: manualDonation.contactId,
        manualDonationTotalPaidUsd: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)`.as("manualDonationTotalPaidUsd"),
        recentManualDonationDate: sql<string | null>`MAX(${manualDonationDateExpression})`.as("recentManualDonationDate"),
      })
      .from(manualDonation)
      .where(and(...manualDonationFilters))
      .groupBy(manualDonation.contactId)
      .as("manualDonationSummary");

    // Search
    const normalizedSearch = search?.trim().toLowerCase();
    const searchWhereClause = normalizedSearch
      ? or(
        sql`lower(${contact.firstName}) like ${`%${normalizedSearch}%`}`,
        sql`lower(${contact.lastName}) like ${`%${normalizedSearch}%`}`,
        sql`lower(${contact.displayName}) like ${`%${normalizedSearch}%`}`,
        sql`lower(${contact.ghlContactId}) like ${`%${normalizedSearch}%`}`,
        sql`lower(${contact.email}) like ${`%${normalizedSearch}%`}`,
        sql`lower(${contact.phone}) like ${`%${normalizedSearch}%`}`,
        sql`${contact.id}::text like ${`%${normalizedSearch}%`}`,
        // Tag search
        sql`EXISTS (
          SELECT 1 FROM contact_tags ct 
          JOIN tag t ON ct.tag_id = t.id 
          WHERE ct.contact_id = ${contact.id} 
          AND lower(t.name) like ${`%${normalizedSearch}%`}
        )`
      )
      : undefined;

    const whereClause =
      baseWhereClause && searchWhereClause
        ? and(baseWhereClause, searchWhereClause)
        : baseWhereClause || searchWhereClause;

    const recentPaymentDateField = sql<string | null>`
      CASE
        WHEN ${paymentSummary.recentPaymentDate} IS NULL THEN ${manualDonationSummary.recentManualDonationDate}
        WHEN ${manualDonationSummary.recentManualDonationDate} IS NULL THEN ${paymentSummary.recentPaymentDate}
        ELSE GREATEST(${paymentSummary.recentPaymentDate}, ${manualDonationSummary.recentManualDonationDate})
      END
    `;

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
      totalPaidUsd: sql<number>`
        COALESCE(${paymentSummary.paymentTotalPaidUsd}, 0)
        + 
        COALESCE(${manualDonationSummary.manualDonationTotalPaidUsd}, 0)
      `.as("totalPaidUsd"),
      currentBalanceUsd: pledgeSummary.currentBalanceUsd,
      currency: pledgeSummary.currency,
      recentPaymentDate: recentPaymentDateField.as("recentPaymentDate"),
      tags: sql<Array<{id: number; name: string}>>`
        COALESCE(
          (SELECT json_agg(json_build_object('id', t.id, 'name', t.name))
           FROM contact_tags ct
           JOIN tag t ON ct.tag_id = t.id
           WHERE ct.contact_id = ${contact.id}),
          '[]'::json
        )
      `.as("tags"),
    };

    const donationActivityFilter =
      startDate || endDate
        ? or(
            isNotNull(paymentSummary.recentPaymentDate),
            isNotNull(manualDonationSummary.recentManualDonationDate)
          )
        : undefined;

    const finalWhereClause =
      whereClause && donationActivityFilter
        ? and(whereClause, donationActivityFilter)
        : whereClause || donationActivityFilter;

    const query = db
      .select(selectedFields)
      .from(contact)
      .leftJoin(pledgeSummary, eq(contact.id, pledgeSummary.contactId))
      .leftJoin(paymentSummary, eq(contact.id, paymentSummary.contactId))
      .leftJoin(manualDonationSummary, eq(contact.id, manualDonationSummary.contactId))
      .where(finalWhereClause)
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
        sql`${pledgeSummary.totalPledgedUsd}`,
        sql`${pledgeSummary.currentBalanceUsd}`,
        sql`${pledgeSummary.currency}`,
        sql`${paymentSummary.paymentTotalPaidUsd}`,
        sql`${paymentSummary.recentPaymentDate}`,
        sql`${manualDonationSummary.manualDonationTotalPaidUsd}`
        ,
        sql`${manualDonationSummary.recentManualDonationDate}`
      );

    let orderByClauses: SQL[];

    switch (sortBy) {
      case "displayName":
      case "fullName":
      case "lastName":
        orderByClauses = [
          sortOrder === "asc"
            ? sql`${contact.lastName} IS NULL ASC, lower(${contact.lastName}) ASC NULLS LAST`
            : sql`${contact.lastName} IS NULL ASC, lower(${contact.lastName}) DESC NULLS LAST`,
          sortOrder === "asc"
            ? sql`${contact.firstName} IS NULL ASC, lower(${contact.firstName}) ASC NULLS LAST`
            : sql`${contact.firstName} IS NULL ASC, lower(${contact.firstName}) DESC NULLS LAST`,
        ];
        break;
      case "firstName":
        orderByClauses = [
          sortOrder === "asc"
            ? sql`${contact.firstName} IS NULL ASC, lower(${contact.firstName}) ASC NULLS LAST`
            : sql`${contact.firstName} IS NULL ASC, lower(${contact.firstName}) DESC NULLS LAST`,
          sortOrder === "asc"
            ? sql`${contact.lastName} IS NULL ASC, lower(${contact.lastName}) ASC NULLS LAST`
            : sql`${contact.lastName} IS NULL ASC, lower(${contact.lastName}) DESC NULLS LAST`,
        ];
        break;
      case "email":
        orderByClauses = [
          sortOrder === "asc"
            ? sql`${contact.email} IS NULL ASC, lower(${contact.email}) ASC NULLS LAST`
            : sql`${contact.email} IS NULL ASC, lower(${contact.email}) DESC NULLS LAST`,
        ];
        break;
      case "phone":
        orderByClauses = [
          sortOrder === "asc"
            ? sql`${contact.phone} IS NULL ASC, ${contact.phone} ASC NULLS LAST`
            : sql`${contact.phone} IS NULL ASC, ${contact.phone} DESC NULLS LAST`,
        ];
        break;
      case "totalPledgedUsd":
        orderByClauses = [
          sortOrder === "asc"
            ? sql`${selectedFields.totalPledgedUsd} ASC NULLS LAST`
            : sql`${selectedFields.totalPledgedUsd} DESC NULLS LAST`,
          sql`lower(${contact.lastName}) ASC NULLS LAST`,
          sql`lower(${contact.firstName}) ASC NULLS LAST`,
        ];
        break;
      case "totalPaidUsd":
        orderByClauses = [
          sortOrder === "asc"
            ? sql`${selectedFields.totalPaidUsd} ASC NULLS LAST`
            : sql`${selectedFields.totalPaidUsd} DESC NULLS LAST`,
          sql`${selectedFields.recentPaymentDate} DESC NULLS LAST`,
          sql`lower(${contact.lastName}) ASC NULLS LAST`,
          sql`lower(${contact.firstName}) ASC NULLS LAST`,
        ];
        break;
      case "recentPaymentDate":
        orderByClauses = [
          sortOrder === "asc"
            ? sql`${selectedFields.recentPaymentDate} ASC NULLS LAST`
            : sql`${selectedFields.recentPaymentDate} DESC NULLS LAST`,
          sql`${selectedFields.totalPaidUsd} DESC NULLS LAST`,
          sql`lower(${contact.lastName}) ASC NULLS LAST`,
          sql`lower(${contact.firstName}) ASC NULLS LAST`,
        ];
        break;
      case "updatedAt":
      default:
        orderByClauses = [
          sortOrder === "asc"
            ? sql`${selectedFields.updatedAt} ASC NULLS LAST`
            : sql`${selectedFields.updatedAt} DESC NULLS LAST`,
        ];
    }

    const contactsQuery = query.orderBy(...orderByClauses).limit(limit).offset(offset);

    const countQuery = db
      .select({
        count: sql<number>`count(distinct ${contact.id})`.as("count"),
      })
      .from(contact)
      .leftJoin(paymentSummary, eq(contact.id, paymentSummary.contactId))
      .leftJoin(manualDonationSummary, eq(contact.id, manualDonationSummary.contactId))
      .where(finalWhereClause);

    const [contacts, totalCountResult] = await Promise.all([
      contactsQuery.execute(),
      countQuery.execute(),
    ]);

    const totalCount = Number(totalCountResult[0]?.count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    // --- Summary Values (unchanged) ---

    let totalPledgedWhereClause: SQL | undefined;
    if (isAdmin) {
      if (currentUser.locationId) {
        totalPledgedWhereClause = and(
          eq(pledge.contactId, contact.id),
          eq(contact.locationId, currentUser.locationId)
        );
      } else {
        totalPledgedWhereClause = sql`FALSE`;
      }
    }

    const totalPledgedQuery = db
      .select({
        totalPledgedUsd: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)`.as("totalPledgedUsd"),
      })
      .from(pledge)
      .innerJoin(contact, eq(pledge.contactId, contact.id))
      .where(totalPledgedWhereClause);

    const totalPledgedResult = await totalPledgedQuery.execute();
    const totalPledgedAmount = Number(totalPledgedResult[0]?.totalPledgedUsd || 0);

    let totalPaidWhereClause: SQL | undefined;
    if (isAdmin) {
      if (currentUser.locationId) {
        totalPaidWhereClause = eq(contact.locationId, currentUser.locationId);
      } else {
        totalPaidWhereClause = sql`FALSE`;
      }
    }

    const pledgePaymentsQuery = db
      .select({
        contactId: contact.id,
        totalPledgePayments: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)`.as("totalPledgePayments"),
      })
      .from(contact)
      .leftJoin(pledge, eq(pledge.contactId, contact.id))
      .leftJoin(payment, eq(payment.pledgeId, pledge.id))
      .where(totalPaidWhereClause)
      .groupBy(contact.id)
      .as("pledgePayments");

    const manualDonationsQuery = db
      .select({
        contactId: contact.id,
        totalManualDonations: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)`.as("totalManualDonations"),
      })
      .from(contact)
      .leftJoin(manualDonation, eq(manualDonation.contactId, contact.id))
      .where(totalPaidWhereClause)
      .groupBy(contact.id)
      .as("manualDonations");

    const totalPaidQuery = db
      .select({
        totalPaidUsd: sql<number>`
          COALESCE(SUM(${pledgePaymentsQuery.totalPledgePayments}), 0)
          +
          COALESCE(SUM(${manualDonationsQuery.totalManualDonations}), 0)
        `.as("totalPaidUsd"),
      })
      .from(pledgePaymentsQuery)
      .fullJoin(
        manualDonationsQuery,
        eq(pledgePaymentsQuery.contactId, manualDonationsQuery.contactId)
      );

    const totalPaidResult = await totalPaidQuery.execute();
    const totalPaidAmount = Number(totalPaidResult[0]?.totalPaidUsd || 0);

    let contactsWithPledgesWhereClause: SQL | undefined;
    if (isAdmin) {
      if (currentUser.locationId) {
        contactsWithPledgesWhereClause = and(
          sql`${pledge.originalAmountUsd} > 0`,
          eq(contact.locationId, currentUser.locationId)
        );
      } else {
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

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let recentContactsWhereClause: SQL | undefined =
      sql`${contact.createdAt} >= ${thirtyDaysAgo}`;

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

    // Use firstName and lastName directly from the form
    const newContact: NewContact = {
      firstName: validatedData.firstName,
      lastName: validatedData.lastName,
      displayName: validatedData.displayName || null,
      email: validatedData.email,
      phone: validatedData.phone,
      gender: validatedData.gender,
      address: validatedData.address,
    };

    const result = await db.insert(contact).values(newContact).returning();
    
    // Detailed audit with full contact data
    await import("@/lib/audit").then(({ logAudit }) => 
      logAudit("contact_create", {
        contactId: result[0].id,
        contactName: `${newContact.firstName} ${newContact.lastName}`,
        contactData: result[0]
      })
    );

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
