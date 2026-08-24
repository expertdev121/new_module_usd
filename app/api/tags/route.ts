import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sql, desc, asc, or, ilike, and, eq } from "drizzle-orm";
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";
import { tag, NewTag } from "@/lib/db/schema";
import { tagSchema } from "@/lib/form-schemas/tag";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(1000).default(10),
  search: z.string().optional(),
  sortBy: z.string().default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  isActive: z.coerce.boolean().optional(),
  showOnPayment: z.coerce.boolean().optional(),
  showOnPledge: z.coerce.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    // Get session without passing request
    const session = await getServerSession(authOptions);

    // Check if session exists and user is authenticated
    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized - No session found" },
        { status: 401 }
      );
    }

    // Check if user has admin role
    const userRole = session.user.role;
    if (userRole !== "admin") {
      return NextResponse.json(
        {
          error: "Forbidden: Admin access required",
          userRole: userRole
        },
        { status: 403 }
      );
    }

    // Get the admin's location ID
    const adminLocationId = session.user.locationId;
    if (!adminLocationId) {
      return NextResponse.json(
        { error: "Admin location not found" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const parsedParams = querySchema.safeParse({
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      sortBy: searchParams.get("sortBy") ?? undefined,
      sortOrder: searchParams.get("sortOrder") ?? undefined,
      isActive: searchParams.get("isActive") ?? undefined,
      showOnPayment: searchParams.get("showOnPayment") ?? undefined,
      showOnPledge: searchParams.get("showOnPledge") ?? undefined,
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

    const { page, limit, search, sortBy, sortOrder, isActive, showOnPayment, showOnPledge } =
      parsedParams.data;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(tag.name, `%${search}%`),
          ilike(tag.description, `%${search}%`)
        )
      );
    }
    if (isActive !== undefined) conditions.push(eq(tag.isActive, isActive));
    if (showOnPayment !== undefined) conditions.push(eq(tag.showOnPayment, showOnPayment));
    if (showOnPledge !== undefined) conditions.push(eq(tag.showOnPledge, showOnPledge));

    // Add location ID filter for admin users
    conditions.push(eq(tag.locationId, adminLocationId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    let orderByClause;
    switch (sortBy) {
      case "id":
        orderByClause = sortOrder === "asc" ? asc(tag.id) : desc(tag.id);
        break;
      case "name":
        orderByClause = sortOrder === "asc" ? asc(tag.name) : desc(tag.name);
        break;
      case "isActive":
        orderByClause = sortOrder === "asc" ? asc(tag.isActive) : desc(tag.isActive);
        break;
      case "showOnPayment":
        orderByClause = sortOrder === "asc" ? asc(tag.showOnPayment) : desc(tag.showOnPayment);
        break;
      case "showOnPledge":
        orderByClause = sortOrder === "asc" ? asc(tag.showOnPledge) : desc(tag.showOnPledge);
        break;
      case "createdAt":
        orderByClause = sortOrder === "asc" ? asc(tag.createdAt) : desc(tag.createdAt);
        break;
      case "updatedAt":
      default:
        orderByClause = sortOrder === "asc" ? asc(tag.updatedAt) : desc(tag.updatedAt);
        break;
    }

    const query = db
      .select()
      .from(tag)
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    const countQuery = db
      .select({
        count: sql<number>`count(*)`.as("count"),
      })
      .from(tag)
      .where(whereClause);

    const [tags, totalCountResult] = await Promise.all([
      query.execute(),
      countQuery.execute(),
    ]);

    const totalCount = Number(totalCountResult[0]?.count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    const response = {
      tags,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      filters: {
        search,
        isActive,
        showOnPayment,
        showOnPledge,
        sortBy,
        sortOrder,
      },
    };

    return NextResponse.json(response, {
      headers: {
        "X-Total-Count": response.pagination.totalCount.toString(),
      },
    });
  } catch (error) {
    console.error("Error fetching tags:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch tags",
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get session without passing request
    const session = await getServerSession(authOptions);

    // Check if session exists and user is authenticated
    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized - No session found" },
        { status: 401 }
      );
    }

    // Check if user has admin role
    const userRole = session.user.role;
    if (userRole !== "admin") {
      return NextResponse.json(
        {
          error: "Forbidden: Admin access required",
          userRole: userRole
        },
        { status: 403 }
      );
    }

    // Get the admin's location ID
    const adminLocationId = session.user.locationId;
    if (!adminLocationId) {
      return NextResponse.json(
        { error: "Admin location not found" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validatedData = tagSchema.parse(body);

    const existingTag = await db
      .select()
      .from(tag)
      .where(
        and(eq(tag.name, validatedData.name), eq(tag.isActive, true), eq(tag.locationId, adminLocationId))
      )
      .limit(1);

    if (existingTag.length > 0) {
      return NextResponse.json(
        {
          error: "Duplicate tag",
          message: `Tag with name '${validatedData.name}' already exists`,
        },
        { status: 409 }
      );
    }

    const newTag: NewTag = {
      ...validatedData,
      locationId: adminLocationId,
    };

    const result = await db.insert(tag).values(newTag).returning();

    return NextResponse.json(
      {
        message: "Tag created successfully",
        tag: result[0],
      },
      { status: 201 }
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

    return ErrorHandler.handle(error);
  }
}
