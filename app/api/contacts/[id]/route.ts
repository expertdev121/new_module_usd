import { db } from "@/lib/db";
import { contact, pledge, manualDonation, contactRoles, studentRoles, category, payment } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

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
    const [contactData] = await db
      .select({
        contact: {
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          displayName: contact.displayName,
          email: contact.email,
          phone: contact.phone,
          title: contact.title,
          gender: contact.gender,
          address: contact.address,
          createdAt: contact.createdAt,
          updatedAt: contact.updatedAt,
          fullName: sql<string>`concat(${contact.firstName}, ' ', ${contact.lastName})`.as('fullName'),
        },
        contactRoles: sql<unknown[]>`COALESCE(
          (SELECT ARRAY_AGG(row_to_json(${contactRoles}))
           FROM ${contactRoles}
           WHERE ${contactRoles.contactId} = ${contact.id}
           LIMIT ${limit} OFFSET ${offset}),
          '{}'
        )`.as("contactRoles"),
        studentRoles: sql<unknown[]>`COALESCE(
          (SELECT ARRAY_AGG(row_to_json(${studentRoles}))
           FROM ${studentRoles}
           WHERE ${studentRoles.contactId} = ${contact.id}
           LIMIT ${limit} OFFSET ${offset}),
          '{}'
        )`.as("studentRoles"),
      })
      .from(contact)
      .where(eq(contact.id, contactId))
      .limit(1);

    if (!contactData) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    // Calculate overall financial summary (not per category)
    const [pledgeSummary] = await db
      .select({
        totalPledgedUsd: sql<number>`COALESCE(SUM(${pledge.originalAmountUsd}), 0)`,
        currentBalanceUsd: sql<number>`COALESCE(SUM(${pledge.balanceUsd}), 0)`,
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
      })
      .from(manualDonation)
      .where(eq(manualDonation.contactId, contactId));

    const overallSummary = {
      totalPledgedUsd: pledgeSummary.totalPledgedUsd,
      totalPaidUsd: paymentSummary.totalPaidUsd,
      totalManualDonationsUsd: manualDonationSummary.totalManualDonationsUsd,
      currentBalanceUsd: pledgeSummary.currentBalanceUsd,
    };

    // For backward compatibility, create a single-item array with overall totals
    const financialSummary = [{
      categoryId: null,
      categoryName: null,
      totalPledgedUsd: overallSummary.totalPledgedUsd,
      totalPaidUsd: overallSummary.totalPaidUsd,
      totalManualDonationsUsd: overallSummary.totalManualDonationsUsd,
      currentBalanceUsd: overallSummary.currentBalanceUsd,
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
        ...contactData.contact,
        contactRoles: contactData.contactRoles,
        studentRoles: contactData.studentRoles,
      },
      financialSummary: financialSummary || [],
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contactId = parseInt(id, 10);

  if (isNaN(contactId) || contactId <= 0) {
    return NextResponse.json({ error: "Invalid contact ID" }, { status: 400 });
  }

  try {
    const body = await request.json();

    // Validate required fields
    const { firstName, lastName, email, phone, title, gender, address } = body;

    if (!firstName || !lastName || !email) {
      return NextResponse.json(
        { error: "First name, last name, and email are required" },
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
      email,
      updatedAt: new Date(),
    };

    if (phone !== undefined) updateData.phone = phone;
    if (title !== undefined) updateData.title = title;
    if (gender !== undefined) updateData.gender = gender;
    if (address !== undefined) updateData.address = address;

    const [updatedContact] = await db
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

    return NextResponse.json({
      message: "Contact updated successfully",
      contact: updatedContact,
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

    // Get contact details for response
    const contactDetails = await db
      .select({
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.displayName,
      })
      .from(contact)
      .where(eq(contact.id, contactId))
      .limit(1);

    const contactInfo = contactDetails[0];

    // Delete the contact (CASCADE will handle related records)
    await db.delete(contact).where(eq(contact.id, contactId));

    return NextResponse.json({
      message: "Contact deleted successfully",
      deletedContact: {
        id: contactId,
        name: contactInfo.displayName || `${contactInfo.firstName} ${contactInfo.lastName}`,
      },
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
