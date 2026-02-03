import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contact } from "@/lib/db/schema";
import { eq, and, ilike } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ location_id: string; email: string; name?: string[] }> }
) {
  try {
    const { location_id, email, name } = await params;
    const first_name = name && name.length >= 1 ? name[0] : null;
    const last_name = name && name.length >= 2 ? name[1] : null;

    // First, try to find contact by location_id and email (case insensitive)
    const contactByEmail = await db
      .select({ id: contact.id })
      .from(contact)
      .where(and(eq(contact.locationId, location_id), ilike(contact.email, email)))
      .limit(1);

    console.log('Contact by email:', contactByEmail);

    if (contactByEmail.length > 0) {
      // Redirect to the contact page
      return NextResponse.redirect(new URL(`/contacts/${contactByEmail[0].id}`, request.url));
    }

    // If not found by email, and name is provided, try by location_id, first_name, and last_name (case insensitive)
    if (first_name && last_name) {
      const contactByName = await db
        .select({ id: contact.id })
        .from(contact)
        .where(
          and(
            eq(contact.locationId, location_id),
            ilike(contact.firstName, first_name),
            ilike(contact.lastName, last_name)
          )
        )
        .limit(1);

      console.log('Contact by name:', contactByName);

      if (contactByName.length > 0) {
        // Redirect to the contact page
        return NextResponse.redirect(new URL(`/contacts/${contactByName[0].id}`, request.url));
      }
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
