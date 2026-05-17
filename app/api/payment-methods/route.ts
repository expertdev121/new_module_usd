import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { eq, and } from "drizzle-orm";
import { paymentMethods, paymentMethodDetails, user } from '@/lib/db/schema';
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// List all active payment methods with their details (filtered by location)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "admin" && session.user.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get admin's locationId
    const userResult = await db
      .select({ locationId: user.locationId })
      .from(user)
      .where(eq(user.email, session.user.email))
      .limit(1);

    if (!userResult.length || !userResult[0].locationId) {
      return NextResponse.json({ error: "Admin location not found" }, { status: 400 });
    }

    const adminLocationId = userResult[0].locationId;

    // Get all active payment methods for admin's location only
    const methods = await db
      .select()
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.isActive, true),
          eq(paymentMethods.locationId, adminLocationId)
        )
      )
      .orderBy(paymentMethods.name);

    // Get all details for these payment methods
    const methodIds = methods.map(m => m.id);
    
    let details: typeof paymentMethodDetails.$inferSelect[] = [];
    if (methodIds.length > 0) {
      // Get details for all payment methods in one query
      const allDetails = await db
        .select()
        .from(paymentMethodDetails);
      
      // Filter to only include details for the filtered payment methods
      details = allDetails.filter(detail => methodIds.includes(detail.paymentMethodId));
    }

    // Combine methods with their details (matching your schema structure)
    const methodsWithDetails = methods.map(method => ({
      id: method.id,
      name: method.name,
      description: method.description,
      isActive: method.isActive,
      createdAt: method.createdAt,
      updatedAt: method.updatedAt,
      details: details.filter(detail => detail.paymentMethodId === method.id)
    }));

    return NextResponse.json(methodsWithDetails);
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    return NextResponse.json({ error: 'Failed to fetch payment methods' }, { status: 500 });
  }
}