import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { solicitor } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');

    const solicitors = locationId
      ? await db.select().from(solicitor).where(eq(solicitor.locationId, locationId))
      : await db.select().from(solicitor);

    return NextResponse.json(solicitors);
  } catch (error) {
    console.error("Error fetching solicitors:", error);
    return NextResponse.json(
      { error: "Failed to fetch solicitors" },
      { status: 500 }
    );
  }
}
