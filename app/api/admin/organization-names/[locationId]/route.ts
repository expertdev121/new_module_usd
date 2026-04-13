import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationName } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ locationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { locationId: rawLocationId } = await params;
    const locationId = rawLocationId.trim();
    const body = await request.json();
    const orgName = typeof body.orgName === "string" ? body.orgName.trim() : "";

    if (!locationId || !orgName) {
      return NextResponse.json(
        { error: "Location ID and org name are required" },
        { status: 400 }
      );
    }

    const [updatedOrganizationName] = await db
      .update(organizationName)
      .set({
        orgName,
        updatedAt: new Date(),
      })
      .where(eq(organizationName.locationId, locationId))
      .returning();

    if (!updatedOrganizationName) {
      return NextResponse.json({ error: "Organization name not found" }, { status: 404 });
    }

    return NextResponse.json(updatedOrganizationName);
  } catch (error) {
    console.error("Error updating organization name:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ locationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { locationId: rawLocationId } = await params;
    const locationId = rawLocationId.trim();

    if (!locationId) {
      return NextResponse.json({ error: "Location ID is required" }, { status: 400 });
    }

    const [deletedOrganizationName] = await db
      .delete(organizationName)
      .where(eq(organizationName.locationId, locationId))
      .returning();

    if (!deletedOrganizationName) {
      return NextResponse.json({ error: "Organization name not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Organization name deleted successfully" });
  } catch (error) {
    console.error("Error deleting organization name:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
