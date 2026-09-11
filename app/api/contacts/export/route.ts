/**
 * GET /api/contacts/export
 *
 * Tag-filtered contacts CSV export for mailings / appeals (Sarah/YLA request).
 * Pass `tagId` to get every contact carrying that tag (regardless of giving),
 * with their mailing address — the list a nonprofit needs for an annual mail
 * appeal. Without `tagId` it exports all of the location's contacts.
 *
 * Admin-only, scoped to the admin's own location. Soft-deleted contacts are
 * excluded so they never leak into a mailing.
 *
 * NOTE: `contact.address` is a single free-text column — there are no separate
 * city/state/zip columns and no organization column on `contact` — so the CSV
 * emits name, title, email(s), phone, that one address string, and the tags.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, and, or, isNotNull, sql, type SQL } from "drizzle-orm";
import { contact, tag, user } from "@/lib/db/schema";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stringify } from "csv-stringify/sync";

const querySchema = z.object({
  tagId: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      tagId: searchParams.get("tagId") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { tagId, search } = parsed.data;

    // Resolve the caller's role + location (mirrors contacts-donations CSV route).
    const userDetails = await db
      .select({ role: user.role, locationId: user.locationId })
      .from(user)
      .where(eq(user.email, session.user.email))
      .limit(1);

    if (userDetails.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentUser = userDetails[0];
    const isAdmin = currentUser.role === "admin" || currentUser.role === "super_admin";
    if (!isAdmin || !currentUser.locationId) {
      return NextResponse.json(
        { error: "Forbidden: admin access with a location is required" },
        { status: 403 }
      );
    }

    const whereConditions: SQL[] = [
      eq(contact.locationId, currentUser.locationId),
      isNotNull(contact.locationId),
      // Never export soft-deleted contacts into a mailing list. `deleted_at`
      // exists in the DB but isn't mapped in the Drizzle schema, so reference
      // the raw column (same approach as app/api/contacts/route.ts).
      sql`contact.deleted_at IS NULL`,
    ];

    // Filter to a specific tag via a correlated EXISTS on contact_tags.
    let tagName: string | null = null;
    if (tagId) {
      const tagRow = await db
        .select({ id: tag.id, name: tag.name })
        .from(tag)
        .where(and(eq(tag.id, tagId), eq(tag.locationId, currentUser.locationId)))
        .limit(1);
      if (tagRow.length === 0) {
        return NextResponse.json(
          { error: "Tag not found for this account" },
          { status: 404 }
        );
      }
      tagName = tagRow[0].name;
      whereConditions.push(
        sql`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = ${contact.id} AND ct.tag_id = ${tagId})`
      );
    }

    const normalizedSearch = search?.trim().toLowerCase();
    if (normalizedSearch) {
      const s = `%${normalizedSearch}%`;
      whereConditions.push(
        or(
          sql`lower(${contact.firstName}) like ${s}`,
          sql`lower(${contact.lastName}) like ${s}`,
          sql`lower(${contact.displayName}) like ${s}`,
          sql`lower(${contact.email}) like ${s}`,
          sql`lower(${contact.phone}) like ${s}`,
          sql`lower(${contact.address}) like ${s}`
        ) as SQL
      );
    }

    const rows = await db
      .select({
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.displayName,
        title: contact.title,
        email: contact.email,
        email2: contact.email2,
        phone: contact.phone,
        address: contact.address,
        tags: sql<string>`COALESCE((
          SELECT string_agg(t.name, ', ' ORDER BY t.name)
          FROM contact_tags ct JOIN tag t ON t.id = ct.tag_id
          WHERE ct.contact_id = ${contact.id}
        ), '')`.as("tags"),
      })
      .from(contact)
      .where(and(...whereConditions))
      .orderBy(sql`${contact.lastName} ASC NULLS LAST`, sql`${contact.firstName} ASC NULLS LAST`);

    const csvData = rows.map((r) => ({
      "First Name": r.firstName ?? "",
      "Last Name": r.lastName ?? "",
      "Display Name": r.displayName ?? "",
      Title: r.title ?? "",
      Email: r.email ?? "",
      "Email 2": r.email2 ?? "",
      "Phone Number": r.phone ?? "",
      Address: r.address ?? "",
      Tags: r.tags ?? "",
    }));

    const csv = stringify(csvData, { header: true });

    const slug = (tagName ?? "all")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "all";
    const filename = `contacts-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error generating contacts export CSV:", error);
    return NextResponse.json(
      {
        error: "Failed to generate CSV",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
