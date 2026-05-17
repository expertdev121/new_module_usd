import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { categoryGroup } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { ErrorHandler } from "@/lib/error-handler";
import { categoryGroupSchema } from "@/lib/form-schemas/category-group";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const groupId = parseInt(id);

  if (isNaN(groupId)) {
    return NextResponse.json({ error: "Invalid category group ID" }, { status: 400 });
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

    const group = await db
      .select()
      .from(categoryGroup)
      .where(and(eq(categoryGroup.id, groupId), eq(categoryGroup.locationId, adminLocationId)))
      .limit(1);

    if (group.length === 0) {
      return NextResponse.json({ error: "Category group not found or not accessible" }, { status: 404 });
    }

    return NextResponse.json(group[0]);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to fetch category group" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const groupId = parseInt(id);

  if (isNaN(groupId)) {
    return NextResponse.json({ error: "Invalid category group ID" }, { status: 400 });
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
    const validatedData = categoryGroupSchema.parse(body);

    // Optional: check for duplicates within location before updating
    if (validatedData.name !== undefined) {
      const existingGroup = await db
        .select()
        .from(categoryGroup)
        .where(
          and(
            eq(categoryGroup.name, validatedData.name),
            eq(categoryGroup.categoryId, validatedData.categoryId),
            eq(categoryGroup.categoryItemId, validatedData.categoryItemId),
            eq(categoryGroup.locationId, adminLocationId),
            sql`${categoryGroup.id} != ${groupId}`
          )
        )
        .limit(1);

      if (existingGroup.length > 0) {
        return NextResponse.json(
          {
            error: "Duplicate category group",
            message: `Category group '${validatedData.name}' already exists in your location`,
          },
          { status: 409 }
        );
      }
    }

    const result = await db
      .update(categoryGroup)
      .set({ ...validatedData, updatedAt: new Date() })
      .where(and(eq(categoryGroup.id, groupId), eq(categoryGroup.locationId, adminLocationId)))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: "Category group not found or not accessible" }, { status: 404 });
    }

    return NextResponse.json({ message: "Category group updated successfully", group: result[0] });
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
  const groupId = parseInt(id);

  if (isNaN(groupId)) {
    return NextResponse.json({ error: "Invalid category group ID" }, { status: 400 });
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

    const result = await db
      .delete(categoryGroup)
      .where(and(eq(categoryGroup.id, groupId), eq(categoryGroup.locationId, adminLocationId)))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: "Category group not found or not accessible" }, { status: 404 });
    }

    return NextResponse.json({ message: "Category group deleted successfully" });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to delete category group" }, { status: 500 });
  }
}
