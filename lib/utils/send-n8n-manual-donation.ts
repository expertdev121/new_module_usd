import { db } from "@/lib/db";
import { manualDonation, contact } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const N8N_WEBHOOK_URL = "https://givesuite.app.n8n.cloud/webhook-test/965ac5cc-628c-4d40-9698-a6fe9698777c";
const TARGET_LOCATION_ID = "NikJ6tAcHSe8UCLgYMqM";

export async function sendN8nManualDonationWebhook(donationId: number): Promise<void> {
  try {
    // Fetch donation + contact details (single query)
    const donationWithContact = await db
      .select({
        // Full manual_donation record
        donation: manualDonation,
        // Contact essentials
        contactFirstName: contact.firstName,
        contactLastName: contact.lastName,
        contactEmail: contact.email,
        contactEmail2: contact.email2,
        contactPhone: contact.phone,
        contactLocationId: contact.locationId,
      })
      .from(manualDonation)
      .leftJoin(contact, eq(manualDonation.contactId, contact.id))
      .where(eq(manualDonation.id, donationId))
      .limit(1);

    const result = donationWithContact[0];
    if (!result) {
      console.error(`[n8n-webhook] Donation ${donationId} not found`);
      return;
    }

    // Extract contact data safely
    const contactData = {
      contactFirstName: result.contactFirstName || '',
      contactLastName: result.contactLastName || '',
      contactEmail: result.contactEmail || null,
      contactEmail2: result.contactEmail2 || null,
      contactPhone: result.contactPhone || null,
      contactLocationId: result.contactLocationId,
    };
    
    // CRITICAL: Filter - only send for target location
    if (contactData.contactLocationId !== TARGET_LOCATION_ID) {
      console.log(`[n8n-webhook] Skipped donation ${donationId} - location ${contactData.contactLocationId} ≠ ${TARGET_LOCATION_ID}`);
      return;
    }

    const payload = {
      contact: {
        id: result.donation.contactId,
        firstName: contactData.contactFirstName,
        lastName: contactData.contactLastName,
        fullName: `${contactData.contactFirstName || ''} ${contactData.contactLastName || ''}`.trim() || 'Unknown',
        email: contactData.contactEmail || null,
        email2: contactData.contactEmail2 || null,
        phone: contactData.contactPhone || null,
        locationId: contactData.contactLocationId,
        locationName: 'Benchmark Adventure Ministries', // Hardcoded based on schema refs
      },
      manualDonation: {
        ...result.donation,
        // Add computed full contact name for convenience
        contactFullName: `${contactData.contactFirstName || ''} ${contactData.contactLastName || ''}`.trim() || 'Unknown',
      },
      timestamp: new Date().toISOString(),
      source: 'givesuite-pro-usd-module',
    };

    console.log(`[n8n-webhook] Sending donation ${donationId} for ${contactData.contactLocationId}...`);

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    console.log(`[n8n-webhook] ✅ Donation ${donationId} sent successfully`);

  } catch (error) {
    console.error(`[n8n-webhook] ❌ Failed donation ${donationId}:`, error);
    // Fire-and-forget: don't throw, don't block donation creation
  }
}

