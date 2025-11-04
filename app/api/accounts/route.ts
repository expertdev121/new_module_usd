import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { account } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");

    let whereCondition = undefined;
    if (locationId) {
      whereCondition = eq(account.locationId, locationId);
    }

    // For admin users, automatically filter by their locationId if no locationId is specified
    if (session.user.role === "admin" && !locationId && session.user.locationId) {
      whereCondition = eq(account.locationId, session.user.locationId);
    }

    const accounts = await db
      .select({
        id: account.id,
        name: account.name,
        description: account.description,
        locationId: account.locationId,
        isActive: account.isActive,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      })
      .from(account)
      .where(whereCondition)
      .orderBy(account.name);

    return NextResponse.json(accounts);
  } catch (error) {
    console.error("Error fetching accounts:", error);
    return NextResponse.json(
      { error: "Failed to fetch accounts" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
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

    // For admin users, automatically set locationId to their location if not provided
    let accountLocationId = locationId;
    if (session.user.role === "admin" && !locationId && session.user.locationId) {
      accountLocationId = session.user.locationId;
    }

    const newAccount = await db
      .insert(account)
      .values({
        name,
        description,
        locationId: accountLocationId,
      })
      .returning();

    return NextResponse.json(newAccount[0], { status: 201 });
  } catch (error) {
    console.error("Error creating account:", error);
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  }
}
