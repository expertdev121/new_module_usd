import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { manualDonation, contact, solicitor, campaign, exchangeRate, currencyEnum } from "@/lib/db/schema";
import { sql, eq, and, or, lte, desc, inArray } from "drizzle-orm";
import type { NewManualDonation } from "@/lib/db/schema";
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";
import { generatePDFReceipt, generateReceiptFilename, savePDFToPublic, type ReceiptData } from '@/lib/pdf-receipt-generator';

// Webhook URL for sending receipts
const RECEIPT_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/E7yO96aiKmYvsbU2tRzc/webhook-trigger/5991f595-a206-49bf-b333-08e6b5e6c9b1';

// Helper function to send receipt to webhook
async function sendReceiptToWebhook(receiptData: {
  paymentId: number;
  amount: string;
  currency: string;
  paymentDate: string;
  paymentMethod?: string;
  referenceNumber?: string;
  receiptNumber?: string;
  notes?: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  pledgeDescription?: string;
  pledgeOriginalAmount?: string;
  pledgeCurrency?: string;
  category?: string;
  campaign?: string;
  receiptPdfUrl?: string;
}) {
  try {
    const formData = new FormData();
    formData.append('paymentId', receiptData.paymentId.toString());
    formData.append('amount', receiptData.amount);
    formData.append('currency', receiptData.currency);
    formData.append('paymentDate', receiptData.paymentDate);
    if (receiptData.receiptPdfUrl) formData.append('receiptPdfUrl', receiptData.receiptPdfUrl);
    if (receiptData.paymentMethod) formData.append('paymentMethod', receiptData.paymentMethod);
    if (receiptData.referenceNumber) formData.append('referenceNumber', receiptData.referenceNumber);
    if (receiptData.receiptNumber) formData.append('receiptNumber', receiptData.receiptNumber);
    if (receiptData.notes) formData.append('notes', receiptData.notes);
    formData.append('name', receiptData.contactName);
    formData.append('email', receiptData.contactEmail);
    if (receiptData.contactPhone) formData.append('phone', receiptData.contactPhone);
    if (receiptData.pledgeDescription) formData.append('pledgeDescription', receiptData.pledgeDescription);
    if (receiptData.pledgeOriginalAmount) formData.append('pledgeOriginalAmount', receiptData.pledgeOriginalAmount);
    if (receiptData.pledgeCurrency) formData.append('pledgeCurrency', receiptData.pledgeCurrency);
    if (receiptData.category) formData.append('category', receiptData.category);
    if (receiptData.campaign) formData.append('campaign', receiptData.campaign);

    const response = await fetch(RECEIPT_WEBHOOK_URL, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Webhook request failed with status: ${response.status}`);
    }

    console.log(`Receipt data sent successfully for manual donation ${receiptData.paymentId} to ${receiptData.contactEmail}`);
    return true;
  } catch (error) {
    console.error(`Failed to send receipt data for manual donation ${receiptData.paymentId}:`, error);
    return false;
  }
}

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

const manualDonationCreateSchema = z.object({
  contactId: z.number().positive("Contact is required"),
  amount: z.number().nonnegative("Amount must be positive"),
  currency: z.enum(supportedCurrencies),
  amountUsd: z.number().nonnegative().optional(),
  exchangeRate: z.number().positive(),
  paymentDate: z.string().refine((date) => !isNaN(new Date(date).getTime()), {
    message: "Invalid payment date format",
  }),
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
  accountId: z.preprocess((val) => val === null || val === undefined ? null : typeof val === 'string' ? parseInt(val as string) : val, z.number().nullable()).optional(),
  campaignId: z.number().positive().optional().nullable(),
  paymentMethod: z.string(),
  methodDetail: z.string().optional().nullable(),
  paymentStatus: z.enum(paymentStatusValues).optional().default("completed"),
  referenceNumber: z.string().optional().nullable(),
  checkNumber: z.string().optional().nullable(),
  receiptNumber: z.string().optional().nullable(),
  receiptType: z.enum(receiptTypeValues).optional().nullable(),
  receiptIssued: z.boolean().optional().default(false),
  solicitorId: z.number().optional().nullable(),
  bonusPercentage: z.number().optional().nullable(),
  bonusAmount: z.number().optional().nullable(),
  bonusRuleId: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const querySchema = z.object({
  contactId: z.preprocess((val) => parseInt(String(val), 10), z.number().positive()).optional(),
  solicitorId: z.preprocess((val) => parseInt(String(val), 10), z.number().positive()).optional(),
  campaignId: z.preprocess((val) => parseInt(String(val), 10), z.number().positive()).optional(),
  page: z.preprocess((val) => parseInt(String(val), 10), z.number().min(1).default(1)).optional(),
  limit: z.preprocess((val) => parseInt(String(val), 10), z.number().min(1).default(10)).optional(),
  search: z.string().optional(),
  paymentMethod: z.string().optional().nullable(),
  methodDetail: z.string().optional().nullable(),
  paymentStatus: z.enum(paymentStatusValues).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  hasSolicitor: z.preprocess((val) => val === 'true', z.boolean()).optional(),
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log("Incoming manual donation request body:", JSON.stringify(body, null, 2));

    const validatedData = manualDonationCreateSchema.parse(body);

    // Verify contact exists
    const contactExists = await db
      .select({ id: contact.id })
      .from(contact)
      .where(eq(contact.id, validatedData.contactId))
      .limit(1);

    if (contactExists.length === 0) {
      throw new AppError("Contact not found", 404);
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

    // Verify campaign exists if provided
    if (validatedData.campaignId) {
      const campaignExists = await db
        .select({ id: campaign.id })
        .from(campaign)
        .where(eq(campaign.id, validatedData.campaignId))
        .limit(1);

      if (campaignExists.length === 0) {
        throw new AppError("Campaign not found", 404);
      }
    }

    // Use paymentDate for exchange rate calculations
    const exchangeRateDate = validatedData.paymentDate;

    // Calculate USD amount if not provided
    let amountUsd = validatedData.amountUsd;
    if (!amountUsd) {
      const usdConversion = await convertCurrency(
        validatedData.amount,
        validatedData.currency,
        'USD',
        exchangeRateDate
      );
      amountUsd = usdConversion.convertedAmount;
    }

    const manualDonationData: NewManualDonation = {
      contactId: validatedData.contactId,
      amount: validatedData.amount.toFixed(2),
      currency: validatedData.currency,
      amountUsd: amountUsd.toFixed(2),
      exchangeRate: validatedData.exchangeRate.toFixed(4),
      paymentDate: validatedData.paymentDate,
      receivedDate: validatedData.receivedDate,
      checkDate: validatedData.checkDate,
      accountId: validatedData.accountId,
      campaignId: validatedData.campaignId,
      paymentMethod: validatedData.paymentMethod,
      methodDetail: validatedData.methodDetail,
      paymentStatus: validatedData.paymentStatus,
      referenceNumber: validatedData.referenceNumber,
      checkNumber: validatedData.checkNumber,
      receiptNumber: validatedData.receiptNumber,
      receiptType: validatedData.receiptType,
      receiptIssued: validatedData.receiptIssued,
      solicitorId: validatedData.solicitorId,
      bonusPercentage: validatedData.bonusPercentage ? validatedData.bonusPercentage.toFixed(2) : null,
      bonusAmount: validatedData.bonusAmount ? validatedData.bonusAmount.toFixed(2) : null,
      bonusRuleId: validatedData.bonusRuleId,
      notes: validatedData.notes,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const [createdDonation] = await db.insert(manualDonation).values(manualDonationData).returning();

    if (!createdDonation) {
      throw new AppError("Failed to create manual donation", 500);
    }

    // Note: Automatic webhook sending has been disabled
    // Receipt will be sent manually via the payments table button

    return NextResponse.json(
      {
        message: "Manual donation created successfully",
        donation: createdDonation,
      },
      { status: 201 }
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

export async function GET(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const params = Object.fromEntries(searchParams.entries());
    const parsedParams = querySchema.safeParse(params);

    if (!parsedParams.success) {
      throw new AppError("Invalid query parameters", 400, parsedParams.error.issues.map(issue => ({
        field: issue.path.join("."),
        message: issue.message,
      })));
    }

    const {
      contactId,
      solicitorId,
      campaignId,
      page = 1,
      limit = 10,
      search,
      paymentMethod,
      paymentStatus,
      startDate,
      endDate,
      hasSolicitor,
    } = parsedParams.data;

    const offset = (page - 1) * limit;
    const conditions = [];

    if (contactId) {
      conditions.push(eq(manualDonation.contactId, contactId));
    }

    if (solicitorId) {
      conditions.push(eq(manualDonation.solicitorId, solicitorId));
    }

    if (campaignId) {
      conditions.push(eq(manualDonation.campaignId, campaignId));
    }

    if (hasSolicitor !== undefined) {
      if (hasSolicitor) {
        conditions.push(sql`${manualDonation.solicitorId} IS NOT NULL`);
      } else {
        conditions.push(sql`${manualDonation.solicitorId} IS NULL`);
      }
    }

    if (search) {
      conditions.push(sql`(
        ${manualDonation.referenceNumber} ILIKE ${"%" + search + "%"} OR
        ${manualDonation.checkNumber} ILIKE ${"%" + search + "%"} OR
        ${manualDonation.notes} ILIKE ${"%" + search + "%"} OR
        ${manualDonation.receiptNumber} ILIKE ${"%" + search + "%"}
      )`);
    }

    if (paymentMethod) {
      conditions.push(eq(manualDonation.paymentMethod, paymentMethod));
    }

    if (paymentStatus) {
      conditions.push(eq(manualDonation.paymentStatus, paymentStatus));
    }

    if (startDate) {
      conditions.push(sql`${manualDonation.paymentDate} >= ${startDate}`);
    }

    if (endDate) {
      conditions.push(sql`${manualDonation.paymentDate} <= ${endDate}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const donationsQuery = db
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
        accountId: manualDonation.accountId,
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
      .where(whereClause)
      .orderBy(sql`${manualDonation.paymentDate} DESC`)
      .limit(limit)
      .offset(offset);

    const countQuery = db
      .select({
        count: sql<number>`count(*)`.as("count"),
      })
      .from(manualDonation)
      .where(whereClause);

    const [donations, totalCountResult] = await Promise.all([
      donationsQuery.execute(),
      countQuery.execute(),
    ]);

    const totalCount = Number(totalCountResult[0]?.count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    const response = {
      manualDonations: donations,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      filters: parsedParams.data,
    };

    return NextResponse.json(response, {
      headers: {
        "X-Total-Count": response.pagination.totalCount.toString(),
      },
    });

  } catch (err: unknown) {
    if (err instanceof AppError) {
      return NextResponse.json(
        {
          error: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
        { status: err.statusCode }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to fetch manual donations",
        message: err instanceof Error ? err.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}