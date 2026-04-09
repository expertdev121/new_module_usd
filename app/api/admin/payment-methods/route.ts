
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from '@/lib/db';
import { sql, eq, and } from "drizzle-orm";
import { paymentMethods, PaymentMethod, NewPaymentMethod } from '@/lib/db/schema';

export async function GET() {
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

    const methods = await db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.locationId, adminLocationId))
      .orderBy(paymentMethods.id);
    return NextResponse.json(methods);
  } catch (error) {
    console.error("Error fetching payment methods:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch payment methods",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
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
    const { name, description, isActive } = data;

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    // Check for duplicate name within the same location
    const existing = await db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.name, name), eq(paymentMethods.locationId, adminLocationId)))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ error: `Payment method '${name}' already exists for your location` }, { status: 409 });
    }

    const [created] = await db
      .insert(paymentMethods)
      .values({ name, description, isActive, locationId: adminLocationId })
      .returning();

    return NextResponse.json({ message: "Payment method created successfully", method: created }, { status: 201 });
  } catch (error) {
    console.error("Error creating payment method:", error);
    return NextResponse.json({
      error: "Failed to create payment method",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
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
    const { id, name, description, isActive } = data;

    if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    // Update only if the payment method belongs to the admin's location
    const [updated] = await db
      .update(paymentMethods)
      .set({ name, description, isActive, updatedAt: new Date() })
      .where(and(eq(paymentMethods.id, id), eq(paymentMethods.locationId, adminLocationId)))
      .returning();

    if (!updated) return NextResponse.json({ error: 'Payment method not found or not accessible' }, { status: 404 });

    return NextResponse.json({ message: "Payment method updated successfully", method: updated });
  } catch (error) {
    console.error("Error updating payment method:", error);
    return NextResponse.json({
      error: "Failed to update payment method",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}

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
    const [deleted] = await db.delete(paymentMethods).where(eq(paymentMethods.id, id)).returning();
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(deleted);
  } catch (error) {
    console.error("Error deleting payment method:", error);
    return NextResponse.json(
      {
        error: "Failed to delete payment method",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
