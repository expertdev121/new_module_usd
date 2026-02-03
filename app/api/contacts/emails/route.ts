import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contact, payment, manualDonation } from "@/lib/db/schema";
import { eq, and, gte, lt, isNotNull, ne, or } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const locationId = searchParams.get("locationId");

    if (!year) {
      return NextResponse.json(
        { error: "Year parameter is required" },
        { status: 400 }
      );
    }

    const yearNum = parseInt(year);
    if (isNaN(yearNum)) {
      return NextResponse.json(
        { error: "Invalid year parameter" },
        { status: 400 }
      );
    }

    // Get start and end dates for the year
    const startDate = new Date(yearNum, 0, 1); // January 1st
    const endDate = new Date(yearNum + 1, 0, 1); // January 1st of next year

    // First, get contacts with payments in the year
    const contactsWithPayments = await db
      .selectDistinct({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.displayName,
        email: contact.email,
        phone: contact.phone,
        address: contact.address,
      })
      .from(contact)
      .innerJoin(payment, eq(contact.id, payment.payerContactId))
      .where(
        and(
          isNotNull(contact.email),
          ne(contact.email, ""),
          locationId ? eq(contact.locationId, locationId) : undefined,
          gte(payment.receivedDate, startDate.toISOString().split('T')[0]),
          lt(payment.receivedDate, endDate.toISOString().split('T')[0])
        )
      );

    // Then, get contacts with manual donations in the year
    const contactsWithDonations = await db
      .selectDistinct({
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        displayName: contact.displayName,
        email: contact.email,
        phone: contact.phone,
        address: contact.address,
      })
      .from(contact)
      .innerJoin(manualDonation, eq(contact.id, manualDonation.contactId))
      .where(
        and(
          isNotNull(contact.email),
          ne(contact.email, ""),
          locationId ? eq(contact.locationId, locationId) : undefined,
          gte(manualDonation.receivedDate, startDate.toISOString().split('T')[0]),
          lt(manualDonation.receivedDate, endDate.toISOString().split('T')[0])
        )
      );

    // Combine and deduplicate contacts
    const contactMap = new Map();
    [...contactsWithPayments, ...contactsWithDonations].forEach(c => {
      contactMap.set(c.id, c);
    });
    const contactsWithEmails = Array.from(contactMap.values()).sort((a, b) =>
      (a.displayName || `${a.firstName} ${a.lastName}`).localeCompare(b.displayName || `${b.firstName} ${b.lastName}`)
    );

    return NextResponse.json({
      contacts: contactsWithEmails,
      year: yearNum,
    });
  } catch (error) {
    console.error("Error fetching contacts with emails:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
