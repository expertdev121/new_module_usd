import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { relationships, contact } from "@/lib/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { z } from "zod";

const paramsSchema = z.object({
  id: z.string().transform((val) => parseInt(val, 10)),
});

const querySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  includeInactive: z.coerce.boolean().default(false),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Await the params promise before parsing
    const resolvedParams = await params;
    const { id: contactId } = paramsSchema.parse(resolvedParams);
    
    if (!contactId || contactId <= 0) {
      return NextResponse.json(
        { error: "Invalid contact ID" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const { search, limit, includeInactive } = querySchema.parse({
      search: searchParams.get("search"),
      limit: searchParams.get("limit"),
      includeInactive: searchParams.get("includeInactive"),
    });

    // Build WHERE conditions
    const conditions = [eq(relationships.contactId, contactId)];

    if (!includeInactive) {
      conditions.push(eq(relationships.isActive, true));
    }

    if (search) {
      conditions.push(
        sql`(
          ${relationships.relationshipType} ILIKE ${"%" + search + "%"} OR
          c2.first_name ILIKE ${"%" + search + "%"} OR 
          c2.last_name ILIKE ${"%" + search + "%"} OR
          CONCAT(c2.first_name, ' ', c2.last_name) ILIKE ${"%" + search + "%"}
        )`
      );
    }

    const whereClause = and(...conditions);

    // Query relationships with related contact information
    const relationshipsQuery = db
      .select({
        id: relationships.id,
        relationshipType: relationships.relationshipType,
        isActive: relationships.isActive,
        notes: relationships.notes,
        createdAt: relationships.createdAt,
        relatedContactId: relationships.relatedContactId,
        relatedContactFirstName: sql<string>`c2.first_name`.as("relatedContactFirstName"),
        relatedContactLastName: sql<string>`c2.last_name`.as("relatedContactLastName"),
        relatedContactEmail: sql<string>`c2.email`.as("relatedContactEmail"),
        relatedContactPhone: sql<string>`c2.phone`.as("relatedContactPhone"),
      })
      .from(relationships)
      .leftJoin(
        sql`contact c2`,
        eq(relationships.relatedContactId, sql`c2.id`)
      )
      .where(whereClause)
      .orderBy(sql`${relationships.relationshipType} ASC, c2.first_name ASC, c2.last_name ASC`)
      .limit(limit);

    const results = await relationshipsQuery.execute();

    // Format results for dropdown usage
    const formattedRelationships = results.map((rel) => ({
      id: rel.id,
      relationshipType: rel.relationshipType,
      relatedContactId: rel.relatedContactId,
      relatedContactFirstName: rel.relatedContactFirstName,
      relatedContactLastName: rel.relatedContactLastName,
      relatedContactEmail: rel.relatedContactEmail,
      relatedContactPhone: rel.relatedContactPhone,
      isActive: rel.isActive,
      notes: rel.notes,
      createdAt: rel.createdAt,
      // Formatted label for dropdown display
      label: `${rel.relationshipType} - ${rel.relatedContactFirstName} ${rel.relatedContactLastName}`.trim(),
      // Alternative display formats
      shortLabel: `${rel.relatedContactFirstName} ${rel.relatedContactLastName}`.trim(),
      fullLabel: `${rel.relationshipType}: ${rel.relatedContactFirstName} ${rel.relatedContactLastName}${rel.relatedContactEmail ? ` (${rel.relatedContactEmail})` : ''}`.trim(),
    }));

    return NextResponse.json({
      relationships: formattedRelationships,
      meta: {
        total: results.length,
        contactId,
        search,
        includeInactive,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid parameters",
          details: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }

    console.error("Error fetching relationships:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch relationships",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
