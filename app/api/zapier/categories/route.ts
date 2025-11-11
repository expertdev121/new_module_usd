import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { category } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');

    const categories = locationId
      ? await db.select().from(category).where(eq(category.locationId, locationId))
      : await db.select().from(category);

    return NextResponse.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    return NextResponse.json(
      { error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}
