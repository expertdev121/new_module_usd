import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contactTags, tag } from "@/lib/db/schema";
import { eq , and} from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const contactId = parseInt(id, 10);
    if (isNaN(contactId) || contactId <= 0) {
      return NextResponse.json({ error: "Invalid contact ID" }, { status: 400 });
    }

    const body = await request.json();
    const { tagId } = body;

    if (!tagId || isNaN(tagId) || tagId <= 0) {
      return NextResponse.json({ error: "Valid tagId is required" }, { status: 400 });
    }

    // Check if tag exists
    const tagExists = await db
      .select({ id: tag.id })
      .from(tag)
      .where(eq(tag.id, tagId))
      .limit(1);

    if (tagExists.length === 0) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    // Check if already exists
    const existingTag = await db
      .select({ id: contactTags.id })
      .from(contactTags)
      .where(and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)))
      .limit(1);

    if (existingTag.length > 0) {
      return NextResponse.json({ error: "Tag already assigned to contact" }, { status: 409 });
    }

    await db.insert(contactTags).values({
      contactId,
      tagId,
    });

    return NextResponse.json({ 
      message: "Tag assigned to contact successfully",
      contactId,
      tagId 
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to assign tag:", error);
    return NextResponse.json({ error: "Failed to assign tag" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const contactId = parseInt(id, 10);
    if (isNaN(contactId) || contactId <= 0) {
      return NextResponse.json({ error: "Invalid contact ID" }, { status: 400 });
    }

    const body = await request.json();
    const { tagId } = body;

    if (!tagId || isNaN(tagId) || tagId <= 0) {
      return NextResponse.json({ error: "Valid tagId is required" }, { status: 400 });
    }

    const deleted = await db
      .delete(contactTags)
      .where(and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Tag not found on contact" }, { status: 404 });
    }

    return NextResponse.json({ 
      message: "Tag removed from contact successfully",
      contactId,
      tagId 
    });
  } catch (error) {
    console.error("Failed to remove tag:", error);
    return NextResponse.json({ error: "Failed to remove tag" }, { status: 500 });
  }
}

