import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contact } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ location_id: string; email: string; first_name: string; last_name: string }> }
) {
  try {
    const { location_id, email, first_name, last_name } = await params;

    const session = await getServerSession(authOptions);
    const userRole = session?.user?.role;
    const userLocationId = session?.user?.locationId;

    if (userRole !== "super_admin" && userLocationId !== location_id) {
      return NextResponse.json(
        { error: "You are not authorized to see this contact details." },
        { status: 403 }
      );
    }

    // First, try to find contact by location_id and email
    const contactByEmail = await db
      .select({ id: contact.id })
      .from(contact)
      .where(and(eq(contact.locationId, location_id), eq(contact.email, email)))
      .limit(1);

    if (contactByEmail.length > 0) {
      // Redirect to the contact page
      return NextResponse.redirect(new URL(`/contacts/${contactByEmail[0].id}`, request.url));
    }

    // If not found by email, try by location_id, first_name, and last_name
    const contactByName = await db
      .select({ id: contact.id })
      .from(contact)
      .where(
        and(
          eq(contact.locationId, location_id),
          eq(contact.firstName, first_name),
          eq(contact.lastName, last_name)
        )
      )
      .limit(1);

    if (contactByName.length > 0) {
      // Redirect to the contact page
      return NextResponse.redirect(new URL(`/contacts/${contactByName[0].id}`, request.url));
    }

    // Contact not found
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  } catch (error) {
    console.error("Error finding contact:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
