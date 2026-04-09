import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { email, password, role, status, locationId, accessType } = await request.json();
    const resolvedParams = await params;
    const userId = parseInt(resolvedParams.id);

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Check if another user with this email exists
    const existingUser = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (existingUser.length > 0 && existingUser[0].id !== userId) {
      return NextResponse.json({ error: "User with this email already exists" }, { status: 400 });
    }

    // Prepare update data
    const updateData: {
      email: string;
      role: "user" | "admin" | "super_admin";
      status: "active" | "suspended";
      accessType: "full" | "trial";
      locationId: string | null;
      passwordHash?: string;
    } = {
      email,
      role: (role as "user" | "admin" | "super_admin") || "admin",
      status: (status as "active" | "suspended") || "active",
      accessType: accessType === "trial" ? "trial" : "full",
      locationId: locationId || null,
    };

    // Only update password if provided
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 12);
    }

    // Update user
    const updatedUser = await db
      .update(user)
      .set(updateData)
      .where(eq(user.id, userId))
      .returning();

    if (updatedUser.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(updatedUser[0]);
  } catch (error) {
    console.error("Error updating admin:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const resolvedParams = await params;
    const userId = parseInt(resolvedParams.id);

    // Check if user exists and is not a super_admin
    const userToDelete = await db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (userToDelete.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (userToDelete[0].role === "super_admin") {
      return NextResponse.json({ error: "Cannot delete super admin" }, { status: 403 });
    }

    // Delete user
    await db.delete(user).where(eq(user.id, userId));

    return NextResponse.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting admin:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
