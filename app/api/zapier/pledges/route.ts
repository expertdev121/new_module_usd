import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pledge } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');

    const pledges = locationId
      ? await db.select().from(pledge).where(eq(pledge.contactId, parseInt(locationId)))
      : await db.select().from(pledge);

    return NextResponse.json(pledges);
  } catch (error) {
    console.error("Error fetching pledges:", error);
    return NextResponse.json(
      { error: "Failed to fetch pledges" },
      { status: 500 }
    );
  }
}
