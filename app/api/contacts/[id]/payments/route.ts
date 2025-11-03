import { db } from "@/lib/db";
import { payment, pledge, paymentAllocations, contact, manualDonation } from "@/lib/db/schema";
import { eq, desc, or, ilike, and, SQL, sql, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const PaymentStatusEnum = z.enum([
  "pending",
  "completed",
  "failed",
  "cancelled",
  "refunded",
  "processing",
  "expected"
]);

const QueryParamsSchema = z.object({
  contactId: z.number().positive(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  search: z.string().optional(),
  paymentStatus: PaymentStatusEnum.optional(),
  showPaymentsMade: z.boolean().optional(),
  showPaymentsReceived: z.boolean().optional(),
});

type QueryParams = z.infer<typeof QueryParamsSchema>;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id?: string }> }
) {
  const { id } = await params;
  const contactId = id ? parseInt(id, 10) : null;
  const { searchParams } = new URL(request.url);
  
  try {
    const queryParams: QueryParams = QueryParamsSchema.parse({
      contactId: contactId,
      page: parseInt(searchParams.get("page") || "1", 10),
      limit: parseInt(searchParams.get("limit") || "10", 10),
      search: searchParams.get("search") || undefined,
      paymentStatus: searchParams.get("paymentStatus") || undefined,
      showPaymentsMade: searchParams.get("showPaymentsMade") === "true",
      showPaymentsReceived: searchParams.get("showPaymentsReceived") === "true",
    });

    const {
      contactId: contactIdNum,
      page,
      limit,
      search,
      paymentStatus,
      showPaymentsMade,
      showPaymentsReceived,
    } = queryParams;

    // Get pledges owned by this contact
    const pledges = await db
      .select({ id: pledge.id })
      .from(pledge)
      .where(eq(pledge.contactId, contactIdNum));

    const pledgeIds = pledges.map((p) => p.id);

    // ===== QUERY PAYMENTS =====
    let paymentsQuery = db
      .select({
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        amountUsd: payment.amountUsd,
        paymentDate: payment.paymentDate,
        receivedDate: payment.receivedDate,
        paymentMethod: payment.paymentMethod,
        methodDetail: payment.methodDetail,
        paymentStatus: payment.paymentStatus,
        referenceNumber: payment.referenceNumber,
        checkNumber: payment.checkNumber,
        receiptNumber: payment.receiptNumber,
        receiptIssued: payment.receiptIssued,
        notes: payment.notes,
        paymentPlanId: payment.paymentPlanId,
        pledgeId: payment.pledgeId,
        
        // Third-party payment fields
        isThirdPartyPayment: payment.isThirdPartyPayment,
        payerContactId: payment.payerContactId,
        
        // Get payer contact name for third-party payments
        payerContactName: sql<string>`(
          CASE 
            WHEN ${payment.payerContactId} IS NOT NULL THEN 
              (SELECT CONCAT(first_name, ' ', last_name)
               FROM ${contact} 
               WHERE id = ${payment.payerContactId})
            ELSE NULL
          END
        )`.as("payerContactName"),
        
        // Check if it's a split payment
        isSplitPayment: sql<boolean>`(
          SELECT COUNT(*) > 0 FROM ${paymentAllocations} WHERE payment_id = ${payment.id}
        )`.as("isSplitPayment"),
      })
      .from(payment)
      .$dynamic();

    // Apply payment filters
    const paymentConditions: SQL<unknown>[] = [];

    if (showPaymentsMade === true && showPaymentsReceived === false) {
      paymentConditions.push(eq(payment.payerContactId, contactIdNum));
    } else if (showPaymentsReceived === true && showPaymentsMade === false) {
      if (pledgeIds.length > 0) {
        paymentConditions.push(
          and(
            inArray(payment.pledgeId, pledgeIds),
            or(
              eq(payment.isThirdPartyPayment, false),
              sql`${payment.isThirdPartyPayment} IS NULL`
            )
          )!
        );
      }
    } else {
      const conditions: SQL<unknown>[] = [];
      conditions.push(eq(payment.payerContactId, contactIdNum));
      
      if (pledgeIds.length > 0) {
        conditions.push(
          and(
            inArray(payment.pledgeId, pledgeIds),
            or(
              eq(payment.isThirdPartyPayment, false),
              sql`${payment.isThirdPartyPayment} IS NULL`
            )
          )!
        );
      }
      
      if (conditions.length > 0) {
        paymentConditions.push(or(...conditions)!);
      }
    }

    // Additional payment filters
    if (paymentStatus) {
      paymentConditions.push(eq(payment.paymentStatus, paymentStatus));
    }

    if (search) {
      const searchConditions: SQL<unknown>[] = [];
      searchConditions.push(ilike(sql`COALESCE(${payment.notes}, '')`, `%${search}%`));
      searchConditions.push(ilike(sql`COALESCE(${payment.referenceNumber}, '')`, `%${search}%`));
      searchConditions.push(ilike(sql`COALESCE(${payment.checkNumber}, '')`, `%${search}%`));
      searchConditions.push(ilike(sql`COALESCE(${payment.receiptNumber}, '')`, `%${search}%`));
      paymentConditions.push(or(...searchConditions)!);
    }

    if (paymentConditions.length > 0) {
      paymentsQuery = paymentsQuery.where(and(...paymentConditions));
    }

    // ===== QUERY MANUAL DONATIONS =====
    let manualDonationsQuery = db
      .select({
        id: manualDonation.id,
        amount: manualDonation.amount,
        currency: manualDonation.currency,
        amountUsd: manualDonation.amountUsd,
        paymentDate: manualDonation.paymentDate,
        receivedDate: manualDonation.receivedDate,
        paymentMethod: manualDonation.paymentMethod,
        methodDetail: manualDonation.methodDetail,
        paymentStatus: manualDonation.paymentStatus,
        referenceNumber: manualDonation.referenceNumber,
        checkNumber: manualDonation.checkNumber,
        receiptNumber: manualDonation.receiptNumber,
        receiptIssued: manualDonation.receiptIssued,
        notes: manualDonation.notes,
        contactId: manualDonation.contactId,
        solicitorId: manualDonation.solicitorId,
        bonusAmount: manualDonation.bonusAmount,
        bonusPercentage: manualDonation.bonusPercentage,
      })
      .from(manualDonation)
      .$dynamic();

    // Apply manual donation filters
    const donationConditions: SQL<unknown>[] = [];
    
    // Filter by contact
    donationConditions.push(eq(manualDonation.contactId, contactIdNum));

    // Apply status filter
    if (paymentStatus) {
      donationConditions.push(eq(manualDonation.paymentStatus, paymentStatus));
    }

    // Apply search filter
    if (search) {
      const searchConditions: SQL<unknown>[] = [];
      searchConditions.push(ilike(sql`COALESCE(${manualDonation.notes}, '')`, `%${search}%`));
      searchConditions.push(ilike(sql`COALESCE(${manualDonation.referenceNumber}, '')`, `%${search}%`));
      searchConditions.push(ilike(sql`COALESCE(${manualDonation.checkNumber}, '')`, `%${search}%`));
      searchConditions.push(ilike(sql`COALESCE(${manualDonation.receiptNumber}, '')`, `%${search}%`));
      donationConditions.push(or(...searchConditions)!);
    }

    if (donationConditions.length > 0) {
      manualDonationsQuery = manualDonationsQuery.where(and(...donationConditions));
    }

    // Execute both queries
    const payments = await paymentsQuery.orderBy(desc(payment.paymentDate));
    const manualDonations = await manualDonationsQuery.orderBy(desc(manualDonation.paymentDate));

    // Combine and sort all results by date
    const allRecords = [
      ...payments.map(p => ({ ...p, type: 'payment' as const })),
      ...manualDonations.map(d => ({ ...d, type: 'manual_donation' as const }))
    ].sort((a, b) => {
      const dateA = new Date(a.paymentDate || 0).getTime();
      const dateB = new Date(b.paymentDate || 0).getTime();
      return dateB - dateA; // Descending order
    });

    // Apply pagination to combined results
    const offset = (page - 1) * limit;
    const paginatedRecords = allRecords.slice(offset, offset + limit);

    // Separate back into payments and manualDonations for response
    const paginatedPayments = paginatedRecords.filter(r => r.type === 'payment');
    const paginatedManualDonations = paginatedRecords.filter(r => r.type === 'manual_donation');

    // Calculate pagination metadata
    const totalCount = allRecords.length;
    const totalPages = Math.ceil(totalCount / limit);

    return NextResponse.json(
      { 
        payments: paginatedPayments,
        manualDonations: paginatedManualDonations,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        }
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to fetch payments" },
      { status: 500 }
    );
  }
}