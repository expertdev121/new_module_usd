import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { categoryGroup, category, categoryItem, NewCategoryGroup } from "@/lib/db/schema";
import { eq, or, ilike, and } from "drizzle-orm";
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";
import { categoryGroupSchema } from "@/lib/form-schemas/category-group";

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

    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(categoryGroup.name, `%${search}%`),
          ilike(category.name, `%${search}%`),
          ilike(categoryItem.name, `%${search}%`)
        )
      );
    }

    // Filter by admin's location ID
    conditions.push(eq(categoryGroup.locationId, adminLocationId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const groups = await db
      .select({
        id: categoryGroup.id,
        name: categoryGroup.name,
        categoryId: categoryGroup.categoryId,
        categoryName: category.name,
        categoryItemId: categoryGroup.categoryItemId,
        categoryItemName: categoryItem.name,
        createdAt: categoryGroup.createdAt,
        updatedAt: categoryGroup.updatedAt,
      })
      .from(categoryGroup)
      .leftJoin(category, eq(categoryGroup.categoryId, category.id))
      .leftJoin(categoryItem, eq(categoryGroup.categoryItemId, categoryItem.id))
      .where(whereClause)
      .orderBy(categoryGroup.name);

    return NextResponse.json(groups);
  } catch (error) {
    console.error("Error fetching category groups:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch category groups",
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

    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
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
    const validatedData = categoryGroupSchema.parse(body);

    // ✅ Duplicate check scoped to location
    const existingGroup = await db
      .select()
      .from(categoryGroup)
      .where(
        and(
          eq(categoryGroup.name, validatedData.name),
          eq(categoryGroup.categoryId, validatedData.categoryId),
          eq(categoryGroup.categoryItemId, validatedData.categoryItemId),
          eq(categoryGroup.locationId, adminLocationId) // <-- location scoped
        )
      )
      .limit(1);

    if (existingGroup.length > 0) {
      return NextResponse.json(
        {
          error: "Duplicate category group",
          message: `Category group '${validatedData.name}' already exists for this category and item in your location`,
        },
        { status: 409 }
      );
    }

    const newGroup: NewCategoryGroup = {
      ...validatedData,
      locationId: adminLocationId,
    };

    const result = await db.insert(categoryGroup).values(newGroup).returning();

    return NextResponse.json(
      {
        message: "Category group created successfully",
        group: result[0],
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
