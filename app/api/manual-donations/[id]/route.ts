import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { manualDonation, contact, solicitor, exchangeRate, currencyEnum } from "@/lib/db/schema";
import { eq,sql, and, lte, desc } from "drizzle-orm";
import type { NewManualDonation } from "@/lib/db/schema";
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";

class AppError extends Error {
  statusCode: number;
  details?: unknown;
  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const supportedCurrencies = [
  "USD",
  "ILS",
  "EUR",
  "JPY",
  "GBP",
  "AUD",
  "CAD",
  "ZAR",
] as const;

const paymentStatusValues = [
  "pending",
  "completed",
  "failed",
  "cancelled",
  "refunded",
  "processing",
  "expected",
] as const;

const receiptTypeValues = ["invoice", "confirmation", "receipt", "other"] as const;

const manualDonationUpdateSchema = z.object({
  contactId: z.number().positive("Contact is required").optional(),
  amount: z.number().nonnegative("Amount must be positive").optional(),
  currency: z.enum(supportedCurrencies).optional(),
  amountUsd: z.number().nonnegative().optional(),
  exchangeRate: z.number().positive().optional(),
  paymentDate: z.string().refine((date) => !isNaN(new Date(date).getTime()), {
    message: "Invalid payment date format",
  }).optional(),
  receivedDate: z
    .string()
    .refine((date) => !isNaN(new Date(date).getTime()), {
      message: "Invalid received date format",
    })
    .optional()
    .nullable(),
  checkDate: z
    .string()
    .refine((date) => !isNaN(new Date(date).getTime()), {
      message: "Invalid check date format",
    })
    .optional()
    .nullable(),
  account: z.string().optional().nullable(),
  paymentMethod: z.string().optional(),
  methodDetail: z.string().optional().nullable(),
  paymentStatus: z.enum(paymentStatusValues).optional(),
  referenceNumber: z.string().optional().nullable(),
  checkNumber: z.string().optional().nullable(),
  receiptNumber: z.string().optional().nullable(),
  receiptType: z.enum(receiptTypeValues).optional().nullable(),
  receiptIssued: z.boolean().optional(),
  solicitorId: z.number().optional().nullable(),
  bonusPercentage: z.number().optional().nullable(),
  bonusAmount: z.number().optional().nullable(),
  bonusRuleId: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Enhanced currency conversion helper
async function getUsdToCurrencyRate(currency: string, date: string): Promise<number | null> {
  if (currency === 'USD') return 1;

  const rate = await db
    .select()
    .from(exchangeRate)
    .where(
      and(
        eq(exchangeRate.baseCurrency, 'USD' as (typeof currencyEnum.enumValues)[number]),
        eq(exchangeRate.targetCurrency, currency as (typeof currencyEnum.enumValues)[number]),
        lte(exchangeRate.date, date)
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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new AppError("Invalid donation ID", 400);
    }

    const donation = await db
      .select({
        id: manualDonation.id,
        contactId: manualDonation.contactId,
        amount: manualDonation.amount,
        currency: manualDonation.currency,
        amountUsd: manualDonation.amountUsd,
        exchangeRate: manualDonation.exchangeRate,
        paymentDate: manualDonation.paymentDate,
        receivedDate: manualDonation.receivedDate,
        checkDate: manualDonation.checkDate,
        account: manualDonation.account,
        paymentMethod: manualDonation.paymentMethod,
        methodDetail: manualDonation.methodDetail,
        paymentStatus: manualDonation.paymentStatus,
        referenceNumber: manualDonation.referenceNumber,
        checkNumber: manualDonation.checkNumber,
        receiptNumber: manualDonation.receiptNumber,
        receiptType: manualDonation.receiptType,
        receiptIssued: manualDonation.receiptIssued,
        solicitorId: manualDonation.solicitorId,
        bonusPercentage: manualDonation.bonusPercentage,
        bonusAmount: manualDonation.bonusAmount,
        bonusRuleId: manualDonation.bonusRuleId,
        notes: manualDonation.notes,
        createdAt: manualDonation.createdAt,
        updatedAt: manualDonation.updatedAt,
        // Contact information
        contactName: sql<string>`(SELECT CONCAT(c.first_name, ' ', c.last_name) FROM ${contact} c WHERE c.id = ${manualDonation.contactId})`.as("contactName"),
        // Solicitor information
        solicitorName: sql<string>`CASE WHEN ${manualDonation.solicitorId} IS NOT NULL THEN (SELECT CONCAT(c.first_name, ' ', c.last_name) FROM ${solicitor} s JOIN ${contact} c ON s.contact_id = c.id WHERE s.id = ${manualDonation.solicitorId}) ELSE NULL END`.as("solicitorName"),
      })
      .from(manualDonation)
      .where(eq(manualDonation.id, id))
      .limit(1);

    if (donation.length === 0) {
      throw new AppError("Manual donation not found", 404);
    }

    return NextResponse.json(donation[0]);

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

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new AppError("Invalid donation ID", 400);
    }

    const body = await request.json();
    console.log("Incoming manual donation update request body:", JSON.stringify(body, null, 2));

    const validatedData = manualDonationUpdateSchema.parse(body);

    // Verify donation exists
    const existingDonation = await db
      .select()
      .from(manualDonation)
      .where(eq(manualDonation.id, id))
      .limit(1);

    if (existingDonation.length === 0) {
      throw new AppError("Manual donation not found", 404);
    }

    // Verify contact exists if provided
    if (validatedData.contactId) {
      const contactExists = await db
        .select({ id: contact.id })
        .from(contact)
        .where(eq(contact.id, validatedData.contactId))
        .limit(1);

      if (contactExists.length === 0) {
        throw new AppError("Contact not found", 404);
      }
    }

    // Verify solicitor exists if provided
    if (validatedData.solicitorId) {
      const solicitorExists = await db
        .select({ id: solicitor.id })
        .from(solicitor)
        .where(eq(solicitor.id, validatedData.solicitorId))
        .limit(1);

      if (solicitorExists.length === 0) {
        throw new AppError("Solicitor not found", 404);
      }
    }

    // Use paymentDate for exchange rate calculations (fallback to existing)
    const paymentDate = validatedData.paymentDate || existingDonation[0].paymentDate;
    const currency = validatedData.currency || existingDonation[0].currency;
    const amount = validatedData.amount !== undefined ? validatedData.amount : parseFloat(existingDonation[0].amount);

    // Calculate USD amount if not provided and amount/currency changed
    let amountUsd = validatedData.amountUsd;
    if (amountUsd === undefined && (validatedData.amount !== undefined || validatedData.currency)) {
      const usdConversion = await convertCurrency(
        amount,
        currency,
        'USD',
        paymentDate
      );
      amountUsd = usdConversion.convertedAmount;
    }

    const updateData: Partial<NewManualDonation> = {
      ...(validatedData.contactId !== undefined && { contactId: validatedData.contactId }),
      ...(validatedData.amount !== undefined && { amount: validatedData.amount.toFixed(2) }),
      ...(validatedData.currency && { currency: validatedData.currency }),
      ...(amountUsd !== undefined && { amountUsd: amountUsd.toFixed(2) }),
      ...(validatedData.exchangeRate !== undefined && { exchangeRate: validatedData.exchangeRate.toFixed(4) }),
      ...(validatedData.paymentDate && { paymentDate: validatedData.paymentDate }),
      ...(validatedData.receivedDate !== undefined && { receivedDate: validatedData.receivedDate }),
      ...(validatedData.checkDate !== undefined && { checkDate: validatedData.checkDate }),
      ...(validatedData.account !== undefined && { account: validatedData.account }),
      ...(validatedData.paymentMethod && { paymentMethod: validatedData.paymentMethod }),
      ...(validatedData.methodDetail !== undefined && { methodDetail: validatedData.methodDetail }),
      ...(validatedData.paymentStatus && { paymentStatus: validatedData.paymentStatus }),
      ...(validatedData.referenceNumber !== undefined && { referenceNumber: validatedData.referenceNumber }),
      ...(validatedData.checkNumber !== undefined && { checkNumber: validatedData.checkNumber }),
      ...(validatedData.receiptNumber !== undefined && { receiptNumber: validatedData.receiptNumber }),
      ...(validatedData.receiptType !== undefined && { receiptType: validatedData.receiptType }),
      ...(validatedData.receiptIssued !== undefined && { receiptIssued: validatedData.receiptIssued }),
      ...(validatedData.solicitorId !== undefined && { solicitorId: validatedData.solicitorId }),
      ...(validatedData.bonusPercentage !== undefined && { bonusPercentage: validatedData.bonusPercentage ? validatedData.bonusPercentage.toFixed(2) : null }),
      ...(validatedData.bonusAmount !== undefined && { bonusAmount: validatedData.bonusAmount ? validatedData.bonusAmount.toFixed(2) : null }),
      ...(validatedData.bonusRuleId !== undefined && { bonusRuleId: validatedData.bonusRuleId }),
      ...(validatedData.notes !== undefined && { notes: validatedData.notes }),
      updatedAt: new Date(),
    };

    const [updatedDonation] = await db
      .update(manualDonation)
      .set(updateData)
      .where(eq(manualDonation.id, id))
      .returning();

    if (!updatedDonation) {
      throw new AppError("Failed to update manual donation", 500);
    }

    return NextResponse.json(
      {
        message: "Manual donation updated successfully",
        donation: updatedDonation,
      },
      { status: 200 }
    );

  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      console.error("Validation error details:", JSON.stringify(err.issues, null, 2));
      return NextResponse.json(
        {
          error: "Validation failed",
          details: err.issues.map((issue) => ({
            field: issue.path.join(".") || "root",
            message: issue.message,
            received: issue.code === "invalid_type" ? String(issue.received) : undefined,
            expected: issue.code === "invalid_type" ? String(issue.expected) : undefined,
            code: issue.code,
          })),
        },
        { status: 400 }
      );
    }

    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message, ...(err.details ? { details: err.details } : {}) },
        { status: err.statusCode }
      );
    }

    return ErrorHandler.handle(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new AppError("Invalid donation ID", 400);
    }

    // Verify donation exists
    const existingDonation = await db
      .select({
        id: manualDonation.id,
        amount: manualDonation.amount,
        paymentStatus: manualDonation.paymentStatus,
        solicitorId: manualDonation.solicitorId,
        bonusAmount: manualDonation.bonusAmount,
      })
      .from(manualDonation)
      .where(eq(manualDonation.id, id))
      .limit(1);

    if (existingDonation.length === 0) {
      throw new AppError("Manual donation not found", 404);
    }

    const [deletedDonation] = await db
      .delete(manualDonation)
      .where(eq(manualDonation.id, id))
      .returning({
        id: manualDonation.id,
        amount: manualDonation.amount,
        paymentStatus: manualDonation.paymentStatus,
        solicitorId: manualDonation.solicitorId,
        bonusAmount: manualDonation.bonusAmount,
      });

    if (!deletedDonation) {
      throw new AppError("Failed to delete manual donation", 500);
    }

    return NextResponse.json(
      {
        message: "Manual donation deleted successfully",
        deletedDonation,
      },
      { status: 200 }
    );

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
