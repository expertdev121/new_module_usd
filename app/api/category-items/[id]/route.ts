import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next"; 
import { authOptions } from "@/lib/auth"; 
import { db } from "@/lib/db";
import { categoryItem } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm"; 
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";
import { categoryItemUpdateSchema } from "@/lib/form-schemas/category-item";


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const itemId = parseInt(id);

  if (isNaN(itemId)) {
    return NextResponse.json({ error: "Invalid category item ID" }, { status: 400 });
  }

  try {
    const item = await db
      .select()
      .from(categoryItem)
      .where(eq(categoryItem.id, itemId))
      .limit(1);

    if (item.length === 0) {
      return NextResponse.json({ error: "Category item not found" }, { status: 404 });
    }

    return NextResponse.json(item[0]);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to fetch category item" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const itemId = parseInt(id);

  if (isNaN(itemId)) {
    return NextResponse.json({ error: "Invalid category item ID" }, { status: 400 });
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized - No session found" }, { status: 401 });
    }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }

    const adminLocationId = session.user.locationId;
    if (!adminLocationId) {
      return NextResponse.json({ error: "Admin location not found" }, { status: 400 });
    }

    const body = await request.json();
    const validatedData = categoryItemUpdateSchema.parse(body);

    // Duplicate check if name or categoryId is changing
    if (validatedData.name !== undefined || validatedData.categoryId !== undefined) {
      const existingItem = await db
        .select()
        .from(categoryItem)
        .where(
          and(
            eq(categoryItem.name, validatedData.name ?? ""),
            eq(categoryItem.categoryId, validatedData.categoryId ?? 0),
            eq(categoryItem.locationId, adminLocationId),
            sql`${categoryItem.id} != ${itemId}`
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
    }

    const result = await db
      .update(categoryItem)
      .set({ ...validatedData, updatedAt: new Date() })
      .where(and(eq(categoryItem.id, itemId), eq(categoryItem.locationId, adminLocationId)))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: "Category item not found or not accessible" }, { status: 404 });
    }

    return NextResponse.json({ message: "Category item updated successfully", item: result[0] });
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


export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const itemId = parseInt(id);

  if (isNaN(itemId)) {
    return NextResponse.json({ error: "Invalid category item ID" }, { status: 400 });
  }

  try {
    const result = await db
      .delete(categoryItem)
      .where(eq(categoryItem.id, itemId))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: "Category item not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Category item deleted successfully" });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to delete category item" },
      { status: 500 }
    );
  }
}
