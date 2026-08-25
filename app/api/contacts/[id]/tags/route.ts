import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contact, contactTags, tag } from "@/lib/db/schema";
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

    // ── DonorHQ → GHL outbound push (TAG ADD) ──────────────────────────────
    // Push this tag to GHL so the contact's tag list stays in sync. GHL
    // accepts tag NAMES (not IDs), so we fetch the name we just stored.
    let outboundSync: { mode: string; error?: string } | null = null;
    try {
      const [info] = await db
        .select({
          ghlContactId: contact.ghlContactId,
          locationId: contact.locationId,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          address: contact.address,
          tagName: tag.name,
        })
        .from(contact)
        .leftJoin(tag, eq(tag.id, tagId))
        .where(eq(contact.id, contactId))
        .limit(1);

      if (info?.locationId && info.tagName) {
        const ghl = await import("@/lib/ghl/push-contact");
        if (info.ghlContactId) {
          outboundSync = await ghl.pushContactTagAdd(
            contactId,
            info.locationId,
            info.ghlContactId,
            info.tagName,
          );
        } else if (info.email || info.phone) {
          // Contact isn't linked to GHL yet (its initial upsert timed out, was
          // queued, or lacked contact info at create). Upsert it now WITH this
          // tag — that creates/links the GHL contact, writes back ghl_contact_id,
          // and adds the tag in one call. Without this, tag sync silently
          // no-op'd forever for unlinked contacts (GS-10).
          outboundSync = await ghl.pushContactUpsert(contactId, info.locationId, {
            firstName: info.firstName,
            lastName: info.lastName,
            email: info.email,
            phone: info.phone,
            address1: info.address ?? null,
            tags: [info.tagName],
          });
        } else {
          outboundSync = { mode: "skipped_no_ghl_link_and_no_email_or_phone" };
        }
      }
    } catch (pushErr) {
      console.error(
        `[contacts.tags.POST] outbound tag-add push threw for contact ${contactId} tag ${tagId}:`,
        pushErr instanceof Error ? pushErr.message : String(pushErr),
      );
    }

    return NextResponse.json({
      message: "Tag assigned to contact successfully",
      contactId,
      tagId,
      ghlSync: outboundSync,
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

    // Capture the contact's GHL info + tag name BEFORE the delete so we
    // can push the removal to GHL after.
    const [info] = await db
      .select({
        ghlContactId: contact.ghlContactId,
        locationId: contact.locationId,
        tagName: tag.name,
      })
      .from(contact)
      .leftJoin(tag, eq(tag.id, tagId))
      .where(eq(contact.id, contactId))
      .limit(1);

    const deleted = await db
      .delete(contactTags)
      .where(and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Tag not found on contact" }, { status: 404 });
    }

    // ── DonorHQ → GHL outbound push (TAG REMOVE) ───────────────────────────
    let outboundSync: { mode: string; error?: string } | null = null;
    try {
      if (info?.ghlContactId && info.locationId && info.tagName) {
        const { pushContactTagRemove } = await import("@/lib/ghl/push-contact");
        outboundSync = await pushContactTagRemove(
          contactId,
          info.locationId,
          info.ghlContactId,
          info.tagName,
        );
      }
    } catch (pushErr) {
      console.error(
        `[contacts.tags.DELETE] outbound tag-remove push threw for contact ${contactId} tag ${tagId}:`,
        pushErr instanceof Error ? pushErr.message : String(pushErr),
      );
    }

    return NextResponse.json({
      message: "Tag removed from contact successfully",
      contactId,
      tagId,
      ghlSync: outboundSync,
    });
  } catch (error) {
    console.error("Failed to remove tag:", error);
    return NextResponse.json({ error: "Failed to remove tag" }, { status: 500 });
  }
}

