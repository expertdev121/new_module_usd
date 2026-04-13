import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationName } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requestedLocationId = request.nextUrl.searchParams.get("locationId");
    const locationId =
      requestedLocationId && session.user.role === "super_admin"
        ? requestedLocationId
        : session.user.locationId;

    if (!locationId) {
      return NextResponse.json({ orgName: "Organization" });
    }

    const result = await db
      .select({ orgName: organizationName.orgName })
      .from(organizationName)
      .where(eq(organizationName.locationId, locationId))
      .limit(1);

    return NextResponse.json({
      orgName: result[0]?.orgName ?? "Organization",
    });
  } catch (error) {
    console.error("Error fetching organization name:", error);
    return NextResponse.json(
      { error: "Failed to fetch organization name" },
      { status: 500 }
    );
  }
}
