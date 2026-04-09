
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from '@/lib/db';
import { sql, eq, and } from "drizzle-orm";
import { paymentMethodDetails, PaymentMethodDetail, NewPaymentMethodDetail } from '@/lib/db/schema';

// List all payment method details (optionally filter by paymentMethodId)
export async function GET(req: NextRequest) {
  try {
    // Get session without passing request
    const session = await getServerSession(authOptions);

    // Check if session exists and user is authenticated
    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized - No session found" },
        { status: 401 }
      );
    }

    // Check if user has admin role
    const userRole = session.user.role;
    if (userRole !== "admin") {
      return NextResponse.json(
        {
          error: "Forbidden: Admin access required",
          userRole: userRole
        },
        { status: 403 }
      );
    }

    // Get the admin's location ID
    const adminLocationId = session.user.locationId;
    if (!adminLocationId) {
      return NextResponse.json(
        { error: "Admin location not found" },
        { status: 400 }
      );
    }

    const paymentMethodId = req.nextUrl.searchParams.get('paymentMethodId');
    let details;

    if (paymentMethodId) {
      details = await db
        .select()
        .from(paymentMethodDetails)
        .where(
          and(
            eq(paymentMethodDetails.paymentMethodId, Number(paymentMethodId)),
            eq(paymentMethodDetails.locationId, adminLocationId)
          )
        );
    } else {
      details = await db
        .select()
        .from(paymentMethodDetails)
        .where(eq(paymentMethodDetails.locationId, adminLocationId));
    }

    return NextResponse.json(details);
  } catch (error) {
    console.error("Error fetching payment method details:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch payment method details",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized - No session found" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }

    const adminLocationId = session.user.locationId;
    if (!adminLocationId) {
      return NextResponse.json({ error: "Admin location not found" }, { status: 400 });
    }

    const data = await req.json();
    const { paymentMethodId, key, value } = data;

    if (!paymentMethodId || !key) {
      return NextResponse.json({ error: 'paymentMethodId and key are required' }, { status: 400 });
    }

    // Optional: prevent duplicates for the same paymentMethodId and key
    const existing = await db
      .select()
      .from(paymentMethodDetails)
      .where(and(
        eq(paymentMethodDetails.paymentMethodId, paymentMethodId),
        eq(paymentMethodDetails.key, key),
        eq(paymentMethodDetails.locationId, adminLocationId)
      ))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ error: `Detail with key '${key}' already exists for this payment method` }, { status: 409 });
    }

    const [created] = await db
      .insert(paymentMethodDetails)
      .values({ paymentMethodId, key, value, locationId: adminLocationId })
      .returning();

    return NextResponse.json({ message: "Payment method detail created successfully", detail: created }, { status: 201 });
  } catch (error) {
    console.error("Error creating payment method detail:", error);
    return NextResponse.json({
      error: "Failed to create payment method detail",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized - No session found" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }

    const adminLocationId = session.user.locationId;
    if (!adminLocationId) {
      return NextResponse.json({ error: "Admin location not found" }, { status: 400 });
    }

    const data = await req.json();
    const { id, key, value } = data;

    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

    const [updated] = await db
      .update(paymentMethodDetails)
      .set({ key, value, updatedAt: new Date() })
      .where(and(
        eq(paymentMethodDetails.id, id),
        eq(paymentMethodDetails.locationId, adminLocationId)
      ))
      .returning();

    if (!updated) return NextResponse.json({ error: 'Detail not found or not accessible' }, { status: 404 });

    return NextResponse.json({ message: "Payment method detail updated successfully", detail: updated });
  } catch (error) {
    console.error("Error updating payment method detail:", error);
    return NextResponse.json({
      error: "Failed to update payment method detail",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}

// Delete a payment method detail
export async function DELETE(req: NextRequest) {
  try {
    // Get session without passing request
    const session = await getServerSession(authOptions);

    // Check if session exists and user is authenticated
    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Unauthorized - No session found" },
        { status: 401 }
      );
    }

    // Check if user has admin role
    const userRole = session.user.role;
    if (userRole !== "admin") {
      return NextResponse.json(
        {
          error: "Forbidden: Admin access required",
          userRole: userRole
        },
        { status: 403 }
      );
    }

    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    const [deleted] = await db.delete(paymentMethodDetails).where(eq(paymentMethodDetails.id, id)).returning();
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(deleted);
  } catch (error) {
    console.error("Error deleting payment method detail:", error);
    return NextResponse.json(
      {
        error: "Failed to delete payment method detail",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
