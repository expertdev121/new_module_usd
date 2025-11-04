import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  pledge,
  contact,
  category,
  payment,
  paymentPlan,
  bonusCalculation,
  NewPledge,
  pledgeTags,
  tag,
  relationships,
} from "@/lib/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";

const updatePledgeSchema = z.object({
  contactId: z.number().positive().optional(),
  categoryId: z.number().positive().optional(),
  relationshipId: z.number().positive().optional(),
  pledgeDate: z.string().min(1, "Pledge date is required").optional(),
  description: z.string().optional(),
  originalAmount: z.number().positive("Pledge amount must be positive").optional(),
  currency: z
    .enum(["USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR"])
    .optional(),
  originalAmountUsd: z
    .number()
    .positive("Pledge amount in USD must be positive")
    .optional(),
  exchangeRate: z.number().positive("Exchange rate must be positive").optional(),
  campaignCode: z.string().optional(),
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
  // NEW: Add tag IDs array for updates
  tagIds: z.array(z.number().positive()).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pledgeId = parseInt(id, 10);
  try {
    if (isNaN(pledgeId)) {
      return NextResponse.json({ error: "Invalid pledge ID" }, { status: 400 });
    }

    // Create aliases for different contact joins
    const primaryContact = alias(contact, "primary_contact");
    const relatedContact = alias(contact, "related_contact");

    const pledgeDetailsQuery = db
      .select({ 
        // Pledge fields
        id: pledge.id,
        pledgeDate: pledge.pledgeDate,
        description: pledge.description,
        originalAmount: pledge.originalAmount,
        currency: pledge.currency,
        totalPaid: pledge.totalPaid,
        balance: pledge.balance,
        originalAmountUsd: pledge.originalAmountUsd,
        totalPaidUsd: pledge.totalPaidUsd,
        balanceUsd: pledge.balanceUsd,
        exchangeRate: pledge.exchangeRate,
        campaignCode: pledge.campaignCode,
        isActive: pledge.isActive,
        notes: pledge.notes,
        createdAt: pledge.createdAt,
        updatedAt: pledge.updatedAt,

        // Primary contact fields
        contactId: primaryContact.id,
        contactFirstName: primaryContact.firstName,
        contactLastName: primaryContact.lastName,
        contactEmail: primaryContact.email,
        contactPhone: primaryContact.phone,

        // Category fields
        categoryId: category.id,
        categoryName: category.name,
        categoryDescription: category.description,

        // Relationship fields
        relationshipId: relationships.id,
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
      .where(eq(pledge.id, pledgeId))
      .limit(1);

    // NEW: Get tags for this pledge
    const pledgeTagsQuery = db
      .select({
        tagId: tag.id,
        tagName: tag.name,
        tagDescription: tag.description,
        showOnPayment: tag.showOnPayment,
        showOnPledge: tag.showOnPledge,
        isActive: tag.isActive,
      })
      .from(pledgeTags)
      .innerJoin(tag, eq(pledgeTags.tagId, tag.id))
      .where(and(
        eq(pledgeTags.pledgeId, pledgeId),
        eq(tag.isActive, true)
      ));

    // Get payment summary for this pledge
    const paymentSummaryQuery = db
      .select({
        totalPayments: sql<number>`count(*)`.as("totalPayments"),
        lastPaymentDate: sql<string>`max(payment_date)`.as("lastPaymentDate"),
        lastPaymentAmount: sql<string>`(
          SELECT amount FROM ${payment} 
          WHERE pledge_id = ${pledgeId} 
          ORDER BY payment_date DESC 
          LIMIT 1
        )`.as("lastPaymentAmount"),
      })
      .from(payment)
      .where(eq(payment.pledgeId, pledgeId));

    // Get active payment plans for this pledge
    const paymentPlansQuery = db
      .select({
        id: paymentPlan.id,
        planName: paymentPlan.planName,
        frequency: paymentPlan.frequency,
        installmentAmount: paymentPlan.installmentAmount,
        numberOfInstallments: paymentPlan.numberOfInstallments,
        installmentsPaid: paymentPlan.installmentsPaid,
        nextPaymentDate: paymentPlan.nextPaymentDate,
        planStatus: paymentPlan.planStatus,
        totalPlannedAmount: paymentPlan.totalPlannedAmount,
        remainingAmount: paymentPlan.remainingAmount,
        currency: paymentPlan.currency,
        autoRenew: paymentPlan.autoRenew,
        isActive: paymentPlan.isActive,
        createdAt: paymentPlan.createdAt,
      })
      .from(paymentPlan)
      .where(eq(paymentPlan.pledgeId, pledgeId))
      .orderBy(sql`${paymentPlan.createdAt} DESC`);

    // Execute all queries
    const [pledgeDetails, pledgeTagsResults, paymentSummary, paymentPlans] = await Promise.all([
      pledgeDetailsQuery.execute(),
      pledgeTagsQuery.execute(),
      paymentSummaryQuery.execute(),
      paymentPlansQuery.execute(),
    ]);

    if (pledgeDetails.length === 0) {
      return NextResponse.json({ error: "Pledge not found" }, { status: 404 });
    }

    const pledgeData = pledgeDetails[0];
    const summaryData = paymentSummary[0];

    // Calculate additional metrics
    const originalAmount = parseFloat(pledgeData.originalAmount);
    const totalPaid = parseFloat(pledgeData.totalPaid);
    const balance = parseFloat(pledgeData.balance);
    const paymentPercentage =
      originalAmount > 0 ? (totalPaid / originalAmount) * 100 : 0;

    // NEW: Format tags
    const tags = pledgeTagsResults.map((tagResult) => ({
      id: tagResult.tagId,
      name: tagResult.tagName,
      description: tagResult.tagDescription,
      showOnPayment: tagResult.showOnPayment,
      showOnPledge: tagResult.showOnPledge,
      isActive: tagResult.isActive,
    }));

    const response = {
      pledge: {
        id: pledgeData.id,
        pledgeDate: pledgeData.pledgeDate,
        description: pledgeData.description,
        originalAmount: originalAmount,
        currency: pledgeData.currency,
        totalPaid: totalPaid,
        balance: balance,
        originalAmountUsd: pledgeData.originalAmountUsd
          ? parseFloat(pledgeData.originalAmountUsd)
          : null,
        totalPaidUsd: pledgeData.totalPaidUsd
          ? parseFloat(pledgeData.totalPaidUsd)
          : null,
        balanceUsd: pledgeData.balanceUsd
          ? parseFloat(pledgeData.balanceUsd)
          : null,
        exchangeRate: pledgeData.exchangeRate
          ? parseFloat(pledgeData.exchangeRate)
          : null,
        campaignCode: pledgeData.campaignCode,
        isActive: pledgeData.isActive,
        notes: pledgeData.notes,
        createdAt: pledgeData.createdAt,
        updatedAt: pledgeData.updatedAt,

        // Calculated fields
        paymentPercentage: paymentPercentage,
        remainingBalance: balance,
        isPaidInFull: balance <= 0,
      },
      contact: {
        id: pledgeData.contactId,
        firstName: pledgeData.contactFirstName,
        lastName: pledgeData.contactLastName,
        fullName: `${pledgeData.contactFirstName} ${pledgeData.contactLastName}`,
        email: pledgeData.contactEmail,
        phone: pledgeData.contactPhone,
      },
      category: pledgeData.categoryId
        ? {
            id: pledgeData.categoryId,
            name: pledgeData.categoryName,
            description: pledgeData.categoryDescription,
          }
        : null,
      // NEW: Add relationship data structure
      relationship: pledgeData.relationshipId ? {
        id: pledgeData.relationshipId,
        type: pledgeData.relationshipType,
        isActive: pledgeData.relationshipIsActive,
        notes: pledgeData.relationshipNotes,
        relatedContact: pledgeData.relatedContactId ? {
          id: pledgeData.relatedContactId,
          firstName: pledgeData.relatedContactFirstName,
          lastName: pledgeData.relatedContactLastName,
          email: pledgeData.relatedContactEmail,
          phone: pledgeData.relatedContactPhone,
          fullName: `${pledgeData.relatedContactFirstName || ""} ${pledgeData.relatedContactLastName || ""}`.trim(),
        } : null,
        label: `${pledgeData.relationshipType || ""} - ${pledgeData.relatedContactFirstName || ""} ${pledgeData.relatedContactLastName || ""}`.trim(),
      } : null,
      // NEW: Add tags data
      tags: tags,
      paymentSummary: {
        totalPayments: Number(summaryData.totalPayments || 0),
        lastPaymentDate: summaryData.lastPaymentDate,
        lastPaymentAmount: summaryData.lastPaymentAmount
          ? parseFloat(summaryData.lastPaymentAmount)
          : null,
      },
      paymentPlans: paymentPlans.map((plan) => ({
        ...plan,
        totalPlannedAmount: parseFloat(plan.totalPlannedAmount),
        installmentAmount: parseFloat(plan.installmentAmount),
        remainingAmount: parseFloat(plan.remainingAmount),
      })),
      activePaymentPlans: paymentPlans.filter(
        (plan) => plan.isActive && plan.planStatus === "active"
      ),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching pledge details:", error);
    return ErrorHandler.handle(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pledgeId = parseInt(id, 10);

    if (isNaN(pledgeId)) {
      return NextResponse.json(
        { error: "Invalid pledge ID" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validatedData = updatePledgeSchema.parse(body);

    // Check if pledge exists
    const existingPledge = await db
      .select()
      .from(pledge)
      .where(eq(pledge.id, pledgeId))
      .limit(1);

    if (existingPledge.length === 0) {
      return NextResponse.json(
        { error: "Pledge not found" },
        { status: 404 }
      );
    }

    // Prepare update data
    const updateData: Partial<NewPledge> = {};

    if (validatedData.contactId !== undefined) {
      updateData.contactId = validatedData.contactId;
    }
    if (validatedData.categoryId !== undefined) {
      updateData.categoryId = validatedData.categoryId;
    }
    // Add relationship handling
    if (validatedData.relationshipId !== undefined) {
      updateData.relationshipId = validatedData.relationshipId;
    }
    if (validatedData.pledgeDate !== undefined) {
      updateData.pledgeDate = validatedData.pledgeDate;
    }
    if (validatedData.description !== undefined) {
      updateData.description = validatedData.description;
    }
    if (validatedData.currency !== undefined) {
      updateData.currency = validatedData.currency;
    }
    if (validatedData.campaignCode !== undefined) {
      updateData.campaignCode = validatedData.campaignCode;
    }
    if (validatedData.notes !== undefined) {
      updateData.notes = validatedData.notes;
    }
    if (validatedData.isActive !== undefined) {
      updateData.isActive = validatedData.isActive;
    }

    // Handle amount and exchange rate updates
    if (validatedData.originalAmount !== undefined || 
        validatedData.originalAmountUsd !== undefined || 
        validatedData.exchangeRate !== undefined) {
      
      const currentPledge = existingPledge[0];
      
      // Helper function to safely parse float from string | null
      const safeParseFloat = (value: string | null, fallback: number = 0): number => {
        return value ? parseFloat(value) : fallback;
      };
      
      // Get current values or use provided values (with null safety)
      const originalAmount = validatedData.originalAmount ?? safeParseFloat(currentPledge.originalAmount, 0);
      const originalAmountUsd = validatedData.originalAmountUsd ?? safeParseFloat(currentPledge.originalAmountUsd, 0);
      const exchangeRate = validatedData.exchangeRate ?? safeParseFloat(currentPledge.exchangeRate, 1);
      const currentTotalPaid = safeParseFloat(currentPledge.totalPaid, 0);
      const currentTotalPaidUsd = safeParseFloat(currentPledge.totalPaidUsd, 0);

      // Update amounts
      updateData.originalAmount = originalAmount.toString();
      updateData.originalAmountUsd = originalAmountUsd.toString();
      updateData.exchangeRate = exchangeRate.toString();

      // Recalculate balances
      const newBalance = originalAmount - currentTotalPaid;
      const newBalanceUsd = originalAmountUsd - currentTotalPaidUsd;

      updateData.balance = Math.max(0, newBalance).toString();
      updateData.balanceUsd = Math.max(0, newBalanceUsd).toString();
    }

    // Add updatedAt timestamp
    updateData.updatedAt = new Date();

    // Perform the pledge update
    const result = await db
      .update(pledge)
      .set(updateData)
      .where(eq(pledge.id, pledgeId))
      .returning();

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Failed to update pledge" },
        { status: 400 }
      );
    }

    // NEW: Handle tag associations if provided (without transaction)
    if (validatedData.tagIds !== undefined) {
      try {
        // First, delete existing tag associations
        await db
          .delete(pledgeTags)
          .where(eq(pledgeTags.pledgeId, pledgeId));

        // Then, add new tag associations
        if (validatedData.tagIds.length > 0) {
          const tagInsertData = validatedData.tagIds.map((tagId) => ({
            pledgeId: pledgeId,
            tagId: tagId,
          }));

          await db.insert(pledgeTags).values(tagInsertData);
        }
      } catch (tagError) {
        console.error("Error updating pledge tags:", tagError);
        // Continue without failing the entire operation
        // The pledge is updated, but tags might not be updated
      }
    }

    return NextResponse.json(
      {
        message: "Pledge updated successfully",
        pledge: result[0],
      },
      { status: 200 }
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

    console.error("Error updating pledge:", error);
    return ErrorHandler.handle(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pledgeId = parseInt(id, 10);

  try {
    if (isNaN(pledgeId)) {
      return NextResponse.json({ error: "Invalid pledge ID" }, { status: 400 });
    }
    
    const existingPledge = await db
      .select({ id: pledge.id })
      .from(pledge)
      .where(eq(pledge.id, pledgeId))
      .limit(1);

    if (existingPledge.length === 0) {
      return NextResponse.json({ error: "Pledge not found" }, { status: 404 });
    }

    // Get counts of related records including pledge tags
    const [relatedPayments, relatedPaymentPlans, bonusCalculations, relatedPledgeTags] =
      await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(payment)
          .where(eq(payment.pledgeId, pledgeId)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(paymentPlan)
          .where(eq(paymentPlan.pledgeId, pledgeId)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(bonusCalculation)
          .innerJoin(payment, eq(payment.id, bonusCalculation.paymentId))
          .where(eq(payment.pledgeId, pledgeId)),
        // NEW: Count pledge tags
        db
          .select({ count: sql<number>`count(*)` })
          .from(pledgeTags)
          .where(eq(pledgeTags.pledgeId, pledgeId)),
      ]);

    const paymentCount = Number(relatedPayments[0]?.count || 0);
    const paymentPlanCount = Number(relatedPaymentPlans[0]?.count || 0);
    const bonusCalculationCount = Number(bonusCalculations[0]?.count || 0);
    const pledgeTagCount = Number(relatedPledgeTags[0]?.count || 0);

    const deletedRecords = {
      bonusCalculations: bonusCalculationCount,
      payments: paymentCount,
      paymentPlans: paymentPlanCount,
      pledgeTags: pledgeTagCount, // NEW: Include pledge tags count
    };

    // Delete related records in proper order (no transactions with Neon HTTP)
    
    // Delete bonus calculations first
    if (bonusCalculationCount > 0) {
      await db.delete(bonusCalculation).where(
        sql`${bonusCalculation.paymentId} IN (
            SELECT id FROM ${payment} WHERE pledge_id = ${pledgeId}
          )`
      );
    }

    // Delete payments
    if (paymentCount > 0) {
      await db.delete(payment).where(eq(payment.pledgeId, pledgeId));
    }

    // Delete payment plans
    if (paymentPlanCount > 0) {
      await db.delete(paymentPlan).where(eq(paymentPlan.pledgeId, pledgeId));
    }

    // NEW: Delete pledge tags
    if (pledgeTagCount > 0) {
      await db.delete(pledgeTags).where(eq(pledgeTags.pledgeId, pledgeId));
    }

    // Finally, delete the pledge
    await db.delete(pledge).where(eq(pledge.id, pledgeId));

    return NextResponse.json({
      success: true,
      message: "Pledge and all related records permanently deleted",
      deletedPledgeId: pledgeId,
      deletedRecords,
    });
  } catch (error) {
    console.error("Error deleting pledge:", error);
    return ErrorHandler.handle(error);
  }
}
