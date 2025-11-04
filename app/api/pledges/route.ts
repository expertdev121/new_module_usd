import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  pledge,
  NewPledge,
  relationships,
  contact,
  category,
  paymentPlan,
  payment,
  paymentAllocations,
  pledgeTags,
  tag,
} from "@/lib/db/schema";
import { sql, eq, and, or, not, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";

// Define interfaces for query results
interface ScheduledItem {
  pledgeId: number | null;
  totalScheduled: string;
}

interface PledgeQueryResult {
  id: number;
  contactId: number;
  categoryId: number | null;
  relationshipId: number | null;
  pledgeDate: string;
  description: string | null;
  originalAmount: string;
  currency: string;
  originalAmountUsd: string | null;
  exchangeRate: string | null;
  campaignCode: string | null;
  totalPaid: string;
  totalPaidUsd: string | null;
  balance: string;
  balanceUsd: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  categoryName: string | null;
  categoryDescription: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactEmail: string | null;
  relationshipType: string | null;
  relationshipIsActive: boolean | null;
  relationshipNotes: string | null;
  relatedContactId: number | null;
  relatedContactFirstName: string | null;
  relatedContactLastName: string | null;
  relatedContactEmail: string | null;
  relatedContactPhone: string | null;
}

interface PledgeTagSummary {
  id: number;
  name: string;
  description: string | null;
  showOnPayment: boolean;
  showOnPledge: boolean;
  isActive: boolean;
}

const pledgeSchema = z.object({
  contactId: z.number().positive(),
  categoryId: z.number().positive().optional(),
  relationshipId: z.number().positive().optional(),
  pledgeDate: z.string().min(1, "Pledge date is required"),
  description: z.string().optional(),
  originalAmount: z.number().positive("Pledge amount must be positive"),
  currency: z
    .enum(["USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR"])
    .default("USD"),
  originalAmountUsd: z.number().positive("Pledge amount in USD must be positive"),
  exchangeRate: z.number().positive("Exchange rate must be positive"),
  campaignCode: z.string().optional(),
  notes: z.string().optional(),
  // NEW: Add tag IDs array
  tagIds: z.array(z.number().positive()).optional(),
});

const querySchema = z.object({
  contactId: z.number().positive().optional(),
  categoryId: z.number().positive().optional(),
  relationshipId: z.number().positive().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  status: z.enum(["fullyPaid", "partiallyPaid", "unpaid"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  campaignCode: z.string().optional(),
  // NEW: Add tag filtering
  tagIds: z.array(z.number().positive()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = pledgeSchema.parse(body);
    const balance = validatedData.originalAmount;
    const balanceUsd = validatedData.originalAmountUsd;

    const newPledge: NewPledge = {
      contactId: validatedData.contactId,
      categoryId: validatedData.categoryId || null,
      relationshipId: validatedData.relationshipId || null,
      pledgeDate: validatedData.pledgeDate,
      description: validatedData.description,
      originalAmount: validatedData.originalAmount.toString(),
      currency: validatedData.currency,
      originalAmountUsd: validatedData.originalAmountUsd.toString(),
      exchangeRate: validatedData.exchangeRate.toString(),
      campaignCode: validatedData.campaignCode || null,
      totalPaid: "0",
      totalPaidUsd: "0",
      balance: balance.toString(),
      balanceUsd: balanceUsd.toString(),
      isActive: true,
      notes: validatedData.notes || null,
    };

    // Create the pledge first
    const [createdPledge] = await db.insert(pledge).values(newPledge).returning();

    // Handle tag associations if provided (without transaction)
    if (validatedData.tagIds && validatedData.tagIds.length > 0) {
      try {
        const tagInsertData = validatedData.tagIds.map((tagId) => ({
          pledgeId: createdPledge.id,
          tagId: tagId,
        }));

        await db.insert(pledgeTags).values(tagInsertData);
      } catch (tagError) {
        console.error("Error adding tags to pledge:", tagError);
        // Continue without failing the entire operation
        // The pledge is created, but tags might not be associated
      }
    }

    return NextResponse.json(
      {
        message: "Pledge created successfully",
        pledge: createdPledge,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }
    console.error("Error creating pledge:", error);
    return ErrorHandler.handle(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Handle tagIds array parameter
    const tagIdsParam = searchParams.get("tagIds");
    let tagIds: number[] | undefined;
    if (tagIdsParam) {
      try {
        tagIds = (JSON.parse(tagIdsParam) as unknown[]).map((id: unknown) => {
          const num = typeof id === 'number' ? id : typeof id === 'string' ? parseInt(id, 10) : NaN;
          return num;
        }).filter((id) => !isNaN(id));
      } catch {
        // If JSON parsing fails, try comma-separated values
        tagIds = tagIdsParam.split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      }
    }

    const parsedParams = querySchema.safeParse({
      contactId: searchParams.get("contactId")
        ? parseInt(searchParams.get("contactId")!)
        : undefined,
      categoryId: searchParams.get("categoryId")
        ? parseInt(searchParams.get("categoryId")!)
        : undefined,
      relationshipId: searchParams.get("relationshipId")
        ? parseInt(searchParams.get("relationshipId")!)
        : undefined,
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      startDate: searchParams.get("startDate") ?? undefined,
      endDate: searchParams.get("endDate") ?? undefined,
      campaignCode: searchParams.get("campaignCode") ?? undefined,
      tagIds: tagIds,
    });

    if (!parsedParams.success) {
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          details: parsedParams.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }

    const {
      contactId,
      categoryId,
      relationshipId,
      page,
      limit,
      search,
      status,
      startDate,
      endDate,
      campaignCode,
      tagIds: filterTagIds,
    } = parsedParams.data;
    const offset = (page - 1) * limit;

    // Build WHERE conditions
    const conditions = [];
    if (contactId) conditions.push(eq(pledge.contactId, contactId));
    if (categoryId) conditions.push(eq(pledge.categoryId, categoryId));
    if (relationshipId) conditions.push(eq(pledge.relationshipId, relationshipId));
    if (search) {
      conditions.push(
        sql`${pledge.description} ILIKE ${"%" + search + "%"} OR ${
          pledge.notes
        } ILIKE ${"%" + search + "%"} OR ${
          pledge.campaignCode
        } ILIKE ${"%" + search + "%"}`
      );
    }
    if (campaignCode) conditions.push(eq(pledge.campaignCode, campaignCode));
    if (status) {
      switch (status) {
        case "fullyPaid":
          conditions.push(sql`${pledge.balance}::numeric = 0`);
          break;
        case "partiallyPaid":
          conditions.push(
            sql`${pledge.totalPaid}::numeric > 0 AND ${pledge.balance}::numeric > 0`
          );
          break;
        case "unpaid":
          conditions.push(sql`${pledge.totalPaid}::numeric = 0`);
          break;
      }
    }
    if (startDate) conditions.push(sql`${pledge.pledgeDate} >= ${startDate}`);
    if (endDate) conditions.push(sql`${pledge.pledgeDate} <= ${endDate}`);

    // NEW: Add tag filtering condition
    if (filterTagIds && filterTagIds.length > 0) {
      conditions.push(
        sql`${pledge.id} IN (
          SELECT DISTINCT ${pledgeTags.pledgeId} 
          FROM ${pledgeTags} 
          WHERE ${pledgeTags.tagId} = ANY(${filterTagIds})
        )`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Create aliases for different contact joins
    const primaryContact = alias(contact, "primary_contact");
    const relatedContact = alias(contact, "related_contact");

    console.log("=== PLEDGES API DEBUG: Starting query ===");

    // Main query with proper joins
    const pledgesQuery = db
      .select({
        // Pledge fields
        id: pledge.id,
        contactId: pledge.contactId,
        categoryId: pledge.categoryId,
        relationshipId: pledge.relationshipId,
        pledgeDate: pledge.pledgeDate,
        description: pledge.description,
        originalAmount: pledge.originalAmount,
        currency: pledge.currency,
        originalAmountUsd: pledge.originalAmountUsd,
        exchangeRate: pledge.exchangeRate,
        campaignCode: pledge.campaignCode,
        totalPaid: pledge.totalPaid,
        totalPaidUsd: pledge.totalPaidUsd,
        balance: pledge.balance,
        balanceUsd: pledge.balanceUsd,
        isActive: pledge.isActive,
        notes: pledge.notes,
        createdAt: pledge.createdAt,
        updatedAt: pledge.updatedAt,
        
        // Category fields
        categoryName: category.name,
        categoryDescription: category.description,
        
        // Primary contact fields
        contactFirstName: primaryContact.firstName,
        contactLastName: primaryContact.lastName,
        contactEmail: primaryContact.email,
        
        // Relationship fields
        relationshipType: relationships.relationshipType,
        relationshipIsActive: relationships.isActive,
        relationshipNotes: relationships.notes,
        
        // Related contact fields
        relatedContactId: relatedContact.id,
        relatedContactFirstName: relatedContact.firstName,
        relatedContactLastName: relatedContact.lastName,
        relatedContactEmail: relatedContact.email,
        relatedContactPhone: relatedContact.phone,
      })
      .from(pledge)
      .leftJoin(primaryContact, eq(pledge.contactId, primaryContact.id))
      .leftJoin(category, eq(pledge.categoryId, category.id))
      .leftJoin(relationships, eq(pledge.relationshipId, relationships.id))
      .leftJoin(relatedContact, eq(relationships.relatedContactId, relatedContact.id))
      .where(whereClause)
      .orderBy(sql`${pledge.updatedAt} DESC`)
      .limit(limit)
      .offset(offset);

    // NEW: Get tags for all pledges in the result set
    const pledgeTagsQuery = db
      .select({
        pledgeId: pledgeTags.pledgeId,
        tagId: tag.id,
        tagName: tag.name,
        tagDescription: tag.description,
        showOnPayment: tag.showOnPayment,
        showOnPledge: tag.showOnPledge,
        isActive: tag.isActive,
      })
      .from(pledgeTags)
      .innerJoin(tag, eq(pledgeTags.tagId, tag.id))
      .where(eq(tag.isActive, true));

    // Get scheduled amounts - only payments without receive date and status expected/pending/processing
    const scheduledPaymentsQuery = db
      .select({
        pledgeId: payment.pledgeId,
        totalScheduled: sql<string>`COALESCE(SUM(${payment.amountInPledgeCurrency}::numeric), 0)`.as("totalScheduled"),
      })
      .from(payment)
      .where(and(
        not(isNull(payment.pledgeId)),
        isNull(payment.receivedDate), // No receive date
        or(
          eq(payment.paymentStatus, "pending"),
          eq(payment.paymentStatus, "expected"),
          eq(payment.paymentStatus, "processing")
        )
      ))
      .groupBy(payment.pledgeId);

    // Get scheduled payment allocations (for split payments without receive date)
    const scheduledAllocationsQuery = db
      .select({
        pledgeId: paymentAllocations.pledgeId,
        totalScheduled: sql<string>`COALESCE(SUM(${paymentAllocations.allocatedAmountInPledgeCurrency}::numeric), 0)`.as("totalScheduled"),
      })
      .from(paymentAllocations)
      .innerJoin(payment, eq(paymentAllocations.paymentId, payment.id))
      .where(and(
        isNull(payment.receivedDate), // No receive date
        or(
          eq(payment.paymentStatus, "pending"),
          eq(payment.paymentStatus, "expected"),
          eq(payment.paymentStatus, "processing")
        )
      ))
      .groupBy(paymentAllocations.pledgeId);

    // Count query
    const countQuery = db
      .select({
        count: sql<number>`count(*)`.as("count"),
      })
      .from(pledge)
      .where(whereClause);

    // Execute all queries
    const [pledges, pledgeTagsResults, scheduledPayments, scheduledAllocations, totalCountResult] = await Promise.all([
      pledgesQuery.execute(),
      pledgeTagsQuery.execute(),
      scheduledPaymentsQuery.execute(),
      scheduledAllocationsQuery.execute(),
      countQuery.execute(),
    ]);

    console.log(`=== PLEDGES API DEBUG: Found ${pledges.length} pledges ===`);

    // Create maps for scheduled payments
    const scheduledPaymentsMap = new Map<number, string>();
    scheduledPayments.forEach((item: ScheduledItem) => {
      if (item.pledgeId !== null) {
        scheduledPaymentsMap.set(item.pledgeId, item.totalScheduled);
      }
    });

    const scheduledAllocationsMap = new Map<number, string>();
    scheduledAllocations.forEach((item: ScheduledItem) => {
      if (item.pledgeId !== null) {
        scheduledAllocationsMap.set(item.pledgeId, item.totalScheduled);
      }
    });

    // NEW: Create map for pledge tags
    const pledgeTagsMap = new Map<number, PledgeTagSummary[]>();
    pledgeTagsResults.forEach((tagResult) => {
      if (!pledgeTagsMap.has(tagResult.pledgeId)) {
        pledgeTagsMap.set(tagResult.pledgeId, []);
      }
      pledgeTagsMap.get(tagResult.pledgeId)!.push({
        id: tagResult.tagId,
        name: tagResult.tagName,
        description: tagResult.tagDescription,
        showOnPayment: tagResult.showOnPayment,
        showOnPledge: tagResult.showOnPledge,
        isActive: tagResult.isActive,
      });
    });

    // Debug log first pledge with relationship data
    if (pledges.length > 0) {
      const firstPledge = pledges[0];
      console.log("=== PLEDGES API DEBUG: First pledge ===", {
        id: firstPledge.id,
        relationshipId: firstPledge.relationshipId,
        relationshipType: firstPledge.relationshipType,
        relatedContactId: firstPledge.relatedContactId,
        relatedContactName: `${firstPledge.relatedContactFirstName || ''} ${firstPledge.relatedContactLastName || ''}`.trim(),
        hasRelationship: !!firstPledge.relationshipId,
        hasRelatedContact: !!firstPledge.relatedContactId,
      });
    }

    const totalCount = Number(totalCountResult[0]?.count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    // Format the response with structured relationship data and tags
    const formattedPledges = pledges.map((pledgeItem: PledgeQueryResult) => {
      // Combine scheduled payments and allocations (no payment plans)
      const scheduledPaymentAmount = parseFloat(scheduledPaymentsMap.get(pledgeItem.id) || "0");
      const scheduledAllocationAmount = parseFloat(scheduledAllocationsMap.get(pledgeItem.id) || "0");

      const totalScheduledAmount = scheduledPaymentAmount + scheduledAllocationAmount;
      const scheduledAmount = totalScheduledAmount.toString();

      const balanceNumeric = parseFloat(pledgeItem.balance || "0");
      const scheduledNumeric = totalScheduledAmount;
      const unscheduledAmount = Math.max(0, balanceNumeric - scheduledNumeric).toString();

      // NEW: Get tags for this pledge
      const pledgeTags = pledgeTagsMap.get(pledgeItem.id) || [];

      const formattedPledge = {
        ...pledgeItem,
        // Add calculated amounts
        scheduledAmount,
        unscheduledAmount,
        progressPercentage: pledgeItem.originalAmount
          ? (parseFloat(pledgeItem.totalPaid || "0") / parseFloat(pledgeItem.originalAmount)) * 100
          : 0,
        
        // Structure relationship data - THIS IS THE KEY PART
        relationship: pledgeItem.relationshipId ? {
          id: pledgeItem.relationshipId,
          type: pledgeItem.relationshipType,
          isActive: pledgeItem.relationshipIsActive,
          notes: pledgeItem.relationshipNotes,
          relatedContact: pledgeItem.relatedContactId ? {
            id: pledgeItem.relatedContactId,
            firstName: pledgeItem.relatedContactFirstName,
            lastName: pledgeItem.relatedContactLastName,
            email: pledgeItem.relatedContactEmail,
            phone: pledgeItem.relatedContactPhone,
            fullName: `${pledgeItem.relatedContactFirstName || ""} ${pledgeItem.relatedContactLastName || ""}`.trim(),
          } : null,
          label: `${pledgeItem.relationshipType || ""} - ${pledgeItem.relatedContactFirstName || ""} ${pledgeItem.relatedContactLastName || ""}`.trim(),
        } : null,
        
        // Structure contact data
        contact: {
          id: pledgeItem.contactId,
          firstName: pledgeItem.contactFirstName,
          lastName: pledgeItem.contactLastName,
          email: pledgeItem.contactEmail,
          fullName: `${pledgeItem.contactFirstName || ""} ${pledgeItem.contactLastName || ""}`.trim(),
        },
        
        // Structure category data
        category: pledgeItem.categoryId ? {
          id: pledgeItem.categoryId,
          name: pledgeItem.categoryName,
          description: pledgeItem.categoryDescription,
        } : null,

        // NEW: Add tags data
        tags: pledgeTags,
      };

      return formattedPledge;
    });

    // Count pledges with relationships for debugging
    const pledgesWithRelationships = formattedPledges.filter(p => p.relationship);
    console.log(`=== PLEDGES API DEBUG: ${pledgesWithRelationships.length} pledges have relationships ===`);
    
    if (pledgesWithRelationships.length > 0) {
      console.log("=== PLEDGES API DEBUG: Sample relationships ===", 
        pledgesWithRelationships.slice(0, 2).map(p => ({
          pledgeId: p.id,
          relationshipType: p.relationship?.type,
          relatedContactName: p.relationship?.relatedContact?.fullName,
          isActive: p.relationship?.isActive
        }))
      );
    }

    // NEW: Count pledges with tags for debugging
    const pledgesWithTags = formattedPledges.filter(p => p.tags.length > 0);
    console.log(`=== PLEDGES API DEBUG: ${pledgesWithTags.length} pledges have tags ===`);

    const response = {
      pledges: formattedPledges,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      filters: {
        contactId,
        categoryId,
        relationshipId,
        search,
        status,
        startDate,
        endDate,
        campaignCode,
        tagIds: filterTagIds, // NEW: Include tag filtering in response
      },
    };

    return NextResponse.json(response, {
      headers: {
        "X-Total-Count": response.pagination.totalCount.toString(),
      },
    });
  } catch (error) {
    console.error("Error fetching pledges:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch pledges",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
