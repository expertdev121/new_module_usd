import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, sql, or, and, isNotNull } from "drizzle-orm";

import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { isRevenueStatus } from "@/lib/reports/donations-source";

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
  ghlContactId: string | null;
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
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, session.user.email))
      .limit(1);

    if (userDetails.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Use role/locationId from the session token, NOT a fresh DB lookup by
    // email. The JWT already reflects impersonation correctly (see the
    // `jwt` callback in lib/auth.ts, which swaps role -> "admin" and
    // locationId -> the impersonated tenant's location when a super admin
    // switches accounts). Re-querying the `user` table by email instead
    // returns the super admin's REAL role ("super_admin") and REAL
    // locationId, which silently ignores impersonation and falls into the
    // non-admin branch below (matching contacts by the super admin's own
    // email) — this was why the Donors list showed only a handful of
    // unrelated contacts while impersonating a tenant, instead of that
    // tenant's actual contacts. app/api/donations/route.ts already reads
    // session.user.locationId directly and does not have this bug.
    const currentUser = {
      role: session.user.role,
      locationId: session.user.locationId ?? null,
    };
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

    // Role filtering. We ALWAYS exclude soft-deleted contacts (deleted_at
    // IS NOT NULL means the contact was deleted in GHL and synced via
    // ContactDelete webhook). The row stays for audit but doesn't appear
    // in any UI view. `deleted_at` is added to the contact table by
    // migration 0019 but isn't part of the canonical schema.ts def — we
    // reference it via raw SQL to avoid touching the main schema file.
    let baseWhereClause: SQL | undefined;
    const notDeleted = sql`"contact"."deleted_at" IS NULL`;

    if (isAdmin) {
      if (currentUser.locationId) {
        baseWhereClause = and(
          eq(contact.locationId, currentUser.locationId),
          isNotNull(contact.locationId),
          notDeleted,
        );
      } else {
        baseWhereClause = sql`FALSE`;
      }
    } else {
      baseWhereClause = and(eq(contact.email, session.user.email), notDeleted);
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
      ghlContactId: contact.ghlContactId,
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
        contact.ghlContactId,
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
      // Exclude refunded/failed/cancelled from the org-wide "Total Paid" card.
      .where(and(totalPaidWhereClause, isRevenueStatus(payment.paymentStatus)))
      .groupBy(contact.id)
      .as("pledgePayments");

    const manualDonationsQuery = db
      .select({
        contactId: contact.id,
        totalManualDonations: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)`.as("totalManualDonations"),
      })
      .from(contact)
      .leftJoin(manualDonation, eq(manualDonation.contactId, contact.id))
      // Exclude refunded/failed/cancelled from the org-wide "Total Paid" card.
      .where(and(totalPaidWhereClause, isRevenueStatus(manualDonation.paymentStatus)))
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
    const session = await getServerSession(authOptions);
    const sessionLocationId = session?.user?.locationId ?? null;

    const body = await request.json();
    const validatedData = contactFormSchema.parse(body);

    // Use firstName and lastName directly from the form.
    // CRITICAL: set locationId so the new contact shows up in the
    // location-scoped list query (GET /api/contacts filters by
    // contact.locationId = session.user.locationId — without this
    // the contact is created but invisible to its own admin).
    const newContact: NewContact = {
      firstName: validatedData.firstName,
      lastName: validatedData.lastName,
      displayName: validatedData.displayName || null,
      email: validatedData.email,
      phone: validatedData.phone,
      gender: validatedData.gender,
      address: validatedData.address,
      locationId: sessionLocationId,
    };

    // ── Dedup cascade (standardized 2026-08-14) ─────────────────────────────
    // location_id + email → phone (only when no email) → constituents_id.
    // If the person already exists in this tenant, UPDATE that row with the
    // submitted fields instead of inserting a duplicate.
    let createdContact;
    let dedupAction: "created" | "updated" = "created";
    if (sessionLocationId) {
      const { resolveContact } = await import("@/lib/contacts/resolve-contact");
      const resolved = await resolveContact(
        {
          locationId: sessionLocationId,
          email: newContact.email,
          phone: newContact.phone,
        },
        { createIfMissing: false },
      );
      if (resolved.contactId != null) {
        const [updated] = await db
          .update(contact)
          .set({
            firstName: newContact.firstName,
            lastName: newContact.lastName,
            displayName: newContact.displayName,
            email: newContact.email ?? undefined,
            phone: newContact.phone ?? undefined,
            gender: newContact.gender,
            address: newContact.address ?? undefined,
            updatedAt: new Date(),
          })
          .where(eq(contact.id, resolved.contactId))
          .returning();
        createdContact = updated;
        dedupAction = "updated";
      }
    }
    if (!createdContact) {
      const result = await db.insert(contact).values(newContact).returning();
      createdContact = result[0];
    }

    // ── DonorHQ → GHL outbound push ─────────────────────────────────────────
    // Two-way sync: push this new contact to the admin's GHL sub-account.
    // GHL's /contacts/upsert dedups on email/phone — if a matching row
    // already exists in GHL, we link to it instead of creating a duplicate.
    //
    // - Requires the user to be logged in with a locationId on their session
    //   (admins always are; non-admin contact creates from public flows skip)
    // - Requires email or phone (GHL upsert refuses otherwise — typed contact
    //   form already validates email)
    // - Inline-first with a 2.5s budget; if GHL is slow, falls back to the
    //   ghl_backfill_jobs queue so the cron worker can retry without
    //   making the user wait.
    let outboundSync: { mode: string; ghlContactId?: string; error?: string } | null = null;
    if (!sessionLocationId) {
      outboundSync = {
        mode: "skipped_no_session_location",
        error: "No locationId on your session — cannot identify a GHL sub-account",
      };
    } else if (!newContact.email && !newContact.phone) {
      outboundSync = {
        mode: "skipped_no_email_or_phone",
        error:
          "GHL needs at least an email or phone to dedup the contact. Add one to enable sync.",
      };
    } else {
      try {
        const { pushContactUpsert } = await import("@/lib/ghl/push-contact");
        outboundSync = await pushContactUpsert(
          createdContact.id,
          sessionLocationId,
          {
            firstName: newContact.firstName,
            lastName: newContact.lastName,
            email: newContact.email,
            phone: newContact.phone,
            address1: newContact.address ?? null,
            tags: validatedData.tagIds && validatedData.tagIds.length > 0
              ? await resolveTagNames(validatedData.tagIds)
              : undefined,
          },
        );
      } catch (pushErr) {
        // Never break the create — log + carry on. The user's contact is
        // already in DonorHQ; sync can be retried from the admin panel.
        const message =
          pushErr instanceof Error ? pushErr.message : String(pushErr);
        console.error(
          `[contacts.POST] outbound GHL push threw for new contact ${createdContact.id}: ${message}`,
        );
        outboundSync = { mode: "error", error: message.slice(0, 500) };
      }
    }

    // Detailed audit with full contact data
    await import("@/lib/audit").then(({ logAudit }) =>
      logAudit("contact_create", {
        contactId: createdContact.id,
        contactName: `${newContact.firstName} ${newContact.lastName}`,
        contactData: createdContact,
        ghlSync: outboundSync,
      })
    );

    return NextResponse.json(
      {
        message:
          dedupAction === "updated"
            ? "A contact with this email/phone already existed in your account — it was updated instead of duplicated."
            : "Contact created successfully",
        contact: createdContact,
        action: dedupAction,
        ghlSync: outboundSync,
      },
      { status: 201 }
    );
  } catch (error) {
    return ErrorHandler.handle(error);
  }
}

/**
 * Look up tag names for a list of tag IDs. Used by the GHL outbound path
 * because GHL accepts tag NAMES, not IDs.
 */
async function resolveTagNames(tagIds: number[]): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const { tag } = await import("@/lib/db/schema");
  const { inArray } = await import("drizzle-orm");
  const rows = await db
    .select({ name: tag.name })
    .from(tag)
    .where(inArray(tag.id, tagIds));
  return rows.map((r) => r.name).filter((n): n is string => Boolean(n));
}
