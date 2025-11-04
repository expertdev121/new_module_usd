import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { account } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id: idString } = await params;
    const id = parseInt(idString);
    if (isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid account ID" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, description, locationId } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Account name is required" },
        { status: 400 }
      );
    }

    // For admin users, verify the account belongs to their location
    if (session.user.role === "admin" && session.user.locationId) {
      const existingAccount = await db
        .select({ locationId: account.locationId })
        .from(account)
        .where(eq(account.id, id))
        .limit(1);

      if (existingAccount.length === 0) {
        return NextResponse.json(
          { error: "Account not found" },
          { status: 404 }
        );
      }

      if (existingAccount[0].locationId !== session.user.locationId) {
        return NextResponse.json(
          { error: "Access denied: Account belongs to a different location" },
          { status: 403 }
        );
      }
    }

    const updatedAccount = await db
      .update(account)
      .set({
        name,
        description,
        locationId,
        updatedAt: new Date(),
      })
      .where(eq(account.id, id))
      .returning();

    if (updatedAccount.length === 0) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(updatedAccount[0]);
  } catch (error) {
    console.error("Error updating account:", error);
    return NextResponse.json(
      { error: "Failed to update account" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id: idString } = await params;
    const id = parseInt(idString);
    if (isNaN(id)) {
      return NextResponse.json(
        { error: "Invalid account ID" },
        { status: 400 }
      );
    }

    // For admin users, verify the account belongs to their location
    if (session.user.role === "admin" && session.user.locationId) {
      const existingAccount = await db
        .select({ locationId: account.locationId })
        .from(account)
        .where(eq(account.id, id))
        .limit(1);

      if (existingAccount.length === 0) {
        return NextResponse.json(
          { error: "Account not found" },
          { status: 404 }
        );
      }

      if (existingAccount[0].locationId !== session.user.locationId) {
        return NextResponse.json(
          { error: "Access denied: Account belongs to a different location" },
          { status: 403 }
        );
      }
    }

    const deletedAccount = await db
      .delete(account)
      .where(eq(account.id, id))
      .returning();

    if (deletedAccount.length === 0) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "Account deleted successfully" });
  } catch (error) {
    console.error("Error deleting account:", error);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}

