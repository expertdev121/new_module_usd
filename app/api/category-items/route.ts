import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { categoryItem, category, NewCategoryItem } from "@/lib/db/schema";
import { eq, or, ilike, and } from "drizzle-orm";
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";
import { categoryItemSchema } from "@/lib/form-schemas/category-item";

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
    const search = searchParams.get("search") || "";

    const query = db
      .select({
        id: categoryItem.id,
        name: categoryItem.name,
        occId: categoryItem.occId,
        categoryId: categoryItem.categoryId,
        categoryName: category.name,
        isActive: categoryItem.isActive,
        createdAt: categoryItem.createdAt,
        updatedAt: categoryItem.updatedAt,
      })
      .from(categoryItem)
      .leftJoin(category, eq(categoryItem.categoryId, category.id));

    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(categoryItem.name, `%${search}%`),
          ilike(category.name, `%${search}%`)
        )
      );
    }

    // Filter by admin's location ID
    conditions.push(eq(categoryItem.locationId, adminLocationId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await (whereClause
      ? query.where(whereClause).orderBy(categoryItem.name)
      : query.orderBy(categoryItem.name));

    return NextResponse.json(items);
  } catch (error) {
    console.error("Error fetching category items:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch category items",
        message: error instanceof Error ? error.message : "Unknown error",
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
    const validatedData = categoryItemSchema.parse(body);

    // ✅ Duplicate check scoped to location
    const existingItem = await db
      .select()
      .from(categoryItem)
      .where(
        and(
          eq(categoryItem.name, validatedData.name),
          eq(categoryItem.categoryId, validatedData.categoryId),
          eq(categoryItem.locationId, adminLocationId) // <-- location scoped
        )
      )
      .limit(1);

    if (existingItem.length > 0) {
      return NextResponse.json(
        {
          error: "Duplicate category item",
          message: `Category item '${validatedData.name}' already exists in this category for your location`,
        },
        { status: 409 }
      );
    }

    const newItem: NewCategoryItem = {
      ...validatedData,
      locationId: adminLocationId,
    };

    const result = await db.insert(categoryItem).values(newItem).returning();

    return NextResponse.json(
      {
        message: "Category item created successfully",
        item: result[0],
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
