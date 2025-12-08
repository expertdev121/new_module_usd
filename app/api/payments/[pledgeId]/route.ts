import { db } from "@/lib/db";
import { payment, pledge, paymentAllocations, paymentPlan, installmentSchedule, solicitor, bonusCalculation, contact, exchangeRate, currencyEnum, tag, paymentTags } from "@/lib/db/schema";
import type { NewPaymentAllocation, NewPaymentTag } from "@/lib/db/schema";
import { ErrorHandler } from "@/lib/error-handler";
import { eq, desc, or, ilike, and, SQL, sql, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

class AppError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const PaymentStatusEnum = z.enum(["pending", "completed", "failed", "cancelled", "refunded", "processing", "expected"]);
const QueryParamsSchema = z.object({
  pledgeId: z.number().positive(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  search: z.string().optional(),
  paymentStatus: PaymentStatusEnum.optional(),
});

interface PaymentItem {
  id: number;
  pledgeId: number | null;
  paymentPlanId: number | null;
  installmentScheduleId: number | null;
  relationshipId: number | null;
  payerContactId: number | null;
  isThirdPartyPayment: boolean | null;
  amount: string;
  currency: string;
  amountUsd: string | null;
  amountInPledgeCurrency: string | null;
  exchangeRate: string | null;
  paymentDate: string;
  receivedDate: string | null;
  paymentMethod: string | null;
  methodDetail: string | null;
  paymentStatus: string;
  referenceNumber: string | null;
  checkNumber: string | null;
  checkDate: string | null;
  account: string | null;
  receiptNumber: string | null;
  receiptType: string | null;
  receiptIssued: boolean;
  solicitorId: number | null;
  bonusPercentage: string | null;
  bonusAmount: string | null;
  bonusRuleId: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  pledgeExchangeRate: string | null;
  pledgeDescription: string | null;
  contactId: number;
  thirdPartyContactName: string | null;
  payerContactName: string | null;
  isSplitPayment: boolean;
  allocationCount: number;
  solicitorName: string | null;
}

// Allocation schemas
const allocationUpdateSchema = z.object({
  id: z.number().optional(),
  pledgeId: z.number().positive(),
  allocatedAmount: z.number().positive().optional(),
  amount: z.number().positive().optional(),
  notes: z.string().optional().nullable(),
  installmentScheduleId: z.number().optional().nullable(),
  currency: z.enum(["USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR"]).optional(),
  exchangeRate: z.number().positive().optional(),
  receiptNumber: z.string().optional().nullable(),
  receiptType: z.enum(["invoice", "confirmation", "receipt", "other"]).optional().nullable(),
  receiptIssued: z.boolean().optional(),
}).refine((data) => {
  return data.allocatedAmount !== undefined || data.amount !== undefined;
}, {
  message: "Either allocatedAmount or amount must be provided",
}).transform((data) => ({
  ...data,
  allocatedAmount: data.allocatedAmount ?? data.amount!,
  amount: undefined,
}));

const multiContactPledgeSchema = z.object({
  pledgeId: z.number().positive(),
  pledgeDescription: z.string(),
  currency: z.string(),
  balance: z.number(),
  allocatedAmount: z.number().positive()
});
const multiContactAllocationSchema = z.object({
  contactId: z.number().positive(),
  contactName: z.string(),
  pledges: z.array(multiContactPledgeSchema)
});

// The main payment update schema - EXPANDED to include ALL fields
const updatePaymentSchema = z.object({
  paymentId: z.number().positive("Payment ID is required and must be positive"),
  amount: z.number().positive("Amount must be positive").optional(),
  tagIds: z.array(z.number().positive()).optional().default([]),
  currency: z.enum(["USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR"]).optional(),
  amountUsd: z.number().positive("Amount in USD must be positive").optional(),
  amountInPledgeCurrency: z.number().positive("Amount in pledge currency must be positive").optional(),
  amountInPlanCurrency: z.number().positive("Amount in plan currency must be positive").optional(),
  exchangeRate: z.number().positive("Exchange rate must be positive").optional(),
  pledgeCurrencyExchangeRate: z.number().positive("Pledge currency exchange rate must be positive").optional(),
  planCurrencyExchangeRate: z.number().positive("Plan currency exchange rate must be positive").optional(),

  // Date fields
  paymentDate: z.string().min(1, "Payment date is required").optional(),
  receivedDate: z.string().optional().nullable(),
  checkDate: z.string().optional().nullable(),
  paymentMethod: z.string().optional().nullable(),
  methodDetail: z.string().optional().nullable(),
  paymentStatus: PaymentStatusEnum.optional(),

  // Account and reference fields
  account: z.string().optional().nullable(),
  referenceNumber: z.string().optional().nullable(),
  checkNumber: z.string().optional().nullable(),

  // Receipt fields
  receiptNumber: z.string().optional().nullable(),
  receiptType: z.enum(["invoice", "confirmation", "receipt", "other"]).optional().nullable(),
  receiptIssued: z.boolean().optional(),

  // Solicitor and bonus fields
  solicitorId: z.number().positive("Solicitor ID must be positive").optional().nullable(),
  bonusPercentage: z.number().min(0).max(100).optional().nullable(),
  bonusAmount: z.number().min(0).optional().nullable(),
  bonusRuleId: z.number().positive("Bonus rule ID must be positive").optional().nullable(),

  // Notes and relationship
  notes: z.string().optional().nullable(),
  relationshipId: z.number().positive("Relationship ID must be positive").optional().nullable(),

  // Core payment associations
  pledgeId: z.number().positive("Pledge ID must be positive").optional().nullable(),
  paymentPlanId: z.number().positive("Payment plan ID must be positive").optional().nullable(),
  installmentScheduleId: z.number().positive("Installment schedule ID must be positive").optional().nullable(),

  // Third-party payment fields
  isThirdPartyPayment: z.boolean().optional().default(false),
  payerContactId: z.number().positive("Payer contact ID must be positive").optional().nullable(),
  thirdPartyContactId: z.number().positive("Third-party contact ID must be positive").optional().nullable(),

  // Split payment fields
  isSplitPayment: z.boolean().optional(),
  allocations: z.array(allocationUpdateSchema).optional(),

  // Multi-contact payment fields
  isMultiContactPayment: z.boolean().optional().default(false),
  multiContactAllocations: z.array(multiContactAllocationSchema).optional(),

  // Auto-adjustment fields
  autoAdjustAllocations: z.boolean().optional(),
  redistributionMethod: z.enum(["proportional", "equal", "custom"]).optional(),
})
  .transform((data) => {
    // Automatically set isThirdPartyPayment if isMultiContactPayment is true
    if (data.isMultiContactPayment) {
      data.isThirdPartyPayment = true;
    }
    return data;
  })
  .refine((data) => {
    if (data.isSplitPayment && data.allocations && data.allocations.length > 0 && data.amount) {
      const totalAllocated = data.allocations.reduce((sum, alloc) => sum + alloc.allocatedAmount, 0);
      const difference = Math.abs(totalAllocated - data.amount);
      return difference < 0.01;
    }
    return true;
  }, {
    message: "Total allocation amount must equal the payment amount for split payments",
  })
  .refine((data) => {
    if (data.isMultiContactPayment && data.multiContactAllocations && data.multiContactAllocations.length > 0 && data.amount) {
      const totalAllocated = data.multiContactAllocations.reduce((contactSum, contact) => {
        return contactSum + contact.pledges.reduce((pledgeSum, pledge) => pledgeSum + pledge.allocatedAmount, 0);
      }, 0);
      const difference = Math.abs(totalAllocated - data.amount);
      return difference < 0.01;
    }
    return true;
  }, {
    message: "Total multi-contact allocation amount must equal the payment amount",
  })
  .refine((data) => {
    if (data.isThirdPartyPayment && !(data.payerContactId || data.thirdPartyContactId)) {
      return false;
    }
    return true;
  }, {
    message: "Payer contact must be set for third-party payments",
    path: ["payerContactId"],
  })
  .refine((data) => {
    if (data.isThirdPartyPayment && data.paymentPlanId) {
      return false;
    }
    return true;
  }, {
    message: "Third-party payments are not supported for payment plan payments",
    path: ["isThirdPartyPayment"],
  })
  .refine((data) => {
    if (data.isMultiContactPayment && !data.isSplitPayment) {
      return false;
    }
    return true;
  }, {
    message: "Multi-contact payments must be split payments",
    path: ["isMultiContactPayment"],
  });


type AllocationResponse = {
  id: number;
  pledgeId: number;
  allocatedAmount: number;
  notes: string | null;
  currency: (typeof currencyEnum.enumValues)[number] | null;
  installmentScheduleId: number | null;
  receiptNumber: string | null;
  receiptType: string | null;
  receiptIssued: boolean | null;
  createdAt: Date;
  updatedAt: string | null;
};

type UpdatePaymentData = z.infer<typeof updatePaymentSchema>;

// Enhanced validation functions
async function validatePledgeOwnership(pledgeIds: number[], expectedContactId?: number | null): Promise<{ isValid: boolean; invalidPledges: number[]; contactMismatch: boolean }> {
  if (!expectedContactId) {
    return { isValid: true, invalidPledges: [], contactMismatch: false };
  }

  const pledgeOwnership = await db
    .select({
      id: pledge.id,
      contactId: pledge.contactId,
    })
    .from(pledge)
    .where(inArray(pledge.id, pledgeIds));

  const invalidPledges = pledgeIds.filter(id => !pledgeOwnership.find(p => p.id === id));
  const contactMismatch = pledgeOwnership.some(p => p.contactId !== expectedContactId);

  return {
    isValid: invalidPledges.length === 0 && !contactMismatch,
    invalidPledges,
    contactMismatch
  };
}

async function validateMultiContactAllocations(
  multiContactAllocations: Array<{
    contactId: number;
    pledges: Array<{ pledgeId: number; allocatedAmount: number }>;
  }>
): Promise<{ isValid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Validate all pledges exist and belong to the correct contacts
  for (const contactAllocation of multiContactAllocations) {
    const pledgeIds = contactAllocation.pledges.map(p => p.pledgeId);

    if (pledgeIds.length === 0) continue;

    const pledgeOwnerships = await db
      .select({ id: pledge.id, contactId: pledge.contactId })
      .from(pledge)
      .where(inArray(pledge.id, pledgeIds));

    // Check if all pledges exist
    const missingPledges = pledgeIds.filter(id => !pledgeOwnerships.find(p => p.id === id));
    if (missingPledges.length > 0) {
      errors.push(`Pledges not found: ${missingPledges.join(', ')}`);
    }

    // Check if all pledges belong to the correct contact
    const incorrectOwnership = pledgeOwnerships.filter(p => p.contactId !== contactAllocation.contactId);
    if (incorrectOwnership.length > 0) {
      errors.push(`Pledges ${incorrectOwnership.map(p => p.id).join(', ')} do not belong to contact ${contactAllocation.contactId}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
async function validateAndUpdatePaymentTags(paymentId: number, tagIds: number[]): Promise<void> {
  // Delete existing payment tags
  await db.delete(paymentTags).where(eq(paymentTags.paymentId, paymentId));

  if (!tagIds || tagIds.length === 0) return;

  // Validate that all tag IDs exist and are active for payments
  const validTags = await db
    .select({ id: tag.id, name: tag.name })
    .from(tag)
    .where(
      and(
        inArray(tag.id, tagIds),
        eq(tag.isActive, true),
        eq(tag.showOnPayment, true)
      )
    );

  if (validTags.length !== tagIds.length) {
    const validTagIds = validTags.map(t => t.id);
    const invalidTagIds = tagIds.filter(id => !validTagIds.includes(id));
    throw new AppError(
      `Invalid or inactive tag IDs: ${invalidTagIds.join(', ')}`,
      400,
      { invalidTagIds, validTagIds }
    );
  }

  // Create new payment tag associations
  const paymentTagsToInsert: NewPaymentTag[] = tagIds.map(tagId => ({
    paymentId,
    tagId,
    createdAt: new Date(),
  }));

  try {
    await db.insert(paymentTags).values(paymentTagsToInsert);
  } catch (error) {
    console.error('Error creating payment tags:', error);
    throw new AppError('Failed to associate tags with payment', 500);
  }
}

async function validateCurrencyConsistency(
  paymentCurrency: string,
  allocations: Array<{ pledgeId: number; currency?: string; allocatedAmount: number }>
): Promise<{ isValid: boolean; inconsistentAllocations: number[] }> {
  const inconsistentAllocations = allocations
    .filter(alloc => (alloc.currency || paymentCurrency) !== paymentCurrency)
    .map(alloc => alloc.pledgeId);

  return {
    isValid: inconsistentAllocations.length === 0,
    inconsistentAllocations
  };
}

async function validatePaymentPlanConstraints(paymentId: number, newData: UpdatePaymentData): Promise<{ isValid: boolean; reason?: string }> {
  const paymentPlanInfo = await db
    .select({
      id: payment.id,
      paymentPlanId: payment.paymentPlanId,
      installmentScheduleId: payment.installmentScheduleId,
    })
    .from(payment)
    .where(eq(payment.id, paymentId))
    .limit(1);

  if (paymentPlanInfo.length === 0) return { isValid: true };

  const hasPaymentPlan = paymentPlanInfo[0].paymentPlanId !== null;

  if (hasPaymentPlan) {
    // Prevent converting payment plan payments to third-party
    if (newData.isThirdPartyPayment) {
      return {
        isValid: false,
        reason: "Cannot convert payment plan payment to third-party payment"
      };
    }

    // Prevent converting payment plan payments to multi-contact
    if (newData.isMultiContactPayment) {
      return {
        isValid: false,
        reason: "Cannot convert payment plan payment to multi-contact payment"
      };
    }

    // Prevent converting payment plan payments to split (unless already split)
    if (newData.isSplitPayment && !paymentPlanInfo[0].installmentScheduleId) {
      return {
        isValid: false,
        reason: "Cannot convert payment plan payment to split payment"
      };
    }
  }

  return { isValid: true };
}

// Currency conversion helper functions
async function getUsdToCurrencyRate(currency: string, date: string): Promise<number | null> {
  if (currency === 'USD') return 1;

  const rate = await db
    .select()
    .from(exchangeRate)
    .where(
      and(
        eq(exchangeRate.baseCurrency, 'USD' as "USD" | "ILS" | "EUR" | "JPY" | "GBP" | "AUD" | "CAD" | "ZAR"),
        eq(exchangeRate.targetCurrency, currency as "USD" | "ILS" | "EUR" | "JPY" | "GBP" | "AUD" | "CAD" | "ZAR"),
        sql`${exchangeRate.date} <= ${date}`
      )
    )
    .orderBy(desc(exchangeRate.date))
    .limit(1);

  if (rate.length > 0) {
    return parseFloat(rate[0].rate);
  }

  return null;
}

async function getExchangeRate(fromCurrency: string, toCurrency: string, date: string): Promise<number> {
  if (fromCurrency === toCurrency) {
    return 1;
  }

  // Always convert through USD
  const usdToFromRate = await getUsdToCurrencyRate(fromCurrency, date);
  const usdToToRate = await getUsdToCurrencyRate(toCurrency, date);

  if (usdToFromRate && usdToToRate) {
    return usdToToRate / usdToFromRate;
  }

  throw new AppError(`Exchange rate not found for ${fromCurrency} to ${toCurrency} on or before ${date}`, 400);
}

async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  date: string
): Promise<{ convertedAmount: number; exchangeRate: number }> {
  const rate = await getExchangeRate(fromCurrency, toCurrency, date);
  const convertedAmount = amount * rate;

  return { convertedAmount, exchangeRate: rate };
}

async function processMultiContactPayment(
  paymentId: number,
  multiContactAllocations: Array<{
    contactId: number;
    contactName: string;
    pledges: Array<{
      pledgeId: number;
      pledgeDescription: string;
      currency: string;
      balance: number;
      allocatedAmount: number;
    }>;
  }>,
  paymentCurrency: string,
  exchangeRateDate: string,
  payerContactId?: number | null
): Promise<void> {
  // Clear existing allocations
  await db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));

  // Create new allocations for each pledge across multiple contacts
  for (const contactAllocation of multiContactAllocations) {
    for (const pledgeAllocation of contactAllocation.pledges) {
      if (pledgeAllocation.allocatedAmount <= 0) continue;

      // Get pledge info for currency conversion
      const pledgeInfo = await db
        .select({ currency: pledge.currency })
        .from(pledge)
        .where(eq(pledge.id, pledgeAllocation.pledgeId))
        .limit(1);

      if (pledgeInfo.length === 0) continue;

      const pledgeCurrency = pledgeInfo[0].currency;

      // Calculate conversions
      const usdConversion = await convertCurrency(
        pledgeAllocation.allocatedAmount,
        paymentCurrency,
        'USD',
        exchangeRateDate
      );

      const pledgeConversion = await convertCurrency(
        pledgeAllocation.allocatedAmount,
        paymentCurrency,
        pledgeCurrency,
        exchangeRateDate
      );

      // Insert allocation
      const allocationToInsert: NewPaymentAllocation = {
        paymentId: paymentId,
        pledgeId: pledgeAllocation.pledgeId,
        allocatedAmount: pledgeAllocation.allocatedAmount.toFixed(2),
        allocatedAmountUsd: usdConversion.convertedAmount.toFixed(2),
        allocatedAmountInPledgeCurrency: pledgeConversion.convertedAmount.toFixed(2),
        currency: paymentCurrency as "USD" | "ILS" | "EUR" | "JPY" | "GBP" | "AUD" | "CAD" | "ZAR",
        installmentScheduleId: null,
        receiptNumber: null,
        receiptType: null,
        receiptIssued: false,
        notes: null,
        payerContactId: payerContactId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.insert(paymentAllocations).values(allocationToInsert);
    }
  }
}

async function updatePaymentPlanTotals(paymentPlanId: number) {
  const payments = await db
    .select({
      amount: payment.amount,
      paymentStatus: payment.paymentStatus,
    })
    .from(payment)
    .where(and(
      eq(payment.paymentPlanId, paymentPlanId),
      or(
        eq(payment.paymentStatus, "completed"),
        eq(payment.paymentStatus, "processing")
      )
    ));

  const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
  const installmentsPaid = payments.length;

  const paymentPlanResult = await db
    .select({
      totalPlannedAmount: paymentPlan.totalPlannedAmount,
    })
    .from(paymentPlan)
    .where(eq(paymentPlan.id, paymentPlanId))
    .limit(1);

  if (paymentPlanResult.length > 0) {
    const totalPlanned = parseFloat(paymentPlanResult[0].totalPlannedAmount);
    const remainingAmount = Math.max(0, totalPlanned - totalPaid);

    await db
      .update(paymentPlan)
      .set({
        totalPaid: totalPaid.toString(),
        installmentsPaid,
        remainingAmount: remainingAmount.toString(),
        updatedAt: new Date(),
      })
      .where(eq(paymentPlan.id, paymentPlanId));
  }
}

async function updateInstallmentScheduleStatus(installmentScheduleId: number, paymentStatus: string, paidDate?: string | null) {
  let status: "pending" | "paid" | "overdue" | "cancelled" = "pending";

  if (paymentStatus === "completed" || paymentStatus === "processing") {
    status = "paid";
  } else if (paymentStatus === "cancelled" || paymentStatus === "failed") {
    status = "cancelled";
  }

  await db
    .update(installmentSchedule)
    .set({
      status,
      paidDate: status === "paid" && paidDate ? paidDate : null,
      updatedAt: new Date(),
    })
    .where(eq(installmentSchedule.id, installmentScheduleId));
}

async function updatePledgeTotals(pledgeId: number) {
  const pledgeResult = await db
    .select({
      originalAmount: pledge.originalAmount,
      originalAmountUsd: pledge.originalAmountUsd,
      currency: pledge.currency,
      exchangeRate: pledge.exchangeRate,
    })
    .from(pledge)
    .where(eq(pledge.id, pledgeId))
    .limit(1);

  if (pledgeResult.length === 0) {
    throw new AppError("Pledge not found", 404);
  }

  const currentPledge = pledgeResult[0];
  const pledgeCurrency = currentPledge.currency;

  const payments = await db
    .select({
      amount: payment.amount,
      amountUsd: payment.amountUsd,
      amountInPledgeCurrency: payment.amountInPledgeCurrency,
      paymentStatus: payment.paymentStatus,
      currency: payment.currency,
      receivedDate: payment.receivedDate,
      paymentDate: payment.paymentDate,
    })
    .from(payment)
    .where(and(
      eq(payment.pledgeId, pledgeId),
      or(
        eq(payment.paymentStatus, "completed"),
        eq(payment.paymentStatus, "processing")
      )
    ));

  const allocatedPayments = await db
    .select({
      allocatedAmount: paymentAllocations.allocatedAmount,
      allocatedAmountUsd: paymentAllocations.allocatedAmountUsd,
      allocatedAmountInPledgeCurrency: paymentAllocations.allocatedAmountInPledgeCurrency,
      currency: paymentAllocations.currency,
      paymentStatus: payment.paymentStatus,
      receivedDate: payment.receivedDate,
      paymentDate: payment.paymentDate,
    })
    .from(paymentAllocations)
    .innerJoin(payment, eq(paymentAllocations.paymentId, payment.id))
    .where(and(
      eq(paymentAllocations.pledgeId, pledgeId),
      or(
        eq(payment.paymentStatus, "completed"),
        eq(payment.paymentStatus, "processing")
      )
    ));

  let totalPaidInPledgeCurrency = 0;
  let totalPaidUsd = 0;

  for (const p of payments) {
    const exchangeRateDate = p.receivedDate || new Date().toISOString().split('T')[0];

    if (p.amountInPledgeCurrency) {
      totalPaidInPledgeCurrency += parseFloat(p.amountInPledgeCurrency);
    } else {
      const { convertedAmount } = await convertCurrency(
        parseFloat(p.amount),
        p.currency,
        pledgeCurrency,
        exchangeRateDate
      );
      totalPaidInPledgeCurrency += convertedAmount;
    }

    if (p.amountUsd) {
      totalPaidUsd += parseFloat(p.amountUsd);
    } else {
      const { convertedAmount } = await convertCurrency(
        parseFloat(p.amount),
        p.currency,
        'USD',
        exchangeRateDate
      );
      totalPaidUsd += convertedAmount;
    }
  }

  for (const a of allocatedPayments) {
    const exchangeRateDate = a.receivedDate || new Date().toISOString().split('T')[0];

    if (a.allocatedAmountInPledgeCurrency) {
      totalPaidInPledgeCurrency += parseFloat(a.allocatedAmountInPledgeCurrency);
    } else {
      const { convertedAmount } = await convertCurrency(
        parseFloat(a.allocatedAmount),
        a.currency,
        pledgeCurrency,
        exchangeRateDate
      );
      totalPaidInPledgeCurrency += convertedAmount;
    }

    if (a.allocatedAmountUsd) {
      totalPaidUsd += parseFloat(a.allocatedAmountUsd);
    } else {
      const { convertedAmount } = await convertCurrency(
        parseFloat(a.allocatedAmount),
        a.currency,
        'USD',
        exchangeRateDate
      );
      totalPaidUsd += convertedAmount;
    }
  }

  const originalAmount = parseFloat(currentPledge.originalAmount);
  const balance = Math.max(0, originalAmount - totalPaidInPledgeCurrency);

  const originalAmountUsd = currentPledge.originalAmountUsd ? parseFloat(currentPledge.originalAmountUsd) : null;
  const balanceUsd = originalAmountUsd ? Math.max(0, originalAmountUsd - totalPaidUsd) : null;

  await db
    .update(pledge)
    .set({
      totalPaid: totalPaidInPledgeCurrency.toFixed(2),
      balance: balance.toFixed(2),
      totalPaidUsd: totalPaidUsd > 0 ? totalPaidUsd.toFixed(2) : null,
      balanceUsd: balanceUsd !== null ? balanceUsd.toFixed(2) : null,
      updatedAt: new Date(),
    })
    .where(eq(pledge.id, pledgeId));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ pledgeId: string }> }
) {
  let validatedData: z.infer<typeof updatePaymentSchema>;
  try {
    const resolvedParams = await params;
    const rawPledgeId = resolvedParams.pledgeId;
    const pledgeId = parseInt(rawPledgeId, 10);

    const body: unknown = await request.json();

    try {
      validatedData = updatePaymentSchema.parse(body);
    } catch (zodErr) {
      if (zodErr instanceof z.ZodError) {
        return NextResponse.json(
          {
            error: "Validation failed",
            details: zodErr.issues.map((issue) => ({
              field: issue.path.join("."),
              message: issue.message,
              received: issue.code === "invalid_type" ? `${issue.received}` : undefined,
              expected: issue.code === "invalid_type" ? `${issue.expected}` : undefined,
            })),
          },
          { status: 400 }
        );
      }
      throw zodErr;
    }

    const paymentId = validatedData.paymentId;

    // Enhanced validation: Check payment plan constraints
    const paymentPlanValidation = await validatePaymentPlanConstraints(paymentId, validatedData);
    if (!paymentPlanValidation.isValid) {
      throw new AppError(paymentPlanValidation.reason || "Payment plan constraint violation", 400);
    }

    // Validate multi-contact allocations if provided
    if (validatedData.isMultiContactPayment && validatedData.multiContactAllocations) {
      const multiContactValidation = await validateMultiContactAllocations(validatedData.multiContactAllocations);
      if (!multiContactValidation.isValid) {
        throw new AppError(
          "Multi-contact allocation validation failed",
          400,
          { errors: multiContactValidation.errors }
        );
      }
    }

    // Get existing payment with comprehensive data
    const existingPayment = await db
      .select({
        id: payment.id,
        pledgeId: payment.pledgeId,
        paymentPlanId: payment.paymentPlanId,
        installmentScheduleId: payment.installmentScheduleId,
        amount: payment.amount,
        currency: payment.currency,
        paymentStatus: payment.paymentStatus,
        solicitorId: payment.solicitorId,
        bonusRuleId: payment.bonusRuleId,
        exchangeRate: payment.exchangeRate,
        paymentDate: payment.paymentDate,
        receivedDate: payment.receivedDate,
        payerContactId: payment.payerContactId,
        isThirdPartyPayment: payment.isThirdPartyPayment,
        contactId: sql<number>`(
          SELECT contact_id FROM ${pledge} WHERE id = ${payment.pledgeId}
        )`.as("contactId"),
      })
      .from(payment)
      .leftJoin(pledge, eq(payment.pledgeId, pledge.id))
      .where(eq(payment.id, paymentId))
      .limit(1);

    if (existingPayment.length === 0) {
      throw new AppError("Payment not found.", 404);
    }
    const currentPayment = existingPayment[0];

    // Get existing allocations
    const existingAllocations = await db
      .select({
        id: paymentAllocations.id,
        pledgeId: paymentAllocations.pledgeId,
        allocatedAmount: paymentAllocations.allocatedAmount,
        currency: paymentAllocations.currency,
        installmentScheduleId: paymentAllocations.installmentScheduleId,
        payerContactId: paymentAllocations.payerContactId,
      })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentId));

    const isCurrentlySplit = existingAllocations.length > 0;
    const willBeSplit = validatedData.isSplitPayment === true;
    const isCurrentlyMultiContact = false; // We'll determine this from the data
    const willBeMultiContact = validatedData.isMultiContactPayment === true;

    // Enhanced validation for third-party split payments
    if (validatedData.isThirdPartyPayment && validatedData.isSplitPayment && validatedData.allocations) {
      const pledgeIds = validatedData.allocations.map(a => a.pledgeId);

      // Get the contact ID from the pledges to validate ownership
      const pledgeOwnerships = await db
        .select({ id: pledge.id, contactId: pledge.contactId })
        .from(pledge)
        .where(inArray(pledge.id, pledgeIds));

      const uniqueContactIds = [...new Set(pledgeOwnerships.map(p => p.contactId))];

      // For third-party payments, all pledges should belong to the same contact
      if (uniqueContactIds.length > 1) {
        throw new AppError(
          "Cross-contact allocation error",
          400,
          { details: "All allocations must be to pledges belonging to the same contact for third-party payments." }
        );
      }
    }

    // Enhanced validation for regular third-party payments
    if (validatedData.isThirdPartyPayment && !validatedData.isSplitPayment && validatedData.pledgeId) {
      // The pledge ownership is determined by the pledgeId itself, no need for additional validation
      // since the frontend handles contact selection correctly
    }

    // Enhanced currency validation for split payments
    if (validatedData.isSplitPayment && validatedData.allocations) {
      const paymentCurrency = validatedData.currency || currentPayment.currency;
      const currencyValidation = await validateCurrencyConsistency(paymentCurrency, validatedData.allocations);

      if (!currencyValidation.isValid) {
        throw new AppError(
          "Currency consistency error",
          400,
          { details: `All allocations must use the payment currency (${paymentCurrency}). Inconsistent pledges: ${currencyValidation.inconsistentAllocations.join(', ')}` }
        );
      }
    }

    // Track pledges that need total updates
    const pledgesToUpdate = new Set<number>();

    if (currentPayment.pledgeId) {
      pledgesToUpdate.add(currentPayment.pledgeId);
    }

    existingAllocations.forEach(alloc => pledgesToUpdate.add(alloc.pledgeId));

    // UPDATED buildUpdateData function to handle ALL fields from the schema
    const buildUpdateData = async (data: typeof validatedData) => {
      const {
        paymentId,
        allocations,
        isSplitPayment,
        autoAdjustAllocations,
        redistributionMethod,
        multiContactAllocations,
        isMultiContactPayment,
        thirdPartyContactId,
        ...dataToUpdate
      } = data;

      const baseUpdateData: Record<string, string | number | boolean | null | undefined | Date> = {
        updatedAt: new Date(),
      };

      // Handle all core payment fields
      if (dataToUpdate.amount !== undefined) {
        baseUpdateData.amount = dataToUpdate.amount.toString();
      }
      if (dataToUpdate.currency !== undefined) {
        baseUpdateData.currency = dataToUpdate.currency;
      }
      if (dataToUpdate.amountUsd !== undefined) {
        baseUpdateData.amountUsd = dataToUpdate.amountUsd.toFixed(2);
      }
      if (dataToUpdate.amountInPledgeCurrency !== undefined) {
        baseUpdateData.amountInPledgeCurrency = dataToUpdate.amountInPledgeCurrency.toFixed(2);
      }
      if (dataToUpdate.amountInPlanCurrency !== undefined) {
        baseUpdateData.amountInPlanCurrency = dataToUpdate.amountInPlanCurrency.toFixed(2);
      }
      if (dataToUpdate.exchangeRate !== undefined) {
        baseUpdateData.exchangeRate = dataToUpdate.exchangeRate.toFixed(4);
      }
      if (dataToUpdate.pledgeCurrencyExchangeRate !== undefined) {
        baseUpdateData.pledgeCurrencyExchangeRate = dataToUpdate.pledgeCurrencyExchangeRate.toFixed(4);
      }
      if (dataToUpdate.planCurrencyExchangeRate !== undefined) {
        baseUpdateData.planCurrencyExchangeRate = dataToUpdate.planCurrencyExchangeRate.toFixed(4);
      }

      // Date fields
      if (dataToUpdate.paymentDate !== undefined) {
        baseUpdateData.paymentDate = dataToUpdate.paymentDate;
      }
      if (dataToUpdate.receivedDate !== undefined) {
        baseUpdateData.receivedDate = dataToUpdate.receivedDate;
      }
      if (dataToUpdate.checkDate !== undefined) {
        baseUpdateData.checkDate = dataToUpdate.checkDate;
      }

      // Payment method and details
      if (dataToUpdate.paymentMethod !== undefined) {
        baseUpdateData.paymentMethod = dataToUpdate.paymentMethod;
      }
      if (dataToUpdate.methodDetail !== undefined) {
        baseUpdateData.methodDetail = dataToUpdate.methodDetail;
      }
      if (dataToUpdate.paymentStatus !== undefined) {
        baseUpdateData.paymentStatus = dataToUpdate.paymentStatus;
      }

      // Account and reference fields
      if (dataToUpdate.account !== undefined) {
        baseUpdateData.account = dataToUpdate.account;
      }
      if (dataToUpdate.referenceNumber !== undefined) {
        baseUpdateData.referenceNumber = dataToUpdate.referenceNumber;
      }
      if (dataToUpdate.checkNumber !== undefined) {
        baseUpdateData.checkNumber = dataToUpdate.checkNumber;
      }

      // Receipt fields
      if (dataToUpdate.receiptNumber !== undefined) {
        baseUpdateData.receiptNumber = dataToUpdate.receiptNumber;
      }
      if (dataToUpdate.receiptType !== undefined) {
        baseUpdateData.receiptType = dataToUpdate.receiptType;
      }
      if (dataToUpdate.receiptIssued !== undefined) {
        baseUpdateData.receiptIssued = dataToUpdate.receiptIssued;
      }

      // Solicitor and bonus fields
      if (dataToUpdate.solicitorId !== undefined) {
        baseUpdateData.solicitorId = dataToUpdate.solicitorId;
      }
      if (dataToUpdate.bonusPercentage !== undefined) {
        baseUpdateData.bonusPercentage = dataToUpdate.bonusPercentage?.toString() || null;
      }
      if (dataToUpdate.bonusAmount !== undefined) {
        baseUpdateData.bonusAmount = dataToUpdate.bonusAmount?.toString() || null;
      }
      if (dataToUpdate.bonusRuleId !== undefined) {
        baseUpdateData.bonusRuleId = dataToUpdate.bonusRuleId;
      }

      // Notes and relationship
      if (dataToUpdate.notes !== undefined) {
        baseUpdateData.notes = dataToUpdate.notes;
      }
      if (dataToUpdate.relationshipId !== undefined) {
        baseUpdateData.relationshipId = dataToUpdate.relationshipId;
      }

      // Core payment associations
      if (dataToUpdate.pledgeId !== undefined) {
        baseUpdateData.pledgeId = dataToUpdate.pledgeId;
      }
      if (dataToUpdate.paymentPlanId !== undefined) {
        baseUpdateData.paymentPlanId = dataToUpdate.paymentPlanId;
      }
      if (dataToUpdate.installmentScheduleId !== undefined) {
        baseUpdateData.installmentScheduleId = dataToUpdate.installmentScheduleId;
      }

      // FIXED: Proper third-party payment handling for ALL payment types including multi-contact
      if (data.isThirdPartyPayment !== undefined) {
        baseUpdateData.isThirdPartyPayment = data.isThirdPartyPayment;

        if (data.isThirdPartyPayment) {
          // Use thirdPartyContactId if provided, otherwise payerContactId
          baseUpdateData.payerContactId = data.payerContactId;
        } else {
          // Only set to null if explicitly converting from third-party to regular
          baseUpdateData.payerContactId = null;
        }
      } else if (data.payerContactId !== undefined) {
        // If just updating the payer contact ID without changing isThirdPartyPayment
        baseUpdateData.payerContactId = data.thirdPartyContactId || data.payerContactId;
        // Ensure isThirdPartyPayment is true when setting a payer contact
        if (baseUpdateData.payerContactId) {
          baseUpdateData.isThirdPartyPayment = true;
        }
      }

      // Use receivedDate when present, fall back to today's date
      const exchangeRateDate = data.receivedDate || new Date().toISOString().split('T')[0];
      const newCurrency = data.currency || currentPayment.currency;
      const newAmount = data.amount || parseFloat(currentPayment.amount);

      // Auto-calculate USD conversion if amount or currency changed
      if (data.amount || data.currency) {
        if (!dataToUpdate.amountUsd && !dataToUpdate.exchangeRate) {
          const usdConversion = await convertCurrency(newAmount, newCurrency, 'USD', exchangeRateDate);
          baseUpdateData.amountUsd = usdConversion.convertedAmount.toFixed(2);
          baseUpdateData.exchangeRate = usdConversion.exchangeRate.toFixed(4);
        }
      }

      // Auto-calculate pledge currency conversion if applicable
      if ((data.amount || data.currency) && (data.pledgeId || currentPayment.pledgeId)) {
        const targetPledgeId = data.pledgeId || currentPayment.pledgeId;
        if (targetPledgeId && !dataToUpdate.amountInPledgeCurrency && !dataToUpdate.pledgeCurrencyExchangeRate) {
          const pledgeData = await db
            .select({ currency: pledge.currency })
            .from(pledge)
            .where(eq(pledge.id, targetPledgeId))
            .limit(1);

          if (pledgeData.length > 0) {
            const pledgeCurrency = pledgeData[0].currency;
            const pledgeConversion = await convertCurrency(newAmount, newCurrency, pledgeCurrency, exchangeRateDate);
            baseUpdateData.amountInPledgeCurrency = pledgeConversion.convertedAmount.toFixed(2);
            baseUpdateData.pledgeCurrencyExchangeRate = pledgeConversion.exchangeRate.toFixed(4);
          }
        }
      }

      // Auto-calculate plan currency conversion if applicable
      if ((data.amount || data.currency) && (data.paymentPlanId || currentPayment.paymentPlanId)) {
        const targetPaymentPlanId = data.paymentPlanId || currentPayment.paymentPlanId;
        if (targetPaymentPlanId && !dataToUpdate.amountInPlanCurrency && !dataToUpdate.planCurrencyExchangeRate) {
          const planData = await db
            .select({ currency: paymentPlan.currency })
            .from(paymentPlan)
            .where(eq(paymentPlan.id, targetPaymentPlanId))
            .limit(1);

          if (planData.length > 0) {
            const planCurrency = planData[0].currency;
            const planConversion = await convertCurrency(newAmount, newCurrency, planCurrency, exchangeRateDate);
            baseUpdateData.amountInPlanCurrency = planConversion.convertedAmount.toFixed(2);
            baseUpdateData.planCurrencyExchangeRate = planConversion.exchangeRate.toFixed(4);
          }
        }
      }

      return baseUpdateData;
    };

    // SCENARIO 1: Converting to multi-contact payment
    if (!isCurrentlyMultiContact && willBeMultiContact && validatedData.multiContactAllocations) {
      console.log("Converting to multi-contact payment");

      if (currentPayment.installmentScheduleId) {
        await db
          .update(installmentSchedule)
          .set({
            status: "pending",
            paidDate: null,
            updatedAt: new Date(),
          })
          .where(eq(installmentSchedule.id, currentPayment.installmentScheduleId));
      }

      // Clear existing allocations if any
      if (existingAllocations.length > 0) {
        await db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
      }

      const updateData = await buildUpdateData(validatedData);
      updateData.pledgeId = null;
      updateData.installmentScheduleId = null;
      updateData.amountInPledgeCurrency = null;
      updateData.pledgeCurrencyExchangeRate = null;

      await db.update(payment).set(updateData).where(eq(payment.id, paymentId));

      // Process multi-contact allocations
      const exchangeRateDate = validatedData.receivedDate || new Date().toISOString().split('T')[0];
      const paymentCurrency = validatedData.currency || currentPayment.currency;

      await processMultiContactPayment(
        paymentId,
        validatedData.multiContactAllocations,
        paymentCurrency,
        exchangeRateDate,
        validatedData.isThirdPartyPayment ? (validatedData.thirdPartyContactId || validatedData.payerContactId) : null
      );

      // Add all pledges from multi-contact allocations to update list
      validatedData.multiContactAllocations.forEach(contact => {
        contact.pledges.forEach(pledge => pledgesToUpdate.add(pledge.pledgeId));
      });
    }

    // SCENARIO 2: Converting split payment to regular payment
    else if (isCurrentlySplit && !willBeSplit) {
      console.log("Converting split payment to regular payment");

      const targetPledgeId = validatedData.pledgeId || currentPayment.pledgeId;
      if (!targetPledgeId) {
        throw new AppError("Target pledge ID is required when converting split payment to regular payment", 400);
      }

      const targetPledgeExists = await db
        .select({ id: pledge.id })
        .from(pledge)
        .where(eq(pledge.id, targetPledgeId))
        .limit(1);
      if (targetPledgeExists.length === 0) {
        throw new AppError(`Target pledge with ID ${targetPledgeId} does not exist`, 400);
      }

      const allocationInstallmentIds = existingAllocations
        .filter(a => a.installmentScheduleId)
        .map(a => a.installmentScheduleId!);

      if (allocationInstallmentIds.length > 0) {
        for (const installmentId of allocationInstallmentIds) {
          await db
            .update(installmentSchedule)
            .set({
              status: "pending",
              paidDate: null,
              updatedAt: new Date(),
            })
            .where(eq(installmentSchedule.id, installmentId));
        }
      }

      await db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));

      const updateData = await buildUpdateData(validatedData);
      updateData.pledgeId = targetPledgeId;

      await db.update(payment).set(updateData).where(eq(payment.id, paymentId));
      pledgesToUpdate.add(targetPledgeId);
    }

    // SCENARIO 3: Converting regular payment to split payment (including multi-contact)
    else if (!isCurrentlySplit && willBeSplit) {
      console.log("Converting regular payment to split payment");

      // Handle multi-contact case
      if (willBeMultiContact && validatedData.multiContactAllocations) {
        const totalAllocated = validatedData.multiContactAllocations.reduce((contactSum, contact) => {
          return contactSum + contact.pledges.reduce((pledgeSum, pledge) => pledgeSum + pledge.allocatedAmount, 0);
        }, 0);
        const paymentAmount = validatedData.amount ?? parseFloat(currentPayment.amount);

        if (Math.abs(totalAllocated - paymentAmount) > 0.01) {
          throw new AppError(
            "Invalid multi-contact allocation amounts",
            400,
            {
              details: `Total allocated amount (${totalAllocated.toFixed(2)}) must equal payment amount (${paymentAmount.toFixed(2)}).`,
              totalAllocated,
              paymentAmount,
              difference: Math.abs(totalAllocated - paymentAmount),
            }
          );
        }

        if (currentPayment.installmentScheduleId) {
          await db
            .update(installmentSchedule)
            .set({
              status: "pending",
              paidDate: null,
              updatedAt: new Date(),
            })
            .where(eq(installmentSchedule.id, currentPayment.installmentScheduleId));
        }

        const updateData = await buildUpdateData(validatedData);
        updateData.pledgeId = null;
        updateData.installmentScheduleId = null;
        updateData.amountInPledgeCurrency = null;
        updateData.pledgeCurrencyExchangeRate = null;

        await db.update(payment).set(updateData).where(eq(payment.id, paymentId));

        const exchangeRateDate = validatedData.receivedDate || new Date().toISOString().split('T')[0];
        const paymentCurrency = validatedData.currency || currentPayment.currency;

        await processMultiContactPayment(
          paymentId,
          validatedData.multiContactAllocations,
          paymentCurrency,
          exchangeRateDate,
          validatedData.isThirdPartyPayment ? (validatedData.thirdPartyContactId || validatedData.payerContactId) : null
        );

        validatedData.multiContactAllocations.forEach(contact => {
          contact.pledges.forEach(pledge => pledgesToUpdate.add(pledge.pledgeId));
        });
      }
      // Handle regular split payment
      else if (validatedData.allocations && validatedData.allocations.length > 0) {
        const totalAllocated = validatedData.allocations.reduce((sum, alloc) => sum + alloc.allocatedAmount, 0);
        const paymentAmount = validatedData.amount ?? parseFloat(currentPayment.amount);

        if (Math.abs(totalAllocated - paymentAmount) > 0.01) {
          throw new AppError(
            "Invalid allocation amounts",
            400,
            {
              details: `Total allocated amount (${totalAllocated.toFixed(2)}) must equal payment amount (${paymentAmount.toFixed(2)}).`,
              totalAllocated,
              paymentAmount,
              difference: Math.abs(totalAllocated - paymentAmount),
            }
          );
        }

        const pledgeMap = new Map();
        for (const allocation of validatedData.allocations) {
          if (!allocation.allocatedAmount || allocation.allocatedAmount <= 0) {
            throw new AppError(
              "Invalid allocation amount",
              400,
              { details: `Allocated amount must be positive. Found: ${allocation.allocatedAmount || 0} for pledge ${allocation.pledgeId}` }
            );
          }

          const pledgeExists = await db
            .select({
              id: pledge.id,
              currency: pledge.currency,
              exchangeRate: pledge.exchangeRate,
              contactId: pledge.contactId
            })
            .from(pledge)
            .where(eq(pledge.id, allocation.pledgeId))
            .limit(1);

          if (pledgeExists.length === 0) {
            throw new AppError(
              "Invalid pledge ID in allocation",
              400,
              { details: `Pledge with ID ${allocation.pledgeId} does not exist.` }
            );
          }

          pledgeMap.set(allocation.pledgeId, pledgeExists[0]);
          pledgesToUpdate.add(allocation.pledgeId);
        }

        if (currentPayment.installmentScheduleId) {
          await db
            .update(installmentSchedule)
            .set({
              status: "pending",
              paidDate: null,
              updatedAt: new Date(),
            })
            .where(eq(installmentSchedule.id, currentPayment.installmentScheduleId));
        }

        const updateData = await buildUpdateData(validatedData);
        updateData.pledgeId = null;
        updateData.installmentScheduleId = null;
        updateData.amountInPledgeCurrency = null;
        updateData.pledgeCurrencyExchangeRate = null;

        await db.update(payment).set(updateData).where(eq(payment.id, paymentId));

        const exchangeRateDate = validatedData.receivedDate || new Date().toISOString().split('T')[0];
        const paymentCurrency = validatedData.currency || currentPayment.currency;

        for (const alloc of validatedData.allocations) {
          const pledgeInfo = pledgeMap.get(alloc.pledgeId);
          const allocationCurrency = alloc.currency ?? paymentCurrency;

          const usdConversion = await convertCurrency(
            alloc.allocatedAmount,
            allocationCurrency,
            'USD',
            exchangeRateDate
          );

          const pledgeConversion = await convertCurrency(
            alloc.allocatedAmount,
            allocationCurrency,
            pledgeInfo.currency,
            exchangeRateDate
          );

          const allocationToInsert: NewPaymentAllocation = {
            paymentId: paymentId,
            pledgeId: alloc.pledgeId,
            allocatedAmount: alloc.allocatedAmount.toFixed(2),
            allocatedAmountUsd: usdConversion.convertedAmount.toFixed(2),
            allocatedAmountInPledgeCurrency: pledgeConversion.convertedAmount.toFixed(2),
            currency: allocationCurrency as "USD" | "ILS" | "EUR" | "JPY" | "GBP" | "AUD" | "CAD" | "ZAR",
            installmentScheduleId: alloc.installmentScheduleId ?? null,
            receiptNumber: alloc.receiptNumber ?? null,
            receiptType: alloc.receiptType ?? null,
            receiptIssued: alloc.receiptIssued ?? false,
            notes: alloc.notes ?? null,
            payerContactId: validatedData.isThirdPartyPayment ? (validatedData.thirdPartyContactId || validatedData.payerContactId) : null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await db.insert(paymentAllocations).values(allocationToInsert);

          if (alloc.installmentScheduleId && validatedData.paymentStatus) {
            await updateInstallmentScheduleStatus(
              alloc.installmentScheduleId,
              validatedData.paymentStatus,
              validatedData.receivedDate || validatedData.paymentDate
            );
          }
        }
      } else {
        throw new AppError("Allocations must be provided when converting to split payment.", 400);
      }
    }

    // SCENARIO 4: Updating existing split payment (including multi-contact)
    else if (isCurrentlySplit && willBeSplit) {
      console.log("Updating existing split payment");

      // Handle multi-contact update
      if (willBeMultiContact && validatedData.multiContactAllocations) {
        const totalAllocated = validatedData.multiContactAllocations.reduce((contactSum, contact) => {
          return contactSum + contact.pledges.reduce((pledgeSum, pledge) => pledgeSum + pledge.allocatedAmount, 0);
        }, 0);
        const paymentAmount = validatedData.amount ?? parseFloat(currentPayment.amount);

        if (Math.abs(totalAllocated - paymentAmount) > 0.01) {
          throw new AppError(
            "Invalid multi-contact allocation amounts",
            400,
            {
              details: `Total allocated amount (${totalAllocated.toFixed(2)}) must equal payment amount (${paymentAmount.toFixed(2)}).`,
              totalAllocated,
              paymentAmount,
              difference: Math.abs(totalAllocated - paymentAmount),
            }
          );
        }

        // Clear existing allocations
        const allocationsToDelete = existingAllocations;
        for (const allocation of allocationsToDelete) {
          if (allocation.installmentScheduleId) {
            await db
              .update(installmentSchedule)
              .set({
                status: "pending",
                paidDate: null,
                updatedAt: new Date(),
              })
              .where(eq(installmentSchedule.id, allocation.installmentScheduleId));
          }
        }

        await db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));

        const updateData = await buildUpdateData(validatedData);
        updateData.amountInPledgeCurrency = null;
        updateData.pledgeCurrencyExchangeRate = null;

        await db.update(payment).set(updateData).where(eq(payment.id, paymentId));

        const exchangeRateDate = validatedData.receivedDate || new Date().toISOString().split('T')[0];
        const paymentCurrency = validatedData.currency || currentPayment.currency;

        await processMultiContactPayment(
          paymentId,
          validatedData.multiContactAllocations,
          paymentCurrency,
          exchangeRateDate,
          validatedData.isThirdPartyPayment ? (validatedData.thirdPartyContactId || validatedData.payerContactId) : null
        );

        validatedData.multiContactAllocations.forEach(contact => {
          contact.pledges.forEach(pledge => pledgesToUpdate.add(pledge.pledgeId));
        });
      }
      // Handle regular split payment update
      else if (Array.isArray(validatedData.allocations) && validatedData.allocations.length > 0) {
        const totalAllocated = validatedData.allocations.reduce((sum, alloc) => sum + alloc.allocatedAmount, 0);
        const paymentAmount = validatedData.amount ?? parseFloat(currentPayment.amount);

        if (Math.abs(totalAllocated - paymentAmount) > 0.01) {
          throw new AppError(
            "Invalid allocation amounts",
            400,
            {
              details: `Total allocated amount (${totalAllocated.toFixed(2)}) must equal payment amount (${paymentAmount.toFixed(2)}).`,
              totalAllocated,
              paymentAmount,
              difference: Math.abs(totalAllocated - paymentAmount),
            }
          );
        }

        const pledgeMap = new Map();
        for (const allocation of validatedData.allocations) {
          if (allocation.id) {
            const existingAllocation = existingAllocations.find((existing) => existing.id === allocation.id);
            if (!existingAllocation) {
              throw new AppError(
                "Invalid allocation ID",
                400,
                { details: `Allocation with ID ${allocation.id} does not exist for this payment.` }
              );
            }
          }

          if (!allocation.allocatedAmount || allocation.allocatedAmount <= 0) {
            throw new AppError(
              "Invalid allocation amount",
              400,
              { details: `Allocated amount must be positive. Found: ${allocation.allocatedAmount || 0} for pledge ${allocation.pledgeId}` }
            );
          }

          const pledgeExists = await db
            .select({
              id: pledge.id,
              currency: pledge.currency,
              exchangeRate: pledge.exchangeRate,
              contactId: pledge.contactId
            })
            .from(pledge)
            .where(eq(pledge.id, allocation.pledgeId))
            .limit(1);

          if (pledgeExists.length === 0) {
            throw new AppError(
              "Invalid pledge ID in allocation",
              400,
              { details: `Pledge with ID ${allocation.pledgeId} does not exist.` }
            );
          }

          pledgeMap.set(allocation.pledgeId, pledgeExists[0]);
          pledgesToUpdate.add(allocation.pledgeId);
        }

        const newAllocationIds = validatedData.allocations.filter(a => a.id).map(a => a.id!);
        const allocationsToDelete = existingAllocations.filter(
          existing => !newAllocationIds.includes(existing.id)
        );

        for (const allocation of allocationsToDelete) {
          if (allocation.installmentScheduleId) {
            await db
              .update(installmentSchedule)
              .set({
                status: "pending",
                paidDate: null,
                updatedAt: new Date(),
              })
              .where(eq(installmentSchedule.id, allocation.installmentScheduleId));
          }
        }

        if (allocationsToDelete.length > 0) {
          for (const allocationToDelete of allocationsToDelete) {
            await db
              .delete(paymentAllocations)
              .where(eq(paymentAllocations.id, allocationToDelete.id));
          }
        }

        const updateData = await buildUpdateData(validatedData);
        updateData.amountInPledgeCurrency = null;
        updateData.pledgeCurrencyExchangeRate = null;

        await db.update(payment).set(updateData).where(eq(payment.id, paymentId));

        const exchangeRateDate = validatedData.receivedDate || new Date().toISOString().split('T')[0];
        const paymentCurrency = validatedData.currency || currentPayment.currency;

        for (const allocation of validatedData.allocations) {
          const pledgeInfo = pledgeMap.get(allocation.pledgeId);
          const allocationCurrency = allocation.currency ?? paymentCurrency;

          const usdConversion = await convertCurrency(
            allocation.allocatedAmount,
            allocationCurrency,
            'USD',
            exchangeRateDate
          );

          const pledgeConversion = await convertCurrency(
            allocation.allocatedAmount,
            allocationCurrency,
            pledgeInfo.currency,
            exchangeRateDate
          );

          if (allocation.id) {
            const allocationUpdateData: Record<string, string | boolean | number | null | undefined | Date> = {
              pledgeId: allocation.pledgeId,
              allocatedAmount: allocation.allocatedAmount.toFixed(2),
              allocatedAmountUsd: usdConversion.convertedAmount.toFixed(2),
              allocatedAmountInPledgeCurrency: pledgeConversion.convertedAmount.toFixed(2),
              currency: allocationCurrency as "USD" | "ILS" | "EUR" | "JPY" | "GBP" | "AUD" | "CAD" | "ZAR",
              notes: allocation.notes ?? null,
              installmentScheduleId: allocation.installmentScheduleId ?? null,
              payerContactId: validatedData.isThirdPartyPayment ? (validatedData.thirdPartyContactId || validatedData.payerContactId) : null,
              updatedAt: new Date(),
            };

            if ("receiptNumber" in allocation) {
              allocationUpdateData.receiptNumber = allocation.receiptNumber ?? null;
            }
            if ("receiptType" in allocation) {
              allocationUpdateData.receiptType = allocation.receiptType ?? null;
            }
            if ("receiptIssued" in allocation) {
              allocationUpdateData.receiptIssued = allocation.receiptIssued ?? false;
            }

            await db
              .update(paymentAllocations)
              .set(allocationUpdateData)
              .where(eq(paymentAllocations.id, allocation.id));
          } else {
            const allocationToInsert: NewPaymentAllocation = {
              paymentId: paymentId,
              pledgeId: allocation.pledgeId,
              allocatedAmount: allocation.allocatedAmount.toFixed(2),
              allocatedAmountUsd: usdConversion.convertedAmount.toFixed(2),
              allocatedAmountInPledgeCurrency: pledgeConversion.convertedAmount.toFixed(2),
              currency: allocationCurrency as "USD" | "ILS" | "EUR" | "JPY" | "GBP" | "AUD" | "CAD" | "ZAR",
              installmentScheduleId: allocation.installmentScheduleId ?? null,
              receiptNumber: allocation.receiptNumber ?? null,
              receiptType: allocation.receiptType ?? null,
              receiptIssued: allocation.receiptIssued ?? false,
              notes: allocation.notes ?? null,
              payerContactId: validatedData.isThirdPartyPayment ? (validatedData.thirdPartyContactId || validatedData.payerContactId) : null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            await db.insert(paymentAllocations).values(allocationToInsert);
          }

          if (allocation.installmentScheduleId && validatedData.paymentStatus) {
            await updateInstallmentScheduleStatus(
              allocation.installmentScheduleId,
              validatedData.paymentStatus,
              validatedData.receivedDate || validatedData.paymentDate
            );
          }
        }
      } else {
        const updateData = await buildUpdateData(validatedData);
        updateData.amountInPledgeCurrency = null;
        updateData.pledgeCurrencyExchangeRate = null;

        await db.update(payment).set(updateData).where(eq(payment.id, paymentId));
      }
    }

    // SCENARIO 5: Updating regular payment
    else {
      console.log("Updating regular payment");

      if (validatedData.pledgeId && validatedData.pledgeId !== pledgeId) {
        const newPledgeExists = await db
          .select({ id: pledge.id })
          .from(pledge)
          .where(eq(pledge.id, validatedData.pledgeId))
          .limit(1);

        if (newPledgeExists.length === 0) {
          throw new AppError(
            "Invalid pledge ID",
            400,
            { details: `Pledge with ID ${validatedData.pledgeId} does not exist.` }
          );
        }

        pledgesToUpdate.add(validatedData.pledgeId);
      }

      const updateData = await buildUpdateData(validatedData);
      updateData.pledgeId = validatedData.pledgeId || currentPayment.pledgeId;

      await db.update(payment).set(updateData).where(eq(payment.id, paymentId));
    }

    // Get updated payment for response
    const updatedPaymentRows = await db
      .select({
        id: payment.id,
        pledgeId: payment.pledgeId,
        paymentPlanId: payment.paymentPlanId,
        installmentScheduleId: payment.installmentScheduleId,
        relationshipId: payment.relationshipId,
        payerContactId: payment.payerContactId,
        isThirdPartyPayment: payment.isThirdPartyPayment,
        amount: payment.amount,
        currency: payment.currency,
        amountUsd: payment.amountUsd,
        amountInPledgeCurrency: payment.amountInPledgeCurrency,
        pledgeCurrencyExchangeRate: payment.pledgeCurrencyExchangeRate,
        amountInPlanCurrency: payment.amountInPlanCurrency,
        planCurrencyExchangeRate: payment.planCurrencyExchangeRate,
        exchangeRate: payment.exchangeRate,
        paymentDate: payment.paymentDate,
        receivedDate: payment.receivedDate,
        checkDate: payment.checkDate,
        paymentMethod: payment.paymentMethod,
        methodDetail: payment.methodDetail,
        paymentStatus: payment.paymentStatus,
        referenceNumber: payment.referenceNumber,
        checkNumber: payment.checkNumber,
        account: payment.account,
        receiptNumber: payment.receiptNumber,
        receiptType: payment.receiptType,
        receiptIssued: payment.receiptIssued,
        solicitorId: payment.solicitorId,
        bonusPercentage: payment.bonusPercentage,
        bonusAmount: payment.bonusAmount,
        bonusRuleId: payment.bonusRuleId,
        notes: payment.notes,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        thirdPartyContactName: sql<string>`(
          SELECT CONCAT(first_name, ' ', last_name) 
          FROM ${contact} 
          WHERE id = ${payment.payerContactId}
        )`.as("thirdPartyContactName"),
      })
      .from(payment)
      .where(eq(payment.id, validatedData.paymentId))
      .limit(1);

    if (updatedPaymentRows.length === 0) {
      throw new AppError("Failed to fetch updated payment", 500);
    }
    const updatedPayment = updatedPaymentRows[0];

    // Update related entities
    if (updatedPayment.paymentPlanId) {
      try {
        await updatePaymentPlanTotals(updatedPayment.paymentPlanId);
      } catch (error) {
        console.error(`Failed to update payment plan ${updatedPayment.paymentPlanId}:`, error);
      }
    }

    if (updatedPayment.installmentScheduleId && validatedData.paymentStatus) {
      try {
        await updateInstallmentScheduleStatus(
          updatedPayment.installmentScheduleId,
          validatedData.paymentStatus,
          validatedData.receivedDate || validatedData.paymentDate
        );
      } catch (error) {
        console.error(`Failed to update installment schedule ${updatedPayment.installmentScheduleId}:`, error);
      }
    }

    // Update pledge totals for all affected pledges
    for (const pledgeId of pledgesToUpdate) {
      try {
        await updatePledgeTotals(pledgeId);
      } catch (error) {
        console.error(`Failed to update pledge ${pledgeId} totals:`, error);
      }
    }

    // Get allocations for response
    let allocations: AllocationResponse[] | null = null;
    const finalIsSplit = willBeSplit;
    const finalIsMultiContact = willBeMultiContact;

    if (finalIsSplit) {
      const rawAllocations = await db
        .select({
          id: paymentAllocations.id,
          pledgeId: paymentAllocations.pledgeId,
          allocatedAmount: paymentAllocations.allocatedAmount,
          allocatedAmountUsd: paymentAllocations.allocatedAmountUsd,
          allocatedAmountInPledgeCurrency: paymentAllocations.allocatedAmountInPledgeCurrency,
          notes: paymentAllocations.notes,
          currency: paymentAllocations.currency,
          installmentScheduleId: paymentAllocations.installmentScheduleId,
          receiptNumber: paymentAllocations.receiptNumber,
          receiptType: paymentAllocations.receiptType,
          receiptIssued: paymentAllocations.receiptIssued,
          createdAt: paymentAllocations.createdAt,
          updatedAt: paymentAllocations.updatedAt,
          pledgeDescription: sql<string>`(
            SELECT description FROM ${pledge} WHERE id = ${paymentAllocations.pledgeId}
          )`.as("pledgeDescription"),
          contactId: sql<number>`(
            SELECT contact_id FROM ${pledge} WHERE id = ${paymentAllocations.pledgeId}
          )`.as("contactId"),
          contactName: sql<string>`(
            SELECT CONCAT(first_name, ' ', last_name) 
            FROM ${contact} c
            INNER JOIN ${pledge} p ON c.id = p.contact_id
            WHERE p.id = ${paymentAllocations.pledgeId}
          )`.as("contactName"),
        })
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, validatedData.paymentId));

      allocations = rawAllocations.map((alloc) => ({
        ...alloc,
        allocatedAmount:
          typeof alloc.allocatedAmount === "string" ? parseFloat(alloc.allocatedAmount) : alloc.allocatedAmount,
        updatedAt: alloc.updatedAt instanceof Date ? alloc.updatedAt.toISOString() : typeof alloc.updatedAt === "string" ? alloc.updatedAt : null,
      }));
    }

    // Get pledge description for response
    const pledgeDescription = updatedPayment.pledgeId ?
      (await db.select({ description: pledge.description })
        .from(pledge)
        .where(eq(pledge.id, updatedPayment.pledgeId))
        .limit(1))[0]?.description : null;

    // Build multi-contact allocations response if applicable
    let multiContactAllocations = null;
    if (finalIsMultiContact && allocations) {
      const contactAllocationsMap = new Map<number, {
        contactId: number;
        contactName: string;
        pledges: Array<{
          pledgeId: number;
          pledgeDescription: string;
          currency: string;
          balance: number;
          allocatedAmount: number;
        }>;
      }>();

      for (const alloc of allocations) {
        const contactId = (alloc as unknown as { contactId: number }).contactId;
        const contactName = (alloc as unknown as { contactName: string }).contactName;

        if (!contactAllocationsMap.has(contactId)) {
          contactAllocationsMap.set(contactId, {
            contactId,
            contactName,
            pledges: []
          });
        }

        contactAllocationsMap.get(contactId)!.pledges.push({
          pledgeId: alloc.pledgeId,
          pledgeDescription: (alloc as unknown as { pledgeDescription: string }).pledgeDescription || "No description",
          currency: alloc.currency || updatedPayment.currency,
          balance: 0, // This would need to be fetched separately if needed
          allocatedAmount: alloc.allocatedAmount
        });
      }

      multiContactAllocations = Array.from(contactAllocationsMap.values());
    }
    if (validatedData.tagIds !== undefined) {
      await validateAndUpdatePaymentTags(paymentId, validatedData.tagIds);
    }
    return NextResponse.json({
      message: `${finalIsMultiContact ? "Multi-contact payment" : finalIsSplit ? "Split payment" : "Payment"} updated successfully`,
      payment: {
        ...updatedPayment,
        allocations,
        isSplitPayment: finalIsSplit,
        isMultiContactPayment: finalIsMultiContact,
        multiContactAllocations,
        allocationCount: allocations?.length ?? 0,
        pledgeDescription,
        isThirdPartyPayment: updatedPayment.isThirdPartyPayment,
        thirdPartyContactId: updatedPayment.payerContactId,
        thirdPartyContactName: updatedPayment.thirdPartyContactName,
      },
    });

  } catch (err: unknown) {
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message, ...(err.details ? { details: err.details } : {}) },
        { status: err.statusCode }
      );
    }
    return ErrorHandler.handle(err);
  }
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ pledgeId: string }> }) {
  try {
    const { pledgeId } = await params;
    const pledgeIdNum = parseInt(pledgeId, 10);

    if (isNaN(pledgeIdNum) || pledgeIdNum <= 0) {
      return NextResponse.json({ error: "Invalid pledge ID" }, { status: 400 });
    }

    const searchParams = new URL(request.url).searchParams;
    const queryParams = QueryParamsSchema.parse({
      pledgeId: pledgeIdNum,
      page: parseInt(searchParams.get("page") || "1", 10),
      limit: parseInt(searchParams.get("limit") || "10", 10),
      search: searchParams.get("search") || undefined,
      paymentStatus: searchParams.get("paymentStatus") || undefined,
    });

    const { page, limit, search, paymentStatus } = queryParams;

    let query = db
      .select({
        id: payment.id,
        pledgeId: payment.pledgeId,
        paymentPlanId: payment.paymentPlanId,
        installmentScheduleId: payment.installmentScheduleId,
        relationshipId: payment.relationshipId,
        payerContactId: payment.payerContactId,
        isThirdPartyPayment: payment.isThirdPartyPayment,
        amount: payment.amount,
        currency: payment.currency,
        amountUsd: payment.amountUsd,
        amountInPledgeCurrency: payment.amountInPledgeCurrency,
        exchangeRate: payment.exchangeRate,
        paymentDate: payment.paymentDate,
        receivedDate: payment.receivedDate,
        paymentMethod: payment.paymentMethod,
        methodDetail: payment.methodDetail,
        paymentStatus: payment.paymentStatus,
        referenceNumber: payment.referenceNumber,
        checkNumber: payment.checkNumber,
        checkDate: payment.checkDate,
        account: payment.account,
        receiptNumber: payment.receiptNumber,
        receiptType: payment.receiptType,
        receiptIssued: payment.receiptIssued,
        solicitorId: payment.solicitorId,
        bonusPercentage: payment.bonusPercentage,
        bonusAmount: payment.bonusAmount,
        bonusRuleId: payment.bonusRuleId,
        notes: payment.notes,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        // Pledge information
        pledgeExchangeRate: pledge.exchangeRate,
        pledgeDescription: pledge.description,
        contactId: pledge.contactId,
        // Calculated fields
        thirdPartyContactName: sql<string>`SELECT CONCAT(first_name, ' ', last_name) FROM ${contact} WHERE id = ${payment.payerContactId}`.as("thirdPartyContactName"),
        payerContactName: sql<string>`SELECT CONCAT(first_name, ' ', last_name) FROM ${contact} WHERE id = (SELECT contact_id FROM ${pledge} WHERE id = ${payment.pledgeId})`.as("payerContactName"),
        isSplitPayment: sql<boolean>`SELECT COUNT(*) > 0 FROM ${paymentAllocations} WHERE payment_id = ${payment.id}`.as("isSplitPayment"),
        allocationCount: sql<number>`SELECT COUNT(*) FROM ${paymentAllocations} WHERE payment_id = ${payment.id}`.as("allocationCount"),
        solicitorName: sql<string>`SELECT CONCAT(first_name, ' ', last_name) FROM ${contact} c INNER JOIN ${solicitor} s ON c.id = s.contact_id WHERE s.id = ${payment.solicitorId}`.as("solicitorName"),
      })
      .from(payment)
      .innerJoin(pledge, eq(payment.pledgeId, pledge.id))
      .leftJoin(solicitor, eq(payment.solicitorId, solicitor.id))
      .where(eq(payment.pledgeId, pledgeIdNum))
      .$dynamic(); // Fix: Use $dynamic() instead of .dynamic()

    // Apply filters
    const conditions = [] as SQL<unknown>[];

    if (paymentStatus) {
      conditions.push(eq(payment.paymentStatus, paymentStatus));
    }

    if (search) {
      const searchConditions = [] as SQL<unknown>[];
      searchConditions.push(ilike(sql`COALESCE(${payment.notes}, '')`, `%${search}%`));
      searchConditions.push(ilike(sql`COALESCE(${payment.referenceNumber}, '')`, `%${search}%`));
      searchConditions.push(ilike(sql`COALESCE(${payment.checkNumber}, '')`, `%${search}%`));
      searchConditions.push(ilike(sql`COALESCE(${payment.receiptNumber}, '')`, `%${search}%`));
      conditions.push(or(...searchConditions)!);
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.limit(limit).offset(offset).orderBy(desc(payment.createdAt));

    const paymentsResult = await query;

    // Enhanced allocation AND TAG fetching with multi-currency support
    const paymentsWithTagsAndAllocations = await Promise.all(
      paymentsResult.map(async (paymentItem: PaymentItem) => {
        const enhancedPayment = {
          ...paymentItem,
          thirdPartyContactId: paymentItem.isThirdPartyPayment ? paymentItem.payerContactId : null,
        };

        // *** FETCH PAYMENT TAGS ***
        console.log(`=== Fetching tags for payment ${paymentItem.id} ===`);

        const paymentTagsResult = await db
          .select({
            tagId: paymentTags.tagId,
            tagName: tag.name,
          })
          .from(paymentTags)
          .innerJoin(tag, and(
            eq(paymentTags.tagId, tag.id),
            eq(tag.isActive, true),
            eq(tag.showOnPayment, true)
          ))
          .where(eq(paymentTags.paymentId, paymentItem.id));

        console.log(`Payment ${paymentItem.id} tags result:`, paymentTagsResult);

        const tagIds = paymentTagsResult.map(pt => pt.tagId);
        const tags = paymentTagsResult.map(pt => ({ id: pt.tagId, name: pt.tagName }));

        console.log(`Payment ${paymentItem.id} - tagIds:`, tagIds, 'tags:', tags);

        // Handle allocations if this is a split payment
        if (paymentItem.isSplitPayment) {
          const allocationsRaw = await db
            .select({
              id: paymentAllocations.id,
              pledgeId: paymentAllocations.pledgeId,
              installmentScheduleId: paymentAllocations.installmentScheduleId,
              allocatedAmount: paymentAllocations.allocatedAmount,
              currency: paymentAllocations.currency,
              allocatedAmountUsd: paymentAllocations.allocatedAmountUsd,
              notes: paymentAllocations.notes,
              receiptNumber: paymentAllocations.receiptNumber,
              receiptType: paymentAllocations.receiptType,
              receiptIssued: paymentAllocations.receiptIssued,
              payerContactId: paymentAllocations.payerContactId,
              // Related pledge and contact info
              pledgeDescription: sql<string>`SELECT description FROM ${pledge} WHERE id = ${paymentAllocations.pledgeId}`.as("pledgeDescription"),
              contactId: sql<number>`SELECT contact_id FROM ${pledge} WHERE id = ${paymentAllocations.pledgeId}`.as("contactId"),
              contactName: sql<string>`SELECT CONCAT(first_name, ' ', last_name) FROM ${contact} c INNER JOIN ${pledge} p ON c.id = p.contact_id WHERE p.id = ${paymentAllocations.pledgeId}`.as("contactName"),
            })
            .from(paymentAllocations)
            .leftJoin(pledge, eq(paymentAllocations.pledgeId, pledge.id))
            .where(eq(paymentAllocations.paymentId, paymentItem.id));

          const allocations = allocationsRaw.map(alloc => ({
            ...alloc,
            allocatedAmount: typeof alloc.allocatedAmount === "string" ? parseFloat(alloc.allocatedAmount) : alloc.allocatedAmount,
          }));

          // Determine if this is a multi-contact payment
          const uniqueContactIds = [...new Set(allocations.map(a => a.contactId))];
          const isMultiContactPayment = uniqueContactIds.length > 1;

          let multiContactAllocations = null;
          if (isMultiContactPayment) {
            const contactAllocationsMap = new Map();
            for (const alloc of allocations) {
              const contactId = alloc.contactId;
              const contactName = alloc.contactName;
              if (!contactAllocationsMap.has(contactId)) {
                contactAllocationsMap.set(contactId, {
                  contactId,
                  contactName,
                  pledges: []
                });
              }
              contactAllocationsMap.get(contactId).pledges.push({
                pledgeId: alloc.pledgeId,
                pledgeDescription: alloc.pledgeDescription || "No description",
                currency: alloc.currency || paymentItem.currency,
                balance: 0, // This would need to be fetched separately if needed
                allocatedAmount: alloc.allocatedAmount
              });
            }
            multiContactAllocations = Array.from(contactAllocationsMap.values());
          }

          return {
            ...enhancedPayment,
            tagIds, // *** INCLUDE TAG IDS ***
            tags,   // *** INCLUDE TAGS ***
            allocations,
            isMultiContactPayment,
            multiContactAllocations
          };
        }

        return {
          ...enhancedPayment,
          tagIds, // *** INCLUDE TAG IDS FOR NON-SPLIT PAYMENTS ***
          tags,   // *** INCLUDE TAGS FOR NON-SPLIT PAYMENTS ***
          isMultiContactPayment: false
        };
      })
    );

    return NextResponse.json(
      { payments: paymentsWithTagsAndAllocations },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
        }
      }
    );

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ pledgeId: string }> }
) {
  try {
    const { pledgeId } = await params;
    const paymentId = parseInt(pledgeId, 10);

    if (isNaN(paymentId) || paymentId <= 0) {
      return NextResponse.json({ error: "Invalid payment ID" }, { status: 400 });
    }

    const existingPayment = await db
      .select({
        id: payment.id,
        pledgeId: payment.pledgeId,
        paymentPlanId: payment.paymentPlanId,
        installmentScheduleId: payment.installmentScheduleId,
        amount: payment.amount,
        paymentStatus: payment.paymentStatus,
        paymentDate: payment.paymentDate,
        solicitorId: payment.solicitorId,
      })
      .from(payment)
      .where(eq(payment.id, paymentId))
      .limit(1);

    if (existingPayment.length === 0) {
      throw new AppError("Payment not found", 404);
    }

    const currentPayment = existingPayment[0];

    const existingAllocations = await db
      .select({
        id: paymentAllocations.id,
        pledgeId: paymentAllocations.pledgeId,
        allocatedAmount: paymentAllocations.allocatedAmount,
        installmentScheduleId: paymentAllocations.installmentScheduleId,
      })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentId));

    const bonusCalculations = await db
      .select({ id: bonusCalculation.id })
      .from(bonusCalculation)
      .where(eq(bonusCalculation.paymentId, paymentId));

    if (currentPayment.installmentScheduleId) {
      await db
        .update(installmentSchedule)
        .set({
          paymentId: null,
          status: "pending",
          paidDate: null,
          updatedAt: new Date(),
        })
        .where(eq(installmentSchedule.id, currentPayment.installmentScheduleId));
    }

    if (existingAllocations.length > 0) {
      const allocationInstallmentIds = existingAllocations
        .filter(a => a.installmentScheduleId)
        .map(a => a.installmentScheduleId!);

      if (allocationInstallmentIds.length > 0) {
        for (const installmentId of allocationInstallmentIds) {
          await db
            .update(installmentSchedule)
            .set({
              status: "pending",
              paidDate: null,
              updatedAt: new Date(),
            })
            .where(eq(installmentSchedule.id, installmentId));
        }
      }
    }

    if (bonusCalculations.length > 0) {
      await db
        .delete(bonusCalculation)
        .where(eq(bonusCalculation.paymentId, paymentId));
    }

    if (existingAllocations.length > 0) {
      await db
        .delete(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, paymentId));
    }

    await db
      .delete(payment)
      .where(eq(payment.id, paymentId));

    const deletionResult = {
      deletedPayment: currentPayment,
      allocations: existingAllocations,
      bonusCalculationsDeleted: bonusCalculations.length,
    };

    const { deletedPayment, allocations } = deletionResult;

    if (allocations.length > 0) {
      const uniquePledgeIds = [...new Set(allocations.map(a => a.pledgeId))];
      for (const pledgeId of uniquePledgeIds) {
        try {
          await updatePledgeTotals(pledgeId);
        } catch (error) {
          console.error(`Failed to update pledge ${pledgeId} totals:`, error);
        }
      }
    }

    if (deletedPayment.pledgeId && allocations.length === 0) {
      try {
        await updatePledgeTotals(deletedPayment.pledgeId);
      } catch (error) {
        console.error(`Failed to update pledge ${deletedPayment.pledgeId} totals:`, error);
      }
    }

    if (deletedPayment.paymentPlanId) {
      try {
        await updatePaymentPlanTotals(deletedPayment.paymentPlanId);
      } catch (error) {
        console.error(`Failed to update payment plan ${deletedPayment.paymentPlanId} totals:`, error);
      }
    }

    return NextResponse.json({
      message: "Payment deleted successfully",
      details: {
        paymentId: deletedPayment.id,
        amount: deletedPayment.amount,
        wasAllocated: allocations.length > 0,
        allocationsDeleted: allocations.length,
        bonusCalculationsDeleted: deletionResult.bonusCalculationsDeleted,
        pledgesUpdated: allocations.length > 0
          ? [...new Set(allocations.map(a => a.pledgeId))]
          : deletedPayment.pledgeId ? [deletedPayment.pledgeId] : [],
        paymentPlanUpdated: deletedPayment.paymentPlanId,
      }
    });

  } catch (error) {
    console.error("Error deleting payment:", error);

    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return ErrorHandler.handle(error);
  }
}