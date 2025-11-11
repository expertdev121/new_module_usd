import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contact } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');

    const contacts = locationId
      ? await db.select().from(contact).where(eq(contact.locationId, locationId))
      : await db.select().from(contact);

    return NextResponse.json(contacts);
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 }
    );
  }
}
