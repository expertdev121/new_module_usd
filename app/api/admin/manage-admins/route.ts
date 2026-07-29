import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationName, user } from "@/lib/db/schema";
import { getTrialAccessState } from "@/lib/trial";
import { and, eq, like, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "10");
    const search = searchParams.get("search")?.trim() || "";
    // Include non-admin users too when ?includeAllRoles=1 is passed —
    // used by the super-admin "all users" view that needs to see every
    // tenant user (including trial members) for manual cleanup of
    // expired trials.
    const includeAllRoles = searchParams.get("includeAllRoles") === "1";

    const offset = (page - 1) * pageSize;

    const whereClause = includeAllRoles
      ? (search ? like(user.email, `%${search}%`) : sql`TRUE`)
      : (search
          ? and(eq(user.role, "admin"), like(user.email, `%${search}%`))
          : eq(user.role, "admin"));

    // Get total count
    const totalResult = await db
      .select({ count: user.id })
      .from(user)
      .where(whereClause);

    const total = totalResult.length;

    // Get paginated admins
    const admins = await db
      .select({
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        accessType: user.accessType,
        locationId: user.locationId,
        orgName: organizationName.orgName,
        createdAt: user.createdAt,
      })
      .from(user)
      .leftJoin(organizationName, eq(user.locationId, organizationName.locationId))
      .where(whereClause)
      .orderBy(user.createdAt)
      .limit(pageSize)
      .offset(offset);

    return NextResponse.json({
      data: admins.map((admin) => {
        const trialState = getTrialAccessState({
          accessType: admin.accessType,
          createdAt: admin.createdAt,
        });

        return {
          ...admin,
          trialEndsAt: trialState.trialEndsAt,
          trialExpired: trialState.trialExpired,
        };
      }),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("Error fetching admins:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { email, password, role, status, locationId, accessType } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    // Check if user already exists
    const existingUser = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      return NextResponse.json({ error: "User with this email already exists" }, { status: 400 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const newUser = await db
      .insert(user)
      .values({
        email,
        passwordHash: hashedPassword,
        role: role || "admin",
        status: status || "active",
        accessType: accessType === "trial" ? "trial" : "full",
        locationId: locationId || null,
      })
      .returning();

    return NextResponse.json(newUser[0], { status: 201 });
  } catch (error) {
    console.error("Error creating admin:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
