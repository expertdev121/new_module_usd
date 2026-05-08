import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contact, contactTags, tag } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');

    // Aggregate tag names per contact as a single comma+space-separated string,
    // ordered by tag name for stable output. Empty when the contact has no tags.
    const tagsAgg = db
      .select({
        contactId: contactTags.contactId,
        tags: sql<string>`COALESCE(STRING_AGG(${tag.name}, ', ' ORDER BY ${tag.name}), '')`.as("tags"),
      })
      .from(contactTags)
      .innerJoin(tag, eq(contactTags.tagId, tag.id))
      .groupBy(contactTags.contactId)
      .as("tagsAgg");

    const baseQuery = db
      .select({
        contact: contact,
        tags: sql<string>`COALESCE(${tagsAgg.tags}, '')`.as("tags"),
      })
      .from(contact)
      .leftJoin(tagsAgg, eq(tagsAgg.contactId, contact.id));

    const rows = locationId
      ? await baseQuery.where(eq(contact.locationId, locationId))
      : await baseQuery;

    // Order matters: object key insertion order drives column order in the CSV/XLSX
    // export. Put ghlContactId first (with "-" placeholder when empty/null), then the
    // rest of the contact fields, then tags last.
    const contacts = rows.map((row) => {
      const { ghlContactId, ...rest } = row.contact;
      return {
        ghlContactId: ghlContactId && ghlContactId.trim() !== "" ? ghlContactId : "-",
        ...rest,
        tags: row.tags,
      };
    });

    return NextResponse.json(contacts);
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 }
    );
  }
}
