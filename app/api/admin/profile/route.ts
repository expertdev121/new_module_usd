import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { logAudit } from "@/lib/audit";

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, email, password, currentPassword } = await request.json();

    // Self-only update
    const userId = parseInt(session.user.id);
    if (!id || parseInt(id) !== userId) {
      return NextResponse.json({ error: "Can only update your own profile" }, { status: 403 });
    }

    const currentUser = await db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!currentUser.length) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const updateData: any = { updatedAt: new Date() };
    let auditDetails: any = { entityId: userId };

    if (email && typeof email === 'string') {
      // Email uniqueness check
      const adminLocationId = session.user.locationId || null;
      const existingUserQuery = adminLocationId
        ? db.select().from(user).where(and(eq(user.email, email), eq(user.locationId, adminLocationId)))
        : db.select().from(user).where(eq(user.email, email));
      
      const existingUser = await existingUserQuery.limit(1);
      if (existingUser.length > 0 && existingUser[0].id !== userId) {
        return NextResponse.json({ error: "Email already in use" }, { status: 400 });
      }

      auditDetails.oldEmail = currentUser[0].email;
      auditDetails.newEmail = email;
      updateData.email = email;
    }

    if (password && typeof password === 'string' && password.length >= 6) {
      // Verify current password
      if (currentPassword && typeof currentPassword === 'string') {
        const isValid = await bcrypt.compare(currentPassword, currentUser[0].passwordHash);
        if (!isValid) {
          return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
        }
      } else {
        return NextResponse.json({ error: "Current password is required" }, { status: 400 });
      }

      updateData.passwordHash = await bcrypt.hash(password, 12);
      auditDetails.changedPassword = true;
      auditDetails.oldPasswordChanged = true;
    }

    if (Object.keys(updateData).length === 1) { // Only updatedAt
      return NextResponse.json({ error: "No changes provided" }, { status: 400 });
    }

    await db.update(user).set(updateData).where(eq(user.id, userId));

    // Audit log
    await logAudit("user_profile_update", auditDetails);

    return NextResponse.json({ message: "Profile updated successfully" });
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

