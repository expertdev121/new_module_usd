import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  bonusCalculation,
  contact,
  solicitor,
  payment,
  bonusRule,
} from "@/lib/db/schema";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const solicitorId = searchParams.get("solicitorId");
    const isPaid = searchParams.get("isPaid");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    // eslint-disable-next-line prefer-const
    let whereConditions = [];

    if (solicitorId) {
      whereConditions.push(
        eq(bonusCalculation.solicitorId, parseInt(solicitorId))
      );
    }

    if (isPaid !== null) {
      whereConditions.push(eq(bonusCalculation.isPaid, isPaid === "true"));
    }

    // Get total count for pagination
    const totalCountResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(bonusCalculation)
      .innerJoin(solicitor, eq(bonusCalculation.solicitorId, solicitor.id))
      .innerJoin(contact, eq(solicitor.contactId, contact.id))
      .innerJoin(payment, eq(bonusCalculation.paymentId, payment.id))
      .leftJoin(bonusRule, eq(bonusCalculation.bonusRuleId, bonusRule.id))
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

    const totalCount = totalCountResult[0]?.count || 0;
    const totalPages = Math.ceil(totalCount / limit);

    const calculations = await db
      .select({
        id: bonusCalculation.id,
        paymentId: bonusCalculation.paymentId,
        solicitorId: bonusCalculation.solicitorId,
        bonusRuleId: bonusCalculation.bonusRuleId,
        paymentAmount: bonusCalculation.paymentAmount,
        bonusPercentage: bonusCalculation.bonusPercentage,
        bonusAmount: bonusCalculation.bonusAmount,
        calculatedAt: bonusCalculation.calculatedAt,
        isPaid: bonusCalculation.isPaid,
        paidAt: bonusCalculation.paidAt,
        notes: bonusCalculation.notes,
        // Solicitor info
        solicitorFirstName: contact.firstName,
        solicitorLastName: contact.lastName,
        solicitorCode: solicitor.solicitorCode,
        // Payment info
        paymentDate: payment.paymentDate,
        paymentReference: payment.referenceNumber,
        // Bonus rule info
        ruleName: bonusRule.ruleName,
      })
      .from(bonusCalculation)
      .innerJoin(solicitor, eq(bonusCalculation.solicitorId, solicitor.id))
      .innerJoin(contact, eq(solicitor.contactId, contact.id))
      .innerJoin(payment, eq(bonusCalculation.paymentId, payment.id))
      .leftJoin(bonusRule, eq(bonusCalculation.bonusRuleId, bonusRule.id))
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(bonusCalculation.calculatedAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      bonusCalculations: calculations,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching bonus calculations:", error);
    return NextResponse.json(
      { error: "Failed to fetch bonus calculations" },
      { status: 500 }
    );
  }
}
