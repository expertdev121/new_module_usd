  import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contact, payment, pledge, manualDonation } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get('locationId');

    // Build the base query for contacts
    const contacts = await (locationId
      ? db.select().from(contact).where(eq(contact.locationId, locationId))
      : db.select().from(contact));

    // For each contact, fetch their payments, pledges, and manual donations
    const contactsWithData = await Promise.all(
      contacts.map(async (contact) => {
        // Fetch payments for this contact
        const paymentsQuery = db.select().from(payment).where(eq(payment.payerContactId, contact.id));
        if (locationId) {
          // Note: payment table doesn't have locationId, so we rely on contact filtering
        }
        const payments = await paymentsQuery;

        // Fetch pledges for this contact
        const pledgesQuery = db.select().from(pledge).where(eq(pledge.contactId, contact.id));
        if (locationId) {
          // Note: pledge table doesn't have locationId, so we rely on contact filtering
        }
        const pledges = await pledgesQuery;

        // Fetch manual donations for this contact
        const manualDonationsQuery = db.select().from(manualDonation).where(eq(manualDonation.contactId, contact.id));
        if (locationId) {
          // Note: manualDonation table doesn't have locationId, so we rely on contact filtering
        }
        const manualDonations = await manualDonationsQuery;

        return {
          ...contact,
          payments,
          pledges,
          manualDonations,
        };
      })
    );

    return NextResponse.json(contactsWithData);
  } catch (error) {
    console.error("Error fetching contacts with data:", error);
    return NextResponse.json(
      { error: "Failed to fetch contacts with data" },
      { status: 500 }
    );
  }
}
