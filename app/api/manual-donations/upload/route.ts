import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  account,
  campaign,
  category,
  categoryItem,
  contact,
  manualDonation,
  type NewManualDonation,
} from "@/lib/db/schema";
import { ErrorHandler } from "@/lib/error-handler";
import { logDonationAction } from "@/lib/audit";
import { sendN8nManualDonationWebhook } from "@/lib/utils/send-n8n-manual-donation";

class AppError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const normalizeEmpty = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const dateStringSchema = z.string().refine((date) => !Number.isNaN(new Date(date).getTime()), {
  message: "Invalid date format",
});

const uploadRowSchema = z
  .object({
    ghlContactId: z.preprocess(normalizeEmpty, z.string().trim().optional()),
    email: z.preprocess(normalizeEmpty, z.string().trim().email("Invalid email format").optional()),
    amount: z.coerce.number().nonnegative("amount must be positive"),
    receivedDate: dateStringSchema,
    paymentMethod: z.string().trim().min(1, "paymentMethod is required"),
    paymentStatus: z
      .enum(["pending", "completed", "failed", "cancelled", "refunded", "processing", "expected"])
      .default("completed"),
    accountName: z.preprocess(normalizeEmpty, z.string().trim().optional()),
    categoryName: z.preprocess(normalizeEmpty, z.string().trim().optional()),
    categoryItemName: z.preprocess(normalizeEmpty, z.string().trim().optional()),
    campaignName: z.preprocess(normalizeEmpty, z.string().trim().optional()),
    referenceNumber: z.preprocess(normalizeEmpty, z.string().trim().optional()),
    checkNumber: z.preprocess(normalizeEmpty, z.string().trim().optional()),
    notes: z.preprocess(normalizeEmpty, z.string().optional()),
  })
  .superRefine((data, ctx) => {
    if (!data.ghlContactId && !data.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ghlContactId"],
        message: "Either ghlContactId or email is required",
      });
    }

    if (data.categoryItemName && !data.categoryName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoryItemName"],
        message: "categoryName is required when categoryItemName is provided",
      });
    }
  });

const uploadRequestSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, "At least one CSV row is required")
    .max(1000, "Upload is limited to 1000 rows per import"),
});

type ParsedUploadRow = z.infer<typeof uploadRowSchema>;

function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "row",
    message: issue.message,
  }));
}

async function findContactForRow(row: ParsedUploadRow, locationId: string) {
  const conditions = [];

  if (row.ghlContactId) {
    conditions.push(eq(contact.ghlContactId, row.ghlContactId));
  }

  if (row.email) {
    conditions.push(ilike(contact.email, row.email));
  }

  if (conditions.length === 0) {
    throw new AppError("Either ghlContactId or email is required", 400);
  }

  const matches = await db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      ghlContactId: contact.ghlContactId,
    })
    .from(contact)
    .where(and(eq(contact.locationId, locationId), or(...conditions)))
    .limit(2);

  if (matches.length === 0) {
    throw new AppError(
      `Contact not found for ${row.ghlContactId ? `ghlContactId ${row.ghlContactId}` : `email ${row.email}`}`,
      404
    );
  }

  if (matches.length > 1) {
    throw new AppError(
      `Multiple contacts matched ${row.ghlContactId ? `ghlContactId ${row.ghlContactId}` : `email ${row.email}`}`,
      409
    );
  }

  return matches[0];
}

async function findOrCreateAccountId(name: string | undefined, locationId: string) {
  if (!name) return null;

  const existing = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.locationId, locationId), sql`lower(${account.name}) = lower(${name})`))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  const [created] = await db
    .insert(account)
    .values({
      name,
      locationId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: account.id });

  return created.id;
}

async function findOrCreateCategoryId(name: string | undefined, locationId: string) {
  if (!name) return null;

  const existing = await db
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.locationId, locationId), sql`lower(${category.name}) = lower(${name})`))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  const [created] = await db
    .insert(category)
    .values({
      name,
      locationId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: category.id });

  return created.id;
}

async function findOrCreateCategoryItemId(
  itemName: string | undefined,
  categoryId: number | null,
  locationId: string
) {
  if (!itemName) return null;
  if (!categoryId) {
    throw new AppError("categoryName is required when categoryItemName is provided", 400);
  }

  const existing = await db
    .select({ id: categoryItem.id })
    .from(categoryItem)
    .where(
      and(
        eq(categoryItem.locationId, locationId),
        eq(categoryItem.categoryId, categoryId),
        sql`lower(${categoryItem.name}) = lower(${itemName})`
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  const [created] = await db
    .insert(categoryItem)
    .values({
      name: itemName,
      categoryId,
      locationId,
      isActive: true,
      occId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: categoryItem.id });

  return created.id;
}

async function findOrCreateCampaignId(
  name: string | undefined,
  locationId: string,
  userId?: number | null
) {
  if (!name) return null;

  const existing = await db
    .select({ id: campaign.id })
    .from(campaign)
    .where(and(eq(campaign.locationId, locationId), sql`lower(${campaign.name}) = lower(${name})`))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  const [created] = await db
    .insert(campaign)
    .values({
      name,
      locationId,
      status: "active",
      createdBy: userId ?? null,
      updatedBy: userId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: campaign.id });

  return created.id;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsedBody = uploadRequestSchema.parse(body);

    const locationId = session.user.locationId;
    const adminUserId = session.user.id ? Number.parseInt(session.user.id, 10) : null;

    if (!locationId) {
      return NextResponse.json(
        { error: "Admin location not found. CSV import requires a location-scoped user." },
        { status: 400 }
      );
    }

    const parsedRows: Array<{ rowNumber: number; data: ParsedUploadRow }> = [];
    const errors: Array<{ rowNumber: number; error: string; details?: unknown }> = [];

    parsedBody.rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const parsedRow = uploadRowSchema.safeParse(row);

      if (!parsedRow.success) {
        errors.push({
          rowNumber,
          error: "Validation failed",
          details: formatZodIssues(parsedRow.error),
        });
        return;
      }

      parsedRows.push({ rowNumber, data: parsedRow.data });
    });

    if (parsedRows.length === 0) {
      return NextResponse.json(
        {
          message: "No valid rows to import",
          createdCount: 0,
          failedCount: errors.length,
          errors,
        },
        { status: 400 }
      );
    }

    const created: Array<{ rowNumber: number; donationId: number }> = [];

    for (const row of parsedRows) {
      try {
        const matchedContact = await findContactForRow(row.data, locationId);
        const accountId = await findOrCreateAccountId(row.data.accountName, locationId);
        const categoryId = await findOrCreateCategoryId(row.data.categoryName, locationId);
        const categoryItemId = await findOrCreateCategoryItemId(
          row.data.categoryItemName,
          categoryId,
          locationId
        );
        const campaignId = await findOrCreateCampaignId(row.data.campaignName, locationId, adminUserId);

        const manualDonationData: NewManualDonation = {
          contactId: matchedContact.id,
          categoryId,
          categoryItemId,
          amount: row.data.amount.toFixed(2),
          currency: "USD",
          amountUsd: row.data.amount.toFixed(2),
          exchangeRate: "1.0000",
          paymentDate: row.data.receivedDate,
          receivedDate: row.data.receivedDate,
          checkDate: row.data.receivedDate,
          accountId,
          campaignId,
          paymentMethod: row.data.paymentMethod,
          methodDetail: null,
          paymentStatus: row.data.paymentStatus,
          referenceNumber: row.data.referenceNumber ?? null,
          checkNumber: row.data.checkNumber ?? null,
          receiptNumber: null,
          receiptType: null,
          receiptIssued: false,
          solicitorId: null,
          bonusPercentage: null,
          bonusAmount: null,
          bonusRuleId: null,
          notes: row.data.notes ?? null,
          importSource: "csv_upload",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const [createdDonation] = await db.insert(manualDonation).values(manualDonationData).returning();

        await logDonationAction("create", createdDonation.id, matchedContact.id, row.data.amount, {
          currency: "USD",
          paymentMethod: row.data.paymentMethod,
          campaignId,
          source: "csv-upload",
          lookupMethod: row.data.ghlContactId ? "ghlContactId" : "email",
        });

        sendN8nManualDonationWebhook(createdDonation.id).catch((error) => {
          console.error(`n8n webhook failed for uploaded manual donation ${createdDonation.id}:`, error);
        });

        created.push({ rowNumber: row.rowNumber, donationId: createdDonation.id });
      } catch (error) {
        errors.push({
          rowNumber: row.rowNumber,
          error: error instanceof Error ? error.message : "Unknown error",
          details: error instanceof AppError ? error.details : undefined,
        });
      }
    }

    const statusCode = created.length > 0 ? 201 : 400;

    return NextResponse.json(
      {
        message:
          errors.length > 0
            ? `Imported ${created.length} manual donations with ${errors.length} failed rows`
            : `Imported ${created.length} manual donations successfully`,
        createdCount: created.length,
        failedCount: errors.length,
        created,
        errors,
      },
      { status: statusCode }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: formatZodIssues(error),
        },
        { status: 400 }
      );
    }

    if (error instanceof AppError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        { status: error.statusCode }
      );
    }

    return ErrorHandler.handle(error);
  }
}
