import { db } from "@/lib/db";
import { contact, pledge, manualDonation, contactRoles, studentRoles, category, payment, contactTags, tag } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contactId = parseInt(id, 10);
  if (isNaN(contactId) || contactId <= 0) {
    return NextResponse.json({ error: "Invalid contact ID" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "10", 10);
  const offset = (page - 1) * limit;

  try {
    // Main contact data (simple query, no subqueries)
    // Return the structured address columns (added by migration 0019)
    // alongside the legacy single `address` field. We use raw SQL for the
    // new columns to avoid having to touch the canonical schema.ts.
    const [contactData] = await db
      .select({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.displayName,
        email: contact.email,
        phone: contact.phone,
        title: contact.title,
        gender: contact.gender,
        address: contact.address,
        // Structured address fields populated by the GHL sync enrichment.
        address1: sql<string | null>`"contact"."address1"`.as("address1"),
        city: sql<string | null>`"contact"."city"`.as("city"),
        state: sql<string | null>`"contact"."state"`.as("state"),
        postalCode: sql<string | null>`"contact"."postal_code"`.as("postal_code"),
        country: sql<string | null>`"contact"."country"`.as("country"),
        organization: sql<string | null>`"contact"."organization"`.as("organization"),
        dateOfBirth: sql<string | null>`"contact"."date_of_birth"::text`.as("date_of_birth"),
        doNotContact: sql<boolean | null>`"contact"."do_not_contact"`.as("do_not_contact"),
        // Household support (only populated when tenant is in household mode).
        householdId: sql<number | null>`"contact"."household_id"`.as("household_id"),
        isPrimaryContact: sql<boolean | null>`"contact"."is_primary_contact"`.as("is_primary_contact"),
        relationship: sql<string | null>`"contact"."relationship"`.as("relationship"),
        householdName: sql<string | null>`(SELECT h.display_name FROM household h WHERE h.id = "contact"."household_id")`.as("household_name"),
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
      })
      .from(contact)
      .where(sql`${contact.id} = ${contactId} AND "contact"."deleted_at" IS NULL`)
      .limit(1);

    if (!contactData) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    // Fetch related data separately (safe Drizzle queries)
    const contactRolesData = await db
      .select()
      .from(contactRoles)
      .where(eq(contactRoles.contactId, contactId))
      .limit(100);  // Safe high limit for single contact

    const studentRolesData = await db
      .select()
      .from(studentRoles)
      .where(eq(studentRoles.contactId, contactId))
      .limit(100);

    const tagsData = await db
      .select({ id: tag.id, name: tag.name })
      .from(contactTags)
      .innerJoin(tag, eq(contactTags.tagId, tag.id))
      .where(eq(contactTags.contactId, contactId));

    // Compute fullName in JS
    const fullName = `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim();

    // Calculate overall financial summary with currency
    const [pledgeSummary] = await db
      .select({
        totalPledgedUsd: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)`,
        currentBalanceUsd: sql<number>`COALESCE(SUM(${pledge.balanceUsd}), 0)`,
        currency: sql<string>`(
          SELECT ${pledge.currency} 
          FROM ${pledge} 
          WHERE ${pledge.contactId} = ${contactId} 
          LIMIT 1
        )`,
      })
      .from(pledge)
      .where(eq(pledge.contactId, contactId));

    const [paymentSummary] = await db
      .select({
        totalPaidUsd: sql<number>`COALESCE(SUM(${payment.amountUsd}), 0)`,
      })
      .from(payment)
      .leftJoin(pledge, eq(payment.pledgeId, pledge.id))
      .where(eq(pledge.contactId, contactId));

    const [manualDonationSummary] = await db
      .select({
        totalManualDonationsUsd: sql<number>`COALESCE(SUM(${manualDonation.amountUsd}), 0)`,
        manualDonationCurrency: sql<string>`(
          SELECT ${manualDonation.currency} 
          FROM ${manualDonation} 
          WHERE ${manualDonation.contactId} = ${contactId} 
          LIMIT 1
        )`,
      })
      .from(manualDonation)
      .where(eq(manualDonation.contactId, contactId));

    // Log for debugging
    console.log('Contact ID:', contactId);
    console.log('Contact Roles count:', contactRolesData.length);
    console.log('Student Roles count:', studentRolesData.length);
    console.log('Tags count:', tagsData.length);

    const overallSummary = {
      totalPledgedUsd: pledgeSummary?.totalPledgedUsd || 0,
      totalPaidUsd: paymentSummary?.totalPaidUsd || 0,
      totalManualDonationsUsd: manualDonationSummary?.totalManualDonationsUsd || 0,
      currentBalanceUsd: (pledgeSummary?.totalPledgedUsd || 0) - (paymentSummary?.totalPaidUsd || 0),
      currency: pledgeSummary?.currency || manualDonationSummary?.manualDonationCurrency || 'USD',
    };

    const financialSummary = [{
      categoryId: null,
      categoryName: null,
      totalPledgedUsd: overallSummary.totalPledgedUsd,
      totalPaidUsd: overallSummary.totalPaidUsd,
      totalManualDonationsUsd: overallSummary.totalManualDonationsUsd,
      currentBalanceUsd: overallSummary.currentBalanceUsd,
      currency: overallSummary.currency,
    }];

    const [roleCounts] = await db
      .select({
        totalContactRoles: sql<number>`COUNT(*)`.as("totalContactRoles"),
        totalStudentRoles: sql<number>`COUNT(*)`.as("totalStudentRoles"),
      })
      .from(contactRoles)
      .where(eq(contactRoles.contactId, contactId))
      .fullJoin(studentRoles, eq(studentRoles.contactId, contactId));

    const responseData = {
      contact: {
        ...contactData,
        fullName,
        contactRoles: contactRolesData,
        studentRoles: studentRolesData,
        tags: tagsData,
      },
      financialSummary: financialSummary,
      pagination: {
        page,
        limit,
        totalContactRoles: roleCounts?.totalContactRoles || 0,
        totalStudentRoles: roleCounts?.totalStudentRoles || 0,
      },
    };

    return NextResponse.json(responseData, {
      status: 200,
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (error) {
    console.error("Failed to fetch contact", {
      contactId,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Failed to fetch contact" },
      { status: 500 }
    );
  }
}

// PUT and DELETE handlers unchanged
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contactId = parseInt(id, 10);

  console.log("PUT /api/contacts/[id] called with contactId:", contactId);

  if (isNaN(contactId) || contactId <= 0) {
    return NextResponse.json({ error: "Invalid contact ID" }, { status: 400 });
  }

  try {
    const body = await request.json();
    console.log("Request body:", body);

    // Validate required fields - now using firstName and lastName directly
    const { firstName, lastName, displayName, email, phone, gender, address } = body;

    if (!firstName) {
      return NextResponse.json(
        { error: "First name is required" },
        { status: 400 }
      );
    }

    if (!lastName) {
      return NextResponse.json(
        { error: "Last name is required" },
        { status: 400 }
      );
    }

    // Check if contact exists
    const existingContact = await db
      .select({ id: contact.id })
      .from(contact)
      .where(eq(contact.id, contactId))
      .limit(1);

    if (existingContact.length === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    // Update the contact
    const updateData: Record<string, string | Date | null> = {
      firstName,
      lastName,
      displayName: displayName || null,
      email,
      updatedAt: new Date(),
    };

    if (phone !== undefined) updateData.phone = phone;
    if (gender !== undefined) updateData.gender = gender;
    if (address !== undefined) updateData.address = address;

    // Capture old contact data BEFORE update
    const oldContact = await db
      .select({
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.displayName,
        email: contact.email,
        phone: contact.phone,
        gender: contact.gender,
        address: contact.address,
      })
      .from(contact)
      .where(eq(contact.id, contactId))
      .limit(1);

    const oldData = oldContact[0];

    const updatedContactResult = await db
      .update(contact)
      .set(updateData)
      .where(eq(contact.id, contactId))
      .returning({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.displayName,
        email: contact.email,
        phone: contact.phone,
        title: contact.title,
        gender: contact.gender,
        address: contact.address,
        updatedAt: contact.updatedAt,
      });

    const updatedContact = updatedContactResult[0];

    // ── DonorHQ → GHL outbound push (UPDATE) ────────────────────────────────
    // If this contact has a ghlContactId, propagate the edits to GHL. If
    // not, run an upsert — GHL will dedup on email/phone and link to an
    // existing row OR create a new one.
    const session = await getServerSession(authOptions);
    const sessionLocationId = session?.user?.locationId ?? null;
    let outboundSync: { mode: string; ghlContactId?: string; error?: string } | null = null;
    if (sessionLocationId) {
      try {
        // Fetch the existing ghlContactId (not in the returning() above).
        const existing = await db
          .select({ ghlContactId: contact.ghlContactId })
          .from(contact)
          .where(eq(contact.id, contactId))
          .limit(1);
        const existingGhlContactId = existing[0]?.ghlContactId ?? null;

        // Upsert needs at least email or phone for GHL's dedup. If both are
        // missing AND we have no existingGhlContactId, GHL would refuse —
        // skip in that case.
        if (existingGhlContactId || updatedContact.email || updatedContact.phone) {
          const { pushContactUpsert } = await import("@/lib/ghl/push-contact");
          outboundSync = await pushContactUpsert(
            contactId,
            sessionLocationId,
            {
              firstName: updatedContact.firstName,
              lastName: updatedContact.lastName,
              email: updatedContact.email,
              phone: updatedContact.phone,
              address1: updatedContact.address ?? null,
              existingGhlContactId,
            },
          );
        }
      } catch (pushErr) {
        console.error(
          `[contacts.PUT] outbound GHL push threw for contact ${contactId}:`,
          pushErr instanceof Error ? pushErr.message : String(pushErr),
        );
      }
    }

    // Detailed audit with old/new values
    const changedFields = Object.keys(updateData).filter(key => {
      const oldVal = oldData[key as keyof typeof oldData];
      const newVal = updatedContact[key as keyof typeof updatedContact];
      return String(oldVal) !== String(newVal);
    });

    const changes = changedFields.map(field => ({
      field,
      old: oldData[field as keyof typeof oldData],
      new: updatedContact[field as keyof typeof updatedContact]
    }));

    await import("@/lib/audit").then(({ logAudit }) => 
      logAudit("contact_update", {
        contactId,
        contactName: `${firstName} ${lastName}`,
        oldValues: oldData,
        newValues: updatedContact,
        changedFields: changes
      })
    );
    
    return NextResponse.json({
      message: "Contact updated successfully",
      contact: updatedContact,
      ghlSync: outboundSync,
    });
  } catch (error) {
    console.error("Failed to update contact", {
      contactId,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Failed to update contact" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contactId = parseInt(id, 10);

  if (isNaN(contactId) || contactId <= 0) {
    return NextResponse.json({ error: "Invalid contact ID" }, { status: 400 });
  }

  try {
    // Check if contact exists
    const existingContact = await db
      .select({ id: contact.id })
      .from(contact)
      .where(eq(contact.id, contactId))
      .limit(1);

    if (existingContact.length === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    // Get contact details for response + GHL sync metadata.
    const contactDetails = await db
      .select({
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.displayName,
        ghlContactId: contact.ghlContactId,
        locationId: contact.locationId,
      })
      .from(contact)
      .where(eq(contact.id, contactId))
      .limit(1);

    const contactInfo = contactDetails[0];

    // ── DonorHQ → GHL outbound push (DELETE) ────────────────────────────────
    // User opted into hard-delete: the contact is removed from BOTH systems.
    // We push to GHL BEFORE deleting locally so that if GHL fails (e.g.
    // 404 → already gone), we still proceed. Genuine errors fall back to
    // the queue and we still delete locally — the cron worker will retry
    // the GHL delete asynchronously.
    let outboundSync: { mode: string; error?: string } | null = null;
    if (contactInfo.ghlContactId && contactInfo.locationId) {
      try {
        const { pushContactDelete } = await import("@/lib/ghl/push-contact");
        outboundSync = await pushContactDelete(
          contactId,
          contactInfo.locationId,
          contactInfo.ghlContactId,
        );
      } catch (pushErr) {
        // Don't block the DonorHQ delete on GHL failure.
        console.error(
          `[contacts.DELETE] outbound GHL delete threw for contact ${contactId}:`,
          pushErr instanceof Error ? pushErr.message : String(pushErr),
        );
      }
    }

    // Delete the contact (CASCADE will handle related records)
    await db.delete(contact).where(eq(contact.id, contactId));
    
    // Detailed audit with contact snapshot
    await import("@/lib/audit").then(({ logAudit }) => 
      logAudit("contact_delete", {
        contactId,
        contactName: contactInfo.displayName || `${contactInfo.firstName} ${contactInfo.lastName}`,
        contactData: contactInfo
      })
    );
    
    return NextResponse.json({
      message: "Contact deleted successfully",
      deletedContact: {
        id: contactId,
        name: contactInfo.displayName || `${contactInfo.firstName} ${contactInfo.lastName}`,
      },
      ghlSync: outboundSync,
    });
  } catch (error) {
    console.error("Failed to delete contact", {
      contactId,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Failed to delete contact" },
      { status: 500 }
    );
  }
}

