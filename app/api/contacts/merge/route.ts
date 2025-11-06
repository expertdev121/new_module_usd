import { db } from "@/lib/db";
import {
  contact,
  contactRoles,
  studentRoles,
  relationships,
  pledge,
  payment,
  manualDonation,
  solicitor,
  bonusRule,
  bonusCalculation,
  paymentAllocations,
  auditLog,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { sourceContactIds, targetContactId, displayName, email } = body;

    if (!sourceContactIds || !Array.isArray(sourceContactIds) || sourceContactIds.length === 0) {
      return NextResponse.json({ error: "Source contact IDs are required" }, { status: 400 });
    }

    if (!targetContactId || typeof targetContactId !== "number") {
      return NextResponse.json({ error: "Target contact ID is required" }, { status: 400 });
    }

    if (sourceContactIds.includes(targetContactId)) {
      return NextResponse.json({ error: "Target contact cannot be in source contacts" }, { status: 400 });
    }

    // Check if all contacts exist
    const allContactIds = [...sourceContactIds, targetContactId];
    const existingContacts = await db
      .select({ id: contact.id })
      .from(contact)
      .where(inArray(contact.id, allContactIds));

    if (existingContacts.length !== allContactIds.length) {
      return NextResponse.json({ error: "One or more contacts not found" }, { status: 404 });
    }

    // Check for conflicts: multiple solicitors
    const solicitors = await db
      .select({ contactId: solicitor.contactId })
      .from(solicitor)
      .where(inArray(solicitor.contactId, allContactIds));

    if (solicitors.length > 1) {
      return NextResponse.json({ error: "Cannot merge contacts with multiple solicitors" }, { status: 400 });
    }

    // Start transaction
    await db.transaction(async (tx) => {
      // Update target contact
      await tx
        .update(contact)
        .set({ displayName, email, updatedAt: new Date() })
        .where(eq(contact.id, targetContactId));

      // Transfer contact roles
      await tx
        .update(contactRoles)
        .set({ contactId: targetContactId })
        .where(inArray(contactRoles.contactId, sourceContactIds));

      // Transfer student roles
      await tx
        .update(studentRoles)
        .set({ contactId: targetContactId })
        .where(inArray(studentRoles.contactId, sourceContactIds));

      // Transfer relationships (both directions)
      await tx
        .update(relationships)
        .set({ contactId: targetContactId })
        .where(inArray(relationships.contactId, sourceContactIds));

      await tx
        .update(relationships)
        .set({ relatedContactId: targetContactId })
        .where(inArray(relationships.relatedContactId, sourceContactIds));

      // Transfer pledges
      await tx
        .update(pledge)
        .set({ contactId: targetContactId })
        .where(inArray(pledge.contactId, sourceContactIds));

      // Transfer payments
      await tx
        .update(payment)
        .set({ payerContactId: targetContactId })
        .where(inArray(payment.payerContactId, sourceContactIds));

      // Transfer manual donations
      await tx
        .update(manualDonation)
        .set({ contactId: targetContactId })
        .where(inArray(manualDonation.contactId, sourceContactIds));

      // Transfer solicitor if exists
      const sourceSolicitor = await tx
        .select()
        .from(solicitor)
        .where(inArray(solicitor.contactId, sourceContactIds))
        .limit(1);

      if (sourceSolicitor.length > 0) {
        await tx
          .update(solicitor)
          .set({ contactId: targetContactId })
          .where(eq(solicitor.contactId, sourceSolicitor[0].contactId));
      }

      // Transfer bonus rules
      await tx
        .update(bonusRule)
        .set({ solicitorId: targetContactId })
        .where(inArray(bonusRule.solicitorId, sourceContactIds));

      // Transfer bonus calculations
      await tx
        .update(bonusCalculation)
        .set({ solicitorId: targetContactId })
        .where(inArray(bonusCalculation.solicitorId, sourceContactIds));

      // Transfer payment allocations
      await tx
        .update(paymentAllocations)
        .set({ payerContactId: targetContactId })
        .where(inArray(paymentAllocations.payerContactId, sourceContactIds));

      // Delete source contacts
      await tx.delete(contact).where(inArray(contact.id, sourceContactIds));

      // Log the merge
      await tx.insert(auditLog).values({
        userId: session.user.id ? parseInt(session.user.id) : null,
        userEmail: session.user.email || "",
        action: "MERGE_CONTACTS",
        details: JSON.stringify({
          sourceContactIds,
          targetContactId,
          displayName,
          email,
        }),
      });
    });

    return NextResponse.json({ message: "Contacts merged successfully" });
  } catch (error) {
    console.error("Failed to merge contacts", error);
    return NextResponse.json({ error: "Failed to merge contacts" }, { status: 500 });
  }
}
