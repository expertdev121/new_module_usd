import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contact } from "@/lib/db/schema";
import { eq, and, ilike } from "drizzle-orm";

function buildContactUrl(base: URL, contactId: number, ghlContactId: string | null): URL {
  const url = new URL(`/contacts/${contactId}`, base);
  if (ghlContactId) url.searchParams.set("ghlContactId", ghlContactId);
  return url;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ location_id: string; email: string; name?: string[] }> }
) {
  try {
    const { location_id, email, name } = await params;
    const first_name = name && name.length >= 1 ? name[0] : null;
    const last_name = name && name.length >= 2 ? name[1] : null;

    const ghlContactId = request.nextUrl.searchParams.get("ghlContactId");

    const contactByEmail = await db
      .select({ id: contact.id })
      .from(contact)
      .where(and(eq(contact.locationId, location_id), ilike(contact.email, email)))
      .limit(1);

    if (contactByEmail.length > 0) {
      return NextResponse.redirect(buildContactUrl(request.nextUrl, contactByEmail[0].id, ghlContactId));
    }

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

      if (contactByName.length > 0) {
        return NextResponse.redirect(buildContactUrl(request.nextUrl, contactByName[0].id, ghlContactId));
      }
    }

    // Contact not found — redirect to contacts list with email pre-filled in search
    const notFoundUrl = new URL("/contacts", request.nextUrl);
    notFoundUrl.searchParams.set("search", email);
    return NextResponse.redirect(notFoundUrl);
  } catch (error) {
    console.error("Error finding contact:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
