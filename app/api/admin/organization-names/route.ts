import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationName } from "@/lib/db/schema";
import { asc, eq, ilike, or, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(Number.parseInt(searchParams.get("page") || "1", 10), 1);
    const pageSize = Math.max(
      1,
      Math.min(Number.parseInt(searchParams.get("pageSize") || "10", 10), 100)
    );
    const search = searchParams.get("search")?.trim() || "";
    const offset = (page - 1) * pageSize;

    const whereClause = search
      ? or(
          ilike(organizationName.orgName, `%${search}%`),
          ilike(organizationName.locationId, `%${search}%`)
        )
      : undefined;

    const organizationNames = await db
      .select()
      .from(organizationName)
      .where(whereClause)
      .orderBy(asc(organizationName.orgName));

    const totalCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(organizationName)
      .where(whereClause);

    const totalCount = Number(totalCountResult[0]?.count || 0);
    const paginatedData = organizationNames.slice(offset, offset + pageSize);

    return NextResponse.json({
      data: paginatedData,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      },
    });
  } catch (error) {
    console.error("Error fetching organization names:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const locationId = typeof body.locationId === "string" ? body.locationId.trim() : "";
    const orgName = typeof body.orgName === "string" ? body.orgName.trim() : "";

    if (!locationId || !orgName) {
      return NextResponse.json(
        { error: "Location ID and org name are required" },
        { status: 400 }
      );
    }

    const existingOrganizationName = await db
      .select({ id: organizationName.id })
      .from(organizationName)
      .where(eq(organizationName.locationId, locationId))
      .limit(1);

    if (existingOrganizationName.length > 0) {
      return NextResponse.json(
        { error: "Organization name already exists for this location ID" },
        { status: 409 }
      );
    }

    const [savedOrganizationName] = await db
      .insert(organizationName)
      .values({
        locationId,
        orgName,
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json(savedOrganizationName, { status: 201 });
  } catch (error) {
    console.error("Error saving organization name:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
