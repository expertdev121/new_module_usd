import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { eq, and, gte, lte, like, ilike, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const userEmail = searchParams.get("userEmail");
    const locationId = searchParams.get("locationId");
    const contactName = searchParams.get("contactName");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const whereConditions = [];

    // Always filter by user's location (super_admin can see all)
    if (session.user.role !== "super_admin" && session.user.locationId) {
      whereConditions.push(eq(auditLog.locationId, session.user.locationId));
    }

    if (action && action !== "all") {
      whereConditions.push(eq(auditLog.action, action));
    }

    if (userEmail) {
      whereConditions.push(ilike(auditLog.userEmail, `%${userEmail}%`));
    }

    if (locationId) {
      whereConditions.push(eq(auditLog.locationId, locationId));
    }

    if (contactName) {
      // Search in details.contactName (jsonb)
      whereConditions.push(ilike(auditLog.details, `%contactName:${contactName}%`));
    }

    if (dateFrom) {
      whereConditions.push(gte(auditLog.timestamp, new Date(dateFrom)));
    }

    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setDate(endDate.getDate() + 1);
      whereConditions.push(lte(auditLog.timestamp, endDate));
    }

    const logs = await db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        userEmail: auditLog.userEmail,
        locationId: auditLog.locationId,
        action: auditLog.action,
        details: auditLog.details,
        ipAddress: auditLog.ipAddress,
        userAgent: auditLog.userAgent,
        timestamp: auditLog.timestamp,
      })
      .from(auditLog)
      .where(and(...whereConditions))
      .orderBy(desc(auditLog.timestamp))
      .limit(1000);

    return NextResponse.json(logs);
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

