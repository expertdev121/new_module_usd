import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { eq, and, like, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    // Get session without passing request
    const session = await getServerSession(authOptions);

    // DEBUG: Log the entire session
    console.log("=== SESSION DEBUG ===");
    console.log("Session exists:", !!session);
    console.log("Session:", session);

    // Check if session exists and user is authenticated
    if (!session || !session.user) {
      console.log("No session or user found");
      return NextResponse.json(
        { error: "Unauthorized - No session found" },
        { status: 401 }
      );
    }

    // Check if user has admin role
    const userRole = session.user.role;
    console.log("User role:", userRole);
    console.log("User email:", session.user.email);

    if (userRole !== "admin") {
      console.log("User is not admin");
      return NextResponse.json(
        {
          error: "Forbidden: Admin access required",
          userRole: userRole
        },
        { status: 403 }
      );
    }

    console.log("User authenticated as admin - fetching users");

    // Get the admin's location ID
    const adminLocationId = session.user.locationId;
    console.log("Admin location ID:", adminLocationId);

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const search = searchParams.get("search") || "";

    const offset = (page - 1) * limit;

    // Build where conditions
    const whereConditions = [eq(user.role, "user"), eq(user.locationId, adminLocationId)];

    if (search) {
      whereConditions.push(like(user.email, `%${search}%`));
    }

    // Get total count for pagination
    const totalCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(user)
      .where(and(...whereConditions));

    const totalCount = totalCountResult[0].count;

    // Get paginated users
    const users = await db
      .select({
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .where(and(...whereConditions))
      .orderBy(user.createdAt)
      .limit(limit)
      .offset(offset);

    console.log(`Successfully fetched ${users.length} users (page ${page}, limit ${limit}, search: "${search}")`);

    return NextResponse.json({
      users,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      }
    });
  } catch (error) {
    console.error("Error in GET /api/admin/users:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
