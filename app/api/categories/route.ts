import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { sql, desc, asc, or, ilike, and, eq } from "drizzle-orm";
import { logCategoryAction} from "@/lib/audit";
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";
import { category, NewCategory } from "@/lib/db/schema";
import { categorySchema } from "@/lib/form-schemas/category";

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(1000).default(10),
  search: z.string().optional(),
  sortBy: z.string().default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  isActive: z.coerce.boolean().optional(),
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

    const { page, limit, search, sortBy, sortOrder, isActive } =
      parsedParams.data;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(category.name, `%${search}%`),
          ilike(category.description, `%${search}%`)
        )
      );
    }
    if (isActive !== undefined)
      conditions.push(eq(category.isActive, isActive));

    // Filter by admin's location ID
    conditions.push(eq(category.locationId, adminLocationId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    let orderByClause;
    switch (sortBy) {
      case "id":
        orderByClause =
          sortOrder === "asc" ? asc(category.id) : desc(category.id);
        break;
      case "name":
        orderByClause =
          sortOrder === "asc" ? asc(category.name) : desc(category.name);
        break;
      case "isActive":
        orderByClause =
          sortOrder === "asc"
            ? asc(category.isActive)
            : desc(category.isActive);
        break;
      case "createdAt":
        orderByClause =
          sortOrder === "asc"
            ? asc(category.createdAt)
            : desc(category.createdAt);
        break;
      case "updatedAt":
      default:
        orderByClause =
          sortOrder === "asc"
            ? asc(category.updatedAt)
            : desc(category.updatedAt);
        break;
    }

    const query = db
      .select()
      .from(category)
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    const countQuery = db
      .select({
        count: sql<number>`count(*)`.as("count"),
      })
      .from(category)
      .where(whereClause);

    const [categories, totalCountResult] = await Promise.all([
      query.execute(),
      countQuery.execute(),
    ]);

    const totalCount = Number(totalCountResult[0]?.count || 0);
    const totalPages = Math.ceil(totalCount / limit);

    const response = {
      categories,
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
    console.error("Error fetching categories:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch categories",
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized - No session found" },
        { status: 401 }
      );
    }

    if (session.user.role !== "admin") {
      return NextResponse.json(
        {
          error: "Forbidden: Admin access required",
          userRole: session.user.role,
        },
        { status: 403 }
      );
    }

    const adminLocationId = session.user.locationId;
    if (!adminLocationId) {
      return NextResponse.json(
        { error: "Admin location not found" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validatedData = categorySchema.parse(body);

    // ✅ Check for duplicate name within the same admin's location
    const existingCategory = await db
      .select()
      .from(category)
      .where(
        and(
          eq(category.name, validatedData.name),
          eq(category.locationId, adminLocationId),
          eq(category.isActive, true)
        )
      )
      .limit(1);

    if (existingCategory.length > 0) {
      return NextResponse.json(
        {
          error: "Duplicate category",
          message: `Category '${validatedData.name}' already exists in this location`,
        },
        { status: 409 }
      );
    }

    const newCategory: NewCategory = {
      ...validatedData,
      locationId: adminLocationId,
    };

    const result = await db.insert(category).values(newCategory).returning();

    // ✅ AUDIT LOGGING
    await logCategoryAction("create", result[0].id, {
      name: newCategory.name,
      locationId: newCategory.locationId
    });

    return NextResponse.json(
      {
        message: "Category created successfully",
        category: result[0],
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

