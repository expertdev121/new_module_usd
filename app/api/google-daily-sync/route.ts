import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contact, manualDonation, solicitor, campaign } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";

const googleSyncRowSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  donationAmount: z.number().positive("Donation amount must be positive"),
  donationDate: z.string().refine((date) => !isNaN(new Date(date).getTime()), {
    message: "Invalid donation date format",
  }),
  solicitor: z.string().optional(),
  raffleTickets: z.number().optional(),
  email: z.string().email("Invalid email format"),
  campaign: z.string().optional(),
});

const googleSyncRequestSchema = z.array(googleSyncRowSchema);

class AppError extends Error {
  statusCode: number;
  details?: unknown;
  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log("Incoming Google sync request body:", JSON.stringify(body, null, 2));

    const validatedData = googleSyncRequestSchema.parse(body);

    let createdContacts = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Process each row
    for (const row of validatedData) {
      try {
        // Check if contact exists by email
        const existingContact = await db
          .select()
          .from(contact)
          .where(eq(contact.email, row.email))
          .limit(1);

        let contactId: number;

        if (existingContact.length > 0) {
          // Contact exists, use existing ID
          contactId = existingContact[0].id;
        } else {
          // Create new contact
          const newContact = await db
            .insert(contact)
            .values({
              firstName: row.firstName,
              lastName: row.lastName,
              email: row.email,
              raffelTickets: row.raffleTickets?.toString() || null,
              locationId: "E7yO96aiKmYvsbU2tRzc", // Fixed location ID
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();

          contactId = newContact[0].id;
          createdContacts++;
        }

        // Find solicitor by solicitorCode if provided
        let solicitorId: number | null = null;
        if (row.solicitor) {
          const solicitorResult = await db
            .select({ id: solicitor.id })
            .from(solicitor)
            .where(eq(solicitor.solicitorCode, row.solicitor))
            .limit(1);

          if (solicitorResult.length > 0) {
            solicitorId = solicitorResult[0].id;
          } else {
            console.warn(`Solicitor with code "${row.solicitor}" not found for email ${row.email}`);
          }
        }

        // Find campaign by name if provided
        let campaignId: number | null = null;
        if (row.campaign) {
          const campaignResult = await db
            .select({ id: campaign.id })
            .from(campaign)
            .where(eq(campaign.name, row.campaign))
            .limit(1);

          if (campaignResult.length > 0) {
            campaignId = campaignResult[0].id;
          } else {
            console.warn(`Campaign with name "${row.campaign}" not found for email ${row.email}`);
          }
        }

        // Create manual donation
        // Amount is already in USD, so amountUsd = amount, exchangeRate = 1
        await db.insert(manualDonation).values({
          contactId: contactId,
          amount: row.donationAmount.toFixed(2),
          currency: "USD",
          amountUsd: row.donationAmount.toFixed(2),
          exchangeRate: "1.0000",
          paymentDate: row.donationDate,
          paymentMethod: "Google Sheets Sync",
          paymentStatus: "completed",
          solicitorId: solicitorId,
          campaignId: campaignId,
          notes: `Imported from Google Sheets daily sync`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      } catch (rowError) {
        console.error(`Error processing row for email ${row.email}:`, rowError);
        errors.push(`Failed to process row for ${row.email}: ${rowError instanceof Error ? rowError.message : 'Unknown error'}`);
        skipped++;
      }
    }

    const response = {
      createdContacts,
      skipped,
      totalProcessed: validatedData.length,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log("Google sync completed:", response);

    return NextResponse.json(response, { status: 200 });

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
export function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}