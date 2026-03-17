/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logPaymentPlanAction} from "@/lib/audit";
import {
  paymentPlan,
  pledge,
  installmentSchedule,
  payment,
  relationships,
  currencyConversionLog,
  exchangeRate,
  contact,
  PaymentPlan,
  NewPaymentPlan,
  NewPayment,
  NewCurrencyConversionLog
} from "@/lib/db/schema";
import { sql, eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";

// Zod schema for validating individual custom installments
const installmentSchema = z.object({
  installmentDate: z.string().min(1, "Installment date is required"),
  installmentAmount: z.number().positive("Installment amount must be positive"),
  currency: z.enum(["USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR"]).optional(),
  installmentAmountUsd: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(["pending", "paid", "overdue", "cancelled"]).default("pending").optional(),
  paidDate: z.string().optional().nullable(),
  paymentId: z.number().optional().nullable(),
});

// Updated schema with third-party payment support
const paymentPlanSchema = z.object({
  pledgeId: z.number().positive(),
  relationshipId: z.number().positive().optional(),
  planName: z.string().optional(),
  frequency: z.enum([
    "weekly",
    "monthly",
    "quarterly",
    "biannual",
    "annual",
    "one_time",
    "custom",
  ]),
  distributionType: z.enum(["fixed", "custom"]).default("fixed"),
  totalPlannedAmount: z.number().positive("Total planned amount must be positive"),
  currency: z.enum(["USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR"]),
  totalPlannedAmountUsd: z.number().optional().nullable(),
  installmentAmount: z.number().positive("Installment amount must be positive").optional(),
  installmentAmountUsd: z.number().optional().nullable(),
  numberOfInstallments: z.number().int().positive("Number of installments must be positive").optional(),
  exchangeRate: z.number().optional().nullable(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional().nullable(),
  nextPaymentDate: z.string().optional().nullable(),
  autoRenew: z.boolean().default(false),
  planStatus: z.enum(["active", "completed", "cancelled", "paused", "overdue"]).default("active"),
  paymentMethod: z.string().optional().nullable(),
  methodDetail: z.string().optional().nullable(),
  currencyPriority: z.number().int().positive().default(1),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  customInstallments: z.array(installmentSchema).optional(),
  // Third-party payment fields
  isThirdPartyPayment: z.boolean().default(false),
  thirdPartyContactId: z.number().positive().optional().nullable(),
  payerContactId: z.number().positive().optional(), // The contact ID making the payment (from session/auth)
}).refine((data) => {
  if (data.distributionType === "fixed") {
    return data.installmentAmount !== undefined && data.numberOfInstallments !== undefined;
  }
  if (data.distributionType === "custom") {
    return data.customInstallments && data.customInstallments.length > 0;
  }
  return true;
}, {
  message: "For 'fixed' distribution type, installmentAmount and numberOfInstallments are required. For 'custom' distribution type, customInstallments array is required.",
  path: ["distributionType"]
}).refine((data) => {
  // If it's a third-party payment, thirdPartyContactId must be provided
  if (data.isThirdPartyPayment) {
    return data.thirdPartyContactId !== null && data.thirdPartyContactId !== undefined;
  }
  return true;
}, {
  message: "Third-party contact ID is required when isThirdPartyPayment is true.",
  path: ["thirdPartyContactId"]
});

/**
 * Helper function to safely convert nullable values to compatible types
 */
function safeConvert<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

/**
 * Helper function to safely convert number to proper string format for database
 */
function safeNumericString(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toFixed(2) : null;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
  }
  return null;
}

/**
 * Helper function to safely parse exchange rate from string to number
 */
function parseExchangeRate(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Get exchange rate from database or use provided rate
 */
async function getExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  providedRate?: number | null,
  conversionDate?: string
): Promise<number | null> {
  if (fromCurrency === toCurrency) return 1;
  if (providedRate) return providedRate;

  try {
    const targetDate = conversionDate || new Date().toISOString().split('T')[0];

    // Try to get exact date first
    let rateQuery = await db
      .select({ rate: exchangeRate.rate })
      .from(exchangeRate)
      .where(
        and(
          eq(exchangeRate.baseCurrency, fromCurrency as any),
          eq(exchangeRate.targetCurrency, toCurrency as any),
          eq(exchangeRate.date, targetDate)
        )
      )
      .limit(1);

    // If no exact date, get most recent rate
    if (!rateQuery.length) {
      rateQuery = await db
        .select({ rate: exchangeRate.rate })
        .from(exchangeRate)
        .where(
          and(
            eq(exchangeRate.baseCurrency, fromCurrency as any),
            eq(exchangeRate.targetCurrency, toCurrency as any),
            sql`${exchangeRate.date} <= ${targetDate}`
          )
        )
        .orderBy(desc(exchangeRate.date))
        .limit(1);
    }

    if (rateQuery.length) {
      return parseFloat(rateQuery[0].rate.toString());
    }

    // Try reverse rate (toCurrency to fromCurrency)
    rateQuery = await db
      .select({ rate: exchangeRate.rate })
      .from(exchangeRate)
      .where(
        and(
          eq(exchangeRate.baseCurrency, toCurrency as any),
          eq(exchangeRate.targetCurrency, fromCurrency as any),
          sql`${exchangeRate.date} <= ${targetDate}`
        )
      )
      .orderBy(desc(exchangeRate.date))
      .limit(1);

    if (rateQuery.length) {
      return 1 / parseFloat(rateQuery[0].rate.toString());
    }

    return null;
  } catch (error) {
    console.warn("Failed to get exchange rate from database:", error);
    return null;
  }
}

/**
 * Enhanced multi-currency conversion helper
 */
async function calculateMultiCurrencyConversions(
  amount: number,
  paymentCurrency: string,
  pledgeCurrency: string,
  planCurrency: string,
  providedExchangeRate?: number | null,
  conversionDate?: string
) {
  const conversions = {
    amountUsd: null as number | null,
    amountInPledgeCurrency: amount,
    pledgeCurrencyExchangeRate: null as number | null,
    amountInPlanCurrency: amount,
    planCurrencyExchangeRate: null as number | null,
    usdExchangeRate: null as number | null,
  };

  // Calculate USD amount
  if (paymentCurrency === "USD") {
    conversions.amountUsd = amount;
    conversions.usdExchangeRate = 1;
  } else {
    const usdRate = await getExchangeRate(paymentCurrency, "USD", providedExchangeRate, conversionDate);
    if (usdRate) {
      conversions.amountUsd = amount * usdRate;
      conversions.usdExchangeRate = usdRate;
    }
  }

  // Calculate pledge currency amount
  if (paymentCurrency !== pledgeCurrency) {
    const pledgeRate = await getExchangeRate(paymentCurrency, pledgeCurrency, null, conversionDate);
    if (pledgeRate) {
      conversions.amountInPledgeCurrency = amount * pledgeRate;
      conversions.pledgeCurrencyExchangeRate = pledgeRate;
    } else if (conversions.amountUsd && pledgeCurrency !== "USD") {
      // Try USD as intermediate currency
      const usdToPledgeRate = await getExchangeRate("USD", pledgeCurrency, null, conversionDate);
      if (usdToPledgeRate) {
        conversions.amountInPledgeCurrency = conversions.amountUsd * usdToPledgeRate;
        conversions.pledgeCurrencyExchangeRate = (conversions.usdExchangeRate || 1) * usdToPledgeRate;
      }
    }
  } else {
    conversions.amountInPledgeCurrency = amount;
    conversions.pledgeCurrencyExchangeRate = 1;
  }

  // Calculate plan currency amount
  if (paymentCurrency !== planCurrency) {
    const planRate = await getExchangeRate(paymentCurrency, planCurrency, null, conversionDate);
    if (planRate) {
      conversions.amountInPlanCurrency = amount * planRate;
      conversions.planCurrencyExchangeRate = planRate;
    } else if (conversions.amountUsd && planCurrency !== "USD") {
      // Try USD as intermediate currency
      const usdToPlanRate = await getExchangeRate("USD", planCurrency, null, conversionDate);
      if (usdToPlanRate) {
        conversions.amountInPlanCurrency = conversions.amountUsd * usdToPlanRate;
        conversions.planCurrencyExchangeRate = (conversions.usdExchangeRate || 1) * usdToPlanRate;
      }
    }
  } else {
    conversions.amountInPlanCurrency = amount;
    conversions.planCurrencyExchangeRate = 1;
  }

  return conversions;
}

/**
 * Helper function to calculate installment dates based on frequency
 */
function calculateInstallmentDates(startDate: string, frequency: string, numberOfInstallments: number): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);

  for (let i = 0; i < numberOfInstallments; i++) {
    const installmentDate = new Date(start);

    switch (frequency) {
      case "weekly":
        installmentDate.setDate(start.getDate() + (i * 7));
        break;
      case "monthly":
        installmentDate.setMonth(start.getMonth() + i);
        break;
      case "quarterly":
        installmentDate.setMonth(start.getMonth() + (i * 3));
        break;
      case "biannual":
        installmentDate.setMonth(start.getMonth() + (i * 6));
        break;
      case "annual":
        installmentDate.setFullYear(start.getFullYear() + i);
        break;
      case "one_time":
        installmentDate.setTime(start.getTime());
        break;
      default:
        installmentDate.setTime(start.getTime());
    }

    dates.push(installmentDate.toISOString().split('T')[0]);
  }

  return dates;
}

/**
 * Validation function for payment data before database insertion
 */
function validatePaymentData(payment: NewPayment): string[] {
  const errors: string[] = [];

  if (!payment.amount || parseFloat(payment.amount) <= 0) {
    errors.push("Amount must be a positive number");
  }

  if (!payment.currency) {
    errors.push("Currency is required");
  }

  if (!payment.paymentDate) {
    errors.push("Payment date is required");
  }

  if (!payment.paymentMethod) {
    errors.push("Payment method is required");
  }

  if (!payment.paymentStatus) {
    errors.push("Payment status is required");
  }

  return errors;
}

/**
 * Enhanced helper function to create scheduled payment with proper multi-currency handling and third-party support
 */
async function createScheduledPayment(
  installmentRecord: any,
  validatedData: any,
  pledgeId: number,
  paymentPlanId: number,
  pledgeCurrency: string,
  planCurrency: string,
  installmentAmount: number,
  installmentAmountUsd?: number | null,
  customNotes?: string | null,
  isThirdParty: boolean = false,
  payerContactId?: number | null,
  thirdPartyContactId?: number | null
): Promise<NewPayment> {

  const paymentCurrency = installmentRecord.currency || validatedData.currency;
  const paymentDate = installmentRecord.installmentDate;

  // Calculate comprehensive multi-currency conversions
  const conversions = await calculateMultiCurrencyConversions(
    installmentAmount,
    paymentCurrency,
    pledgeCurrency,
    planCurrency,
    validatedData.exchangeRate,
    paymentDate
  );

  // Use form-provided USD amount or calculated amount
  const finalUsdAmount = installmentAmountUsd !== null && installmentAmountUsd !== undefined
    ? installmentAmountUsd
    : conversions.amountUsd;

  return {
    pledgeId,
    paymentPlanId,
    installmentScheduleId: installmentRecord.id,
    relationshipId: validatedData.relationshipId || null,

    // Third-party payment fields
    payerContactId: isThirdParty ? payerContactId || null : null,
    isThirdPartyPayment: isThirdParty,

    // Core payment amount and currency
    amount: safeNumericString(installmentAmount)!,
    currency: paymentCurrency,

    // USD conversion (for reporting)
    amountUsd: safeNumericString(finalUsdAmount),
    exchangeRate: safeNumericString(conversions.usdExchangeRate),

    // Pledge currency conversion (for pledge balance calculations)
    amountInPledgeCurrency: safeNumericString(conversions.amountInPledgeCurrency),
    pledgeCurrencyExchangeRate: safeNumericString(conversions.pledgeCurrencyExchangeRate),

    // Plan currency conversion (for plan tracking)
    amountInPlanCurrency: safeNumericString(conversions.amountInPlanCurrency),
    planCurrencyExchangeRate: safeNumericString(conversions.planCurrencyExchangeRate),

    // Required payment fields
    paymentDate: paymentDate,
    receivedDate: null,
    checkDate: null,
    account: null,
    paymentMethod: (validatedData.paymentMethod || "other") as NewPayment['paymentMethod'],
    methodDetail: validatedData.methodDetail || null,
    paymentStatus: "pending",
    referenceNumber: null,
    checkNumber: null,
    receiptNumber: null,
    receiptType: null,
    receiptIssued: false,
    solicitorId: null,
    bonusPercentage: null,
    bonusAmount: null,
    bonusRuleId: null,
    notes: customNotes || null,
  };
}

/**
 * Helper function to log currency conversions
 */
async function logCurrencyConversion(
  paymentId: number,
  fromCurrency: string,
  toCurrency: string,
  fromAmount: number,
  toAmount: number,
  exchangeRate: number,
  conversionType: string
): Promise<void> {
  if (fromCurrency === toCurrency || !toAmount || !exchangeRate) return;

  const conversionLog: NewCurrencyConversionLog = {
    paymentId,
    fromCurrency: fromCurrency as any,
    toCurrency: toCurrency as any,
    fromAmount: safeNumericString(fromAmount)!,
    toAmount: safeNumericString(toAmount)!,
    exchangeRate: safeNumericString(exchangeRate)!,
    conversionDate: new Date().toISOString().split('T')[0],
    conversionType,
  };

  try {
    await db.insert(currencyConversionLog).values(conversionLog);
  } catch (error) {
    console.warn("Failed to log currency conversion:", error);
  }
}

/**
 * Handles POST requests to create a new payment plan with third-party payment support.
 */
export async function POST(request: NextRequest) {
  let createdPaymentPlan: PaymentPlan | null = null;
  let paymentPlanIdToDelete: number | null = null;
  let createdInstallmentIds: number[] = [];
  let createdPaymentIds: number[] = [];

  try {
    const body = await request.json();
    const validatedData = paymentPlanSchema.parse(body);

    // Validate third-party contact exists if this is a third-party payment
    if (validatedData.isThirdPartyPayment && validatedData.thirdPartyContactId) {
      const thirdPartyContactExists = await db
        .select()
        .from(contact)
        .where(eq(contact.id, validatedData.thirdPartyContactId))
        .limit(1);

      if (!thirdPartyContactExists.length) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: [{
              field: "thirdPartyContactId",
              message: "Third-party contact not found with provided ID",
            }],
          },
          { status: 400 }
        );
      }
    }

    // Validate relationship if provided
    if (validatedData.relationshipId !== undefined) {
      const relationshipExists = await db
        .select()
        .from(relationships)
        .where(eq(relationships.id, validatedData.relationshipId))
        .limit(1);

      if (!relationshipExists.length) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: [{
              field: "relationshipId",
              message: "Relationship not found with provided relationshipId",
            }],
          },
          { status: 400 }
        );
      }
    }

    // Validation for 'custom' distribution type - check whole numbers only
    if (validatedData.distributionType === "custom") {
      if (!validatedData.customInstallments || validatedData.customInstallments.length === 0) {
        return NextResponse.json(
          { error: "Validation failed", details: [{ field: "customInstallments", message: "Custom installments must be provided for 'custom' distribution type." }] },
          { status: 400 }
        );
      }

      // Validate sum of custom installments - check whole numbers only, ignore decimals
      const totalCustomAmount = validatedData.customInstallments.reduce((sum, installment) =>
        sum + Math.floor(installment.installmentAmount), 0
      );
      const expectedAmount = Math.floor(validatedData.totalPlannedAmount);

      if (totalCustomAmount !== expectedAmount) {
        return NextResponse.json(
          { error: "Validation failed", details: [{ field: "totalPlannedAmount", message: `Sum of custom installments whole numbers (${totalCustomAmount}) must equal the total planned amount whole number (${expectedAmount}).` }] },
          { status: 400 }
        );
      }

      // Validate installment dates are unique
      const installmentDates = validatedData.customInstallments.map(inst => inst.installmentDate);
      const uniqueDates = new Set(installmentDates);
      if (uniqueDates.size !== installmentDates.length) {
        return NextResponse.json(
          { error: "Validation failed", details: [{ field: "customInstallments", message: "Installment dates must be unique." }] },
          { status: 400 }
        );
      }

      // Validate that installment dates are not too far in the past
      const currentDate = new Date();
      currentDate.setHours(0, 0, 0, 0);
      const thirtyDaysAgo = new Date(currentDate);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const invalidDates = validatedData.customInstallments.filter(inst => {
        const instDate = new Date(inst.installmentDate);
        instDate.setHours(0, 0, 0, 0);
        return instDate < thirtyDaysAgo;
      });

      if (invalidDates.length > 0) {
        return NextResponse.json(
          { error: "Validation failed", details: [{ field: "customInstallments", message: "Installment dates cannot be more than 30 days in the past." }] },
          { status: 400 }
        );
      }
    }

    // Validation for 'fixed' distribution type - check whole numbers only
    if (validatedData.distributionType === "fixed") {
      if (!validatedData.installmentAmount || !validatedData.numberOfInstallments) {
        return NextResponse.json(
          { error: "Validation failed", details: [{ field: "installmentAmount/numberOfInstallments", message: "Installment amount and number of installments are required for 'fixed' distribution type." }] },
          { status: 400 }
        );
      }

      const totalPlannedAmount = validatedData.totalPlannedAmount;
      const numberOfInstallments = validatedData.numberOfInstallments;
      const installmentAmount = validatedData.installmentAmount;

      // Calculate the correct installment amount
      const correctInstallmentAmount = Math.round((totalPlannedAmount / numberOfInstallments) * 100) / 100;
      const calculatedTotal = installmentAmount * numberOfInstallments;
      const difference = Math.abs(calculatedTotal - totalPlannedAmount);

      // Allow tolerance of 1 cent per installment
      const tolerance = numberOfInstallments * 0.01;

      if (difference > tolerance) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: [{
              field: "installmentAmount",
              message: `Total mismatch: ${numberOfInstallments} × ${installmentAmount.toFixed(2)} = ${calculatedTotal.toFixed(2)}, but total should be ${totalPlannedAmount.toFixed(2)}. Suggested installment amount: ${correctInstallmentAmount.toFixed(2)}`
            }]
          },
          { status: 400 }
        );
      }
    }

    // Check if the associated pledge exists and retrieve its details
    const currentPledge = await db
      .select({
        id: pledge.id,
        exchangeRate: pledge.exchangeRate,
        currency: pledge.currency,
        contactId: pledge.contactId,
      })
      .from(pledge)
      .where(eq(pledge.id, validatedData.pledgeId))
      .limit(1);

    if (currentPledge.length === 0) {
      return NextResponse.json({ error: "Pledge not found" }, { status: 404 });
    }

    // For third-party payments, verify that the pledge belongs to the third-party contact
    if (validatedData.isThirdPartyPayment && validatedData.thirdPartyContactId) {
      if (currentPledge[0].contactId !== validatedData.thirdPartyContactId) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: [{
              field: "pledgeId",
              message: "Selected pledge does not belong to the specified third-party contact",
            }],
          },
          { status: 400 }
        );
      }
    }

    // Parse exchange rate safely from string to number
    const pledgeExchangeRateRaw = currentPledge[0].exchangeRate;
    const pledgeExchangeRate = parseExchangeRate(pledgeExchangeRateRaw);
    const pledgeCurrency = currentPledge[0].currency;

    // Calculate values based on distribution type - use provided values directly
    let finalInstallmentAmount: string;
    let finalNumberOfInstallments: number;
    let finalTotalPlannedAmount: string;

    if (validatedData.distributionType === "custom") {
      // For custom distribution, use provided values directly
      finalNumberOfInstallments = validatedData.customInstallments!.length;
      finalTotalPlannedAmount = validatedData.totalPlannedAmount.toFixed(2);
      finalInstallmentAmount = validatedData.installmentAmount?.toFixed(2) || "0.00";
    } else {
      // For fixed distribution, use provided values directly
      finalInstallmentAmount = validatedData.installmentAmount!.toFixed(2);
      finalNumberOfInstallments = validatedData.numberOfInstallments!;
      finalTotalPlannedAmount = validatedData.totalPlannedAmount.toFixed(2);
    }

    // Calculate USD amounts using proper exchange rates
    let totalPlannedAmountUsd: string | null = null;
    let installmentAmountUsd: string | null = null;
    let effectiveExchangeRate: string | null = null;

    if (validatedData.currency === "USD") {
      totalPlannedAmountUsd = finalTotalPlannedAmount;
      installmentAmountUsd = finalInstallmentAmount;
      effectiveExchangeRate = "1.00";
    } else {
      const usdRate = await getExchangeRate(
        validatedData.currency,
        "USD",
        null, // Pass null to ignore providedRate from form
        validatedData.startDate
      );

      if (usdRate) {
        totalPlannedAmountUsd = (validatedData.totalPlannedAmount * usdRate).toFixed(2);
        if (validatedData.installmentAmount) {
          installmentAmountUsd = (validatedData.installmentAmount * usdRate).toFixed(2);
        }
        effectiveExchangeRate = usdRate.toFixed(4);
      } else if (validatedData.totalPlannedAmountUsd) {
        // Use provided USD amounts if exchange rate calculation fails
        totalPlannedAmountUsd = validatedData.totalPlannedAmountUsd.toFixed(2);
        if (validatedData.installmentAmountUsd) {
          installmentAmountUsd = validatedData.installmentAmountUsd.toFixed(2);
        }
        if (validatedData.exchangeRate) {
          effectiveExchangeRate = validatedData.exchangeRate.toFixed(4);
        }
      }
    }

    // Prepare data for inserting into the paymentPlan table
    const newPaymentPlanData: NewPaymentPlan = {
      pledgeId: validatedData.pledgeId,
      relationshipId: validatedData.relationshipId || null,
      planName: validatedData.planName || null,
      frequency: validatedData.frequency,
      distributionType: validatedData.distributionType,
      totalPlannedAmount: finalTotalPlannedAmount,
      currency: validatedData.currency,
      totalPlannedAmountUsd: totalPlannedAmountUsd,
      installmentAmount: finalInstallmentAmount,
      installmentAmountUsd: installmentAmountUsd,
      numberOfInstallments: finalNumberOfInstallments,
      startDate: validatedData.startDate,
      endDate: safeConvert(validatedData.endDate),
      nextPaymentDate: safeConvert(validatedData.nextPaymentDate) || validatedData.startDate,
      remainingAmount: finalTotalPlannedAmount,
      remainingAmountUsd: totalPlannedAmountUsd,
      planStatus: validatedData.planStatus,
      autoRenew: validatedData.autoRenew,
      currencyPriority: validatedData.currencyPriority,
      remindersSent: 0,
      lastReminderDate: null,
      isActive: true,
      notes: validatedData.notes || null,
      internalNotes: validatedData.internalNotes || null,
      totalPaid: "0.00",
      totalPaidUsd: "0.00",
      exchangeRate: effectiveExchangeRate,
    };

    // Insert the new payment plan
    const paymentPlanResult = await db
      .insert(paymentPlan)
      .values(newPaymentPlanData)
      .returning();

    if (paymentPlanResult.length === 0) {
      throw new Error("Failed to create payment plan record in database. No record returned.");
    }

    createdPaymentPlan = paymentPlanResult[0];
    paymentPlanIdToDelete = createdPaymentPlan.id;

    // ✅ AUDIT LOGGING
    await logPaymentPlanAction("create", createdPaymentPlan.id, validatedData.pledgeId, {
      frequency: validatedData.frequency,
      distributionType: validatedData.distributionType,
      totalPlannedAmount: validatedData.totalPlannedAmount,
      currency: validatedData.currency,
      isThirdPartyPayment: validatedData.isThirdPartyPayment
    });

    // Determine payment configuration for third-party vs regular payments
    const isThirdPartyPayment = validatedData.isThirdPartyPayment;
    const payerContactId = validatedData.payerContactId; // Contact making the payment
    const thirdPartyContactId = validatedData.thirdPartyContactId; // Contact whose pledge this is for

    // Handle installment schedules and scheduled payments based on distribution type
    if (validatedData.distributionType === "custom" && validatedData.customInstallments) {
      // Custom distribution - insert custom installment schedules and payments
      const installmentsToInsert = [];

      for (const inst of validatedData.customInstallments) {
        const instCurrency = inst.currency || validatedData.currency;
        let instAmountUsd: string | null = null;

        if (instCurrency === "USD") {
          instAmountUsd = inst.installmentAmount.toFixed(2);
        } else if (inst.installmentAmountUsd) {
          instAmountUsd = inst.installmentAmountUsd.toFixed(2);
        } else {
          // Calculate USD amount for this installment
          const usdRate = await getExchangeRate(instCurrency, "USD", null, inst.installmentDate); // Pass null
          if (usdRate) {
            instAmountUsd = (inst.installmentAmount * usdRate).toFixed(2);
          }
        }

        installmentsToInsert.push({
          paymentPlanId: createdPaymentPlan!.id,
          installmentDate: inst.installmentDate,
          installmentAmount: safeNumericString(inst.installmentAmount)!,
          currency: instCurrency,
          installmentAmountUsd: instAmountUsd,
          notes: inst.notes || null,
        });
      }

      const installmentResults = await db.insert(installmentSchedule).values(installmentsToInsert).returning();
      createdInstallmentIds = installmentResults.map(inst => inst.id);

      // Create scheduled payments for each custom installment (all as third-party if specified)
      const scheduledPayments: NewPayment[] = [];
      for (let i = 0; i < installmentResults.length; i++) {
        const installmentRecord = installmentResults[i];
        const customInstallment = validatedData.customInstallments[i];

        const scheduledPayment = await createScheduledPayment(
          installmentRecord,
          validatedData,
          validatedData.pledgeId,
          createdPaymentPlan.id,
          pledgeCurrency,
          validatedData.currency, // plan currency
          customInstallment.installmentAmount,
          safeConvert(customInstallment.installmentAmountUsd),
          customInstallment.notes,
          isThirdPartyPayment,
          payerContactId,
          thirdPartyContactId
        );

        // Validate payment data before adding
        const validationErrors = validatePaymentData(scheduledPayment);
        if (validationErrors.length > 0) {
          throw new Error(`Payment validation failed for installment ${i + 1}: ${validationErrors.join(', ')}`);
        }

        scheduledPayments.push(scheduledPayment);
      }

      const paymentResults = await db.insert(payment).values(scheduledPayments).returning();
      createdPaymentIds = paymentResults.map(p => p.id);

      // Log currency conversions for custom installments
      for (let i = 0; i < paymentResults.length; i++) {
        const paymentRecord = paymentResults[i];
        const customInstallment = validatedData.customInstallments[i];

        // Log USD conversion
        if (paymentRecord.amountUsd && paymentRecord.currency !== "USD" && paymentRecord.exchangeRate) {
          await logCurrencyConversion(
            paymentRecord.id,
            paymentRecord.currency,
            "USD",
            customInstallment.installmentAmount,
            parseFloat(paymentRecord.amountUsd),
            parseFloat(paymentRecord.exchangeRate),
            "usd_reporting"
          );
        }

        // Log pledge currency conversion
        if (paymentRecord.amountInPledgeCurrency && paymentRecord.currency !== pledgeCurrency && paymentRecord.pledgeCurrencyExchangeRate) {
          await logCurrencyConversion(
            paymentRecord.id,
            paymentRecord.currency,
            pledgeCurrency,
            customInstallment.installmentAmount,
            parseFloat(paymentRecord.amountInPledgeCurrency),
            parseFloat(paymentRecord.pledgeCurrencyExchangeRate),
            "pledge_balance"
          );
        }

        // Log plan currency conversion
        if (paymentRecord.amountInPlanCurrency && paymentRecord.currency !== validatedData.currency && paymentRecord.planCurrencyExchangeRate) {
          await logCurrencyConversion(
            paymentRecord.id,
            paymentRecord.currency,
            validatedData.currency,
            customInstallment.installmentAmount,
            parseFloat(paymentRecord.amountInPlanCurrency),
            parseFloat(paymentRecord.planCurrencyExchangeRate),
            "plan_tracking"
          );
        }
      }

    } else {
      // Fixed distribution - calculate installment dates and create schedules and payments
      const installmentDates = calculateInstallmentDates(
        validatedData.startDate,
        validatedData.frequency,
        finalNumberOfInstallments
      );

      const installmentsToInsert = installmentDates.map((date) => ({
        paymentPlanId: createdPaymentPlan!.id,
        installmentDate: date,
        installmentAmount: finalInstallmentAmount,
        currency: createdPaymentPlan!.currency,
        installmentAmountUsd: installmentAmountUsd || null,
        notes: null,
      }));

      const installmentResults = await db.insert(installmentSchedule).values(installmentsToInsert).returning();
      createdInstallmentIds = installmentResults.map(inst => inst.id);

      // Create scheduled payments for each fixed installment (all as third-party if specified)
      const scheduledPayments: NewPayment[] = [];
      for (const installmentRecord of installmentResults) {
        const scheduledPayment = await createScheduledPayment(
          installmentRecord,
          validatedData,
          validatedData.pledgeId,
          createdPaymentPlan.id,
          pledgeCurrency,
          validatedData.currency, // plan currency
          parseFloat(finalInstallmentAmount),
          installmentAmountUsd ? parseFloat(installmentAmountUsd) : null,
          null,
          isThirdPartyPayment,
          payerContactId,
          thirdPartyContactId
        );

        // Validate payment data before adding
        const validationErrors = validatePaymentData(scheduledPayment);
        if (validationErrors.length > 0) {
          throw new Error(`Payment validation failed: ${validationErrors.join(', ')}`);
        }

        scheduledPayments.push(scheduledPayment);
      }

      const paymentResults = await db.insert(payment).values(scheduledPayments).returning();
      createdPaymentIds = paymentResults.map(p => p.id);

      // Log currency conversions for fixed installments
      for (const paymentRecord of paymentResults) {
        // Log USD conversion
        if (paymentRecord.amountUsd && paymentRecord.currency !== "USD" && paymentRecord.exchangeRate) {
          await logCurrencyConversion(
            paymentRecord.id,
            paymentRecord.currency,
            "USD",
            parseFloat(finalInstallmentAmount),
            parseFloat(paymentRecord.amountUsd),
            parseFloat(paymentRecord.exchangeRate),
            "usd_reporting"
          );
        }

        // Log pledge currency conversion
        if (paymentRecord.amountInPledgeCurrency && paymentRecord.currency !== pledgeCurrency && paymentRecord.pledgeCurrencyExchangeRate) {
          await logCurrencyConversion(
            paymentRecord.id,
            paymentRecord.currency,
            pledgeCurrency,
            parseFloat(finalInstallmentAmount),
            parseFloat(paymentRecord.amountInPledgeCurrency),
            parseFloat(paymentRecord.pledgeCurrencyExchangeRate),
            "pledge_balance"
          );
        }

        // Log plan currency conversion
        if (paymentRecord.amountInPlanCurrency && paymentRecord.currency !== validatedData.currency && paymentRecord.planCurrencyExchangeRate) {
          await logCurrencyConversion(
            paymentRecord.id,
            paymentRecord.currency,
            validatedData.currency,
            parseFloat(finalInstallmentAmount),
            parseFloat(paymentRecord.amountInPlanCurrency),
            parseFloat(paymentRecord.planCurrencyExchangeRate),
            "plan_tracking"
          );
        }
      }
    }

    // All operations successful
    const successMessage = isThirdPartyPayment
      ? "Third-party payment plan created successfully with scheduled payments"
      : "Payment plan created successfully with scheduled payments";

    return NextResponse.json(
      {
        message: successMessage,
        paymentPlan: createdPaymentPlan,
        scheduledPaymentsCount: createdPaymentIds.length,
        isThirdPartyPayment,
        thirdPartyContactId,
        payerContactId,
      },
      { status: 201 }
    );

  } catch (error) {
    // Enhanced Manual Rollback Logic for Partial Failures
    console.warn("Error occurred during payment plan creation. Attempting rollback...");

    // Rollback payments first (due to foreign key constraints)
    if (createdPaymentIds.length > 0) {
      try {
        await db.delete(payment).where(sql`id = ANY(${createdPaymentIds})`);
        console.warn(`Successfully rolled back ${createdPaymentIds.length} scheduled payments.`);
      } catch (rollbackError) {
        console.error(`CRITICAL: Failed to rollback scheduled payments (IDs: ${createdPaymentIds.join(', ')}). Data inconsistency possible!`, rollbackError);
      }
    }

    // Rollback installment schedules
    if (createdInstallmentIds.length > 0) {
      try {
        await db.delete(installmentSchedule).where(sql`id = ANY(${createdInstallmentIds})`);
        console.warn(`Successfully rolled back ${createdInstallmentIds.length} installment schedules.`);
      } catch (rollbackError) {
        console.error(`CRITICAL: Failed to rollback installment schedules (IDs: ${createdInstallmentIds.join(', ')}). Data inconsistency possible!`, rollbackError);
      }
    }

    // Rollback payment plan
    if (paymentPlanIdToDelete) {
      try {
        await db.delete(paymentPlan).where(eq(paymentPlan.id, paymentPlanIdToDelete));
        console.warn(`Successfully rolled back payment plan (ID: ${paymentPlanIdToDelete}).`);
      } catch (rollbackError) {
        console.error(`CRITICAL: Failed to rollback payment plan (ID: ${paymentPlanIdToDelete}). Data inconsistency possible!`, rollbackError);
      }
    }

    // Error Response Handling
    if (error instanceof z.ZodError) {
      console.error("Validation error during payment plan creation:", error.issues);
      return NextResponse.json(
        {
          error: "Validation failed",
          details: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          }))
        },
        { status: 400 }
      );
    }

    if (error instanceof Error) {
      if (error.message === "Pledge not found") {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error.message.includes("Failed to create payment plan record")) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (error.message.includes("Payment validation failed")) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      const pgError = error as any;
      if (pgError.code) {
        switch (pgError.code) {
          case '23502': // NOT NULL violation
            console.error("PostgreSQL NOT NULL constraint violation:", pgError.detail || pgError.message);
            return NextResponse.json(
              { error: "Required data is missing or invalid (database constraint violation).", detail: pgError.detail || pgError.message },
              { status: 400 }
            );
          case '23503': // Foreign key violation
            console.error("PostgreSQL Foreign Key constraint violation:", pgError.detail || pgError.message);
            return NextResponse.json(
              { error: "Associated record not found (foreign key violation).", detail: pgError.detail || pgError.message },
              { status: 400 }
            );
          case '23505': // Unique constraint violation
            console.error("PostgreSQL Unique constraint violation:", pgError.detail || pgError.message);
            return NextResponse.json(
              { error: "Duplicate data entry (unique constraint violation).", detail: pgError.detail || pgError.message },
              { status: 409 }
            );
          default:
            console.error(`Unhandled PostgreSQL error (Code: ${pgError.code}):`, pgError.message, pgError.detail);
            return NextResponse.json(
              { error: "A database error occurred.", message: pgError.message },
              { status: 500 }
            );
        }
      }
    }

    console.error("Unhandled general error creating payment plan:", error);
    return ErrorHandler.handle(error);
  }
}

// GET Endpoint (unchanged from original)
const querySchema = z.object({
  pledgeId: z.coerce.number().positive().optional(),
  contactId: z.coerce.number().positive().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  planStatus: z
    .enum(["active", "completed", "cancelled", "paused", "overdue"])
    .optional(),
  frequency: z
    .enum([
      "weekly",
      "monthly",
      "quarterly",
      "biannual",
      "annual",
      "one_time",
      "custom",
    ])
    .optional(),
  distributionType: z.enum(["fixed", "custom"]).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsedParams = querySchema.safeParse({
      pledgeId: searchParams.get("pledgeId")
        ? parseInt(searchParams.get("pledgeId")!)
        : undefined,
      contactId: searchParams.get("contactId")
        ? parseInt(searchParams.get("contactId")!)
        : undefined,
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      planStatus: searchParams.get("planStatus") ?? undefined,
      frequency: searchParams.get("frequency") ?? undefined,
      distributionType: searchParams.get("distributionType") ?? undefined,
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

    const { pledgeId, contactId, page, limit, planStatus, frequency, distributionType } =
      parsedParams.data;
    const offset = (page - 1) * limit;
    const conditions = [];

    if (pledgeId) {
      conditions.push(eq(paymentPlan.pledgeId, pledgeId));
    }

    if (contactId) {
      conditions.push(
        sql`(
      ${paymentPlan.pledgeId} IN (SELECT id FROM ${pledge} WHERE contact_id = ${contactId})
      OR
      ${paymentPlan.id} IN (
        SELECT DISTINCT payment_plan_id 
        FROM payment 
        WHERE payer_contact_id = ${contactId} 
        AND is_third_party_payment = true
      )
    )`
      );
    }

    if (planStatus) {
      conditions.push(eq(paymentPlan.planStatus, planStatus));
    }

    if (frequency) {
      conditions.push(eq(paymentPlan.frequency, frequency));
    }

    if (distributionType) {
      conditions.push(eq(paymentPlan.distributionType, distributionType));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const paymentPlansQuery = db
      .select({
        id: paymentPlan.id,
        pledgeId: paymentPlan.pledgeId,
        relationshipId: paymentPlan.relationshipId,
        planName: paymentPlan.planName,
        frequency: paymentPlan.frequency,
        distributionType: paymentPlan.distributionType,
        totalPlannedAmount: paymentPlan.totalPlannedAmount,
        currency: paymentPlan.currency,
        totalPlannedAmountUsd: paymentPlan.totalPlannedAmountUsd,
        installmentAmount: paymentPlan.installmentAmount,
        installmentAmountUsd: paymentPlan.installmentAmountUsd,
        numberOfInstallments: paymentPlan.numberOfInstallments,
        startDate: paymentPlan.startDate,
        endDate: paymentPlan.endDate,
        nextPaymentDate: paymentPlan.nextPaymentDate,
        installmentsPaid: paymentPlan.installmentsPaid,
        totalPaid: paymentPlan.totalPaid,
        totalPaidUsd: paymentPlan.totalPaidUsd,
        remainingAmount: paymentPlan.remainingAmount,
        remainingAmountUsd: paymentPlan.remainingAmountUsd,
        planStatus: paymentPlan.planStatus,
        autoRenew: paymentPlan.autoRenew,
        currencyPriority: paymentPlan.currencyPriority,
        isActive: paymentPlan.isActive,
        notes: paymentPlan.notes,
        internalNotes: paymentPlan.internalNotes,
        createdAt: paymentPlan.createdAt,
        updatedAt: paymentPlan.updatedAt,
        exchangeRate: paymentPlan.exchangeRate,
        paymentMethod: sql<string | null>`(
  SELECT ${payment.paymentMethod} FROM ${payment} 
  WHERE ${payment.paymentPlanId} = ${paymentPlan.id} 
  LIMIT 1
)`.as("paymentMethod"),

        methodDetail: sql<string | null>`(
  SELECT ${payment.methodDetail} FROM ${payment} 
  WHERE ${payment.paymentPlanId} = ${paymentPlan.id} 
  LIMIT 1
)`.as("methodDetail"),


        pledgeDescription: sql<string>`(
      SELECT description FROM ${pledge} WHERE id = ${paymentPlan.pledgeId}
    )`.as("pledgeDescription"),
        pledgeOriginalAmount: sql<string>`(
      SELECT original_amount FROM ${pledge} WHERE id = ${paymentPlan.pledgeId}
    )`.as("pledgeOriginalAmount"),
        contactId: sql<number>`(
      SELECT contact_id FROM ${pledge} WHERE id = ${paymentPlan.pledgeId}
    )`.as("contactId"),

        // Third-party payment information
        isThirdPartyPayment: sql<boolean>`(
      SELECT COALESCE(bool_or(is_third_party_payment), false)
      FROM payment
      WHERE payment_plan_id = payment_plan.id
    )`.as("isThirdPartyPayment"),

        payerContactId: sql<number | null>`(
      SELECT payer_contact_id
      FROM payment
      WHERE payment_plan_id = payment_plan.id
        AND payer_contact_id IS NOT NULL
      LIMIT 1
    )`.as("payerContactId"),

        payerContactName: sql<string | null>`(
      SELECT CONCAT(c.first_name, ' ', c.last_name)
      FROM payment p
      INNER JOIN contact c ON c.id = p.payer_contact_id
      WHERE p.payment_plan_id = payment_plan.id
        AND p.payer_contact_id IS NOT NULL
      LIMIT 1
    )`.as("payerContactName"),

        pledgeContactName: sql<string | null>`(
      SELECT CONCAT(c.first_name, ' ', c.last_name)
      FROM pledge pl
      INNER JOIN contact c ON c.id = pl.contact_id
      WHERE pl.id = payment_plan.pledge_id
    )`.as("pledgeContactName"),
      })
      .from(paymentPlan)
      .where(whereClause)
      .orderBy(sql`${paymentPlan.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    const countQuery = db
      .select({
        count: sql<number>`count(*)`.as("count"),
      })
      .from(paymentPlan)
      .where(whereClause);

    const [paymentPlans, totalCountResult] = await Promise.all([
      paymentPlansQuery.execute(),
      countQuery.execute(),
    ]);

    const totalCount = Number(totalCountResult[0]?.count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    const response = {
      paymentPlans,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      filters: {
        pledgeId,
        contactId,
        planStatus,
        frequency,
        distributionType,
      },
    };
    return NextResponse.json(response, {
      headers: {
        "X-Total-Count": response.pagination.totalCount.toString(),
      },
    });
  } catch (error) {
    console.error("Error fetching payment plans:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch payment plans",
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
