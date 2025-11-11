import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  pledge,
  contact,
  category,
  payment,
  paymentPlan,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');

    const baseQuery = db
      .select({
        // Pledge core details
        id: pledge.id,
        contactId: pledge.contactId,
        categoryId: pledge.categoryId,
        pledgeDate: pledge.pledgeDate,
        description: pledge.description,
        originalAmount: pledge.originalAmount,
        currency: pledge.currency,
        totalPaid: pledge.totalPaid,
        balance: pledge.balance,
        originalAmountUsd: pledge.originalAmountUsd,
        totalPaidUsd: pledge.totalPaidUsd,
        balanceUsd: pledge.balanceUsd,
        isActive: pledge.isActive,
        notes: pledge.notes,

        // Contact (Donor) details
        contactFirstName: contact.firstName,
        contactLastName: contact.lastName,
        contactEmail: contact.email,
        contactPhone: contact.phone,

        // Category details
        categoryName: category.name,
        categoryDescription: category.description,

        // Aggregated Payment details
        totalPayments: sql<number>`COUNT(DISTINCT ${payment.id})`.as(
          "total_payments"
        ),
        totalAmountPaid: sql<number>`COALESCE(SUM(${payment.amount}), 0)`.as(
          "total_amount_paid"
        ),

        // Payment Plan details
        totalPlans: sql<number>`COUNT(DISTINCT ${paymentPlan.id})`.as(
          "total_plans"
        ),
        activePlans:
          sql<number>`COUNT(DISTINCT CASE WHEN ${paymentPlan.planStatus} = 'active' THEN ${paymentPlan.id} END)`.as(
            "active_plans"
          ),
        nextPaymentDate: sql<Date>`MIN(${paymentPlan.nextPaymentDate})`.as(
          "next_payment_date"
        ),
      })
      .from(pledge)
      .leftJoin(contact, eq(pledge.contactId, contact.id))
      .leftJoin(category, eq(pledge.categoryId, category.id))
      .leftJoin(payment, eq(pledge.id, payment.pledgeId))
      .leftJoin(paymentPlan, eq(pledge.id, paymentPlan.pledgeId))
      .groupBy(pledge.id, contact.id, category.id);

    const pledgesWithDetails = locationId
      ? await baseQuery.where(eq(pledge.contactId, parseInt(locationId)))
      : await baseQuery;

    return NextResponse.json(pledgesWithDetails);
  } catch (error) {
    console.error("Error fetching pledges with details:", error);
    return NextResponse.json(
      { error: "Failed to fetch pledges with details" },
      { status: 500 }
    );
  }
}
