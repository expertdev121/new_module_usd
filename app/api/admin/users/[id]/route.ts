import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { user, contact } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Await params in Next.js 15
    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const { email, status, role, password } = await request.json();

    if (email && typeof email !== 'string') {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    if (status && !["active", "suspended"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    if (role && !["admin", "user"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    if (password && typeof password !== 'string') {
      return NextResponse.json({ error: "Invalid password format" }, { status: 400 });
    }

    // Get admin's locationId from database
    const adminUser = await db
      .select({ locationId: user.locationId })
      .from(user)
      .where(eq(user.id, parseInt(session.user.id)))
      .limit(1);

    const adminLocationId = adminUser.length > 0 ? adminUser[0].locationId : null;

    // Check if email is already taken by another user within the same location
    if (email) {
      const existingUserQuery = adminLocationId
        ? db
          .select()
          .from(user)
          .where(and(eq(user.email, email), eq(user.locationId, adminLocationId)))
          .limit(1)
        : db
          .select()
          .from(user)
          .where(eq(user.email, email))
          .limit(1);

      const existingUser = await existingUserQuery;

      if (existingUser.length > 0 && existingUser[0].id !== userId) {
        return NextResponse.json({ error: "Email already in use" }, { status: 400 });
      }
    }

    // Update user data
    const updateData: Partial<Pick<typeof user.$inferSelect, 'email' | 'passwordHash' | 'status' | 'role' | 'locationId' | 'updatedAt'>> = {};
    if (email) updateData.email = email;
    if (password) {
      // Hash the password before storing
      const bcrypt = await import('bcryptjs');
      updateData.passwordHash = await bcrypt.hash(password, 12);
    }
    if (status) updateData.status = status;
    if (role) updateData.role = role;
    // Update locationId to match the admin's location only if admin has a valid locationId
    if (adminLocationId) {
      updateData.locationId = adminLocationId;
    }
    updateData.updatedAt = new Date();

    await db
      .update(user)
      .set(updateData)
      .where(eq(user.id, userId));

    // Update the corresponding contact record if email was changed
    if (email) {
      const contactUpdateData: Partial<Pick<typeof contact.$inferSelect, 'email' | 'locationId' | 'updatedAt'>> = {
        email: email,
        updatedAt: new Date(),
      };
      if (adminLocationId) {
        contactUpdateData.locationId = adminLocationId;
      }
      await db
        .update(contact)
        .set(contactUpdateData)
        .where(eq(contact.email, email));
    }

    return NextResponse.json({ message: "User updated successfully" });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Await params in Next.js 15
    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    // Prevent admin from deleting themselves
    if (Number(session.user.id) === userId) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    await db
      .delete(user)
      .where(eq(user.id, userId));

    return NextResponse.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
