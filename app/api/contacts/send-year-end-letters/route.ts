import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, or, and, gte, lte, sql } from "drizzle-orm";
import { payment, manualDonation, pledge, contact, campaign } from "@/lib/db/schema";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";   
import jsPDF from "jspdf";

const WEBHOOK_URL = "https://services.leadconnectorhq.com/hooks/0lb5xbd0qHmaEqPUPc2N/webhook-trigger/QHiy8MCxY3zerF5k9WYE";

// Hardcoded subaccount data based on location ID
const SUBACCOUNT_DATA: Record<string, { subaccountName: string; subaccountEmail: string }> = {
  'asI8eHkRqF8RpX1VXhHz': { subaccountName: 'All About Kindness', subaccountEmail: 'info@allaboutkindness.org' },
  '4Nzcp3vUgVbOoN9uxu5F': { subaccountName: 'Church Missions Network', subaccountEmail: 'church@subaccount.com' },
  'g9JSoJ1FInnA6N0SHXi7': { subaccountName: 'Chabad of North Ranch', subaccountEmail: 'rabbishlomo@gmail.com' },
  'KVgMIrEYRkKRcfeicJBm': { subaccountName: 'Just One Life', subaccountEmail: 'ari@justonelife.org' },
  'E7yO96aiKmYvsbU2tRzc': { subaccountName: 'Texas Torah Institute', subaccountEmail: 'texas@subaccount.com' },
  'sfhxVFajQpL7HedtX5NK': { subaccountName: 'Orlando Community Kollel', subaccountEmail: 'oberlin@subaccount.com' },
  'Y8UfZOiGu6H9qh04FebD': { subaccountName: 'Keren Efrat', subaccountEmail: 'kf@subaccount.com' },
  'dGBms4fIfi6WTZbCJeHR': { subaccountName: 'Kentucky Torah Day School', subaccountEmail: 'kentucky@subaccount.com' },
  'NikJ6tAcHSe8UCLgYMqM': { subaccountName: 'Benchmark Adventure Ministries', subaccountEmail: 'office@benchmark.org' },
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { contactIds, year, charityName, charityAddress, taxId, logoLink, customNote, signatureName } = body;
    console.log('Received request body:', { contactIds, year, charityName, charityAddress, taxId, logoLink, customNote, signatureName });

    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return NextResponse.json({ error: "Contact IDs are required" }, { status: 400 });
    }

    if (!year || isNaN(parseInt(year))) {
      return NextResponse.json({ error: "Valid year is required" }, { status: 400 });
    }

    const yearNum = parseInt(year);
    const startDateStr = `${yearNum}-01-01`;
    const endDateStr = `${yearNum}-12-31`;

    const results = [];

    for (const contactId of contactIds) {
      try {
        // Get contact details
        const contactData = await db
          .select({
            id: contact.id,
            firstName: contact.firstName,
            lastName: contact.lastName,
            displayName: contact.displayName,
            email: contact.email,
            address: contact.address,
            locationId: contact.locationId,
          })
          .from(contact)
          .where(eq(contact.id, contactId))
          .limit(1);

        if (contactData.length === 0) {
          results.push({ contactId, success: false, error: "Contact not found" });
          continue;
        }

        const contactInfo = contactData[0];
        const contactName = contactInfo.displayName || `${contactInfo.firstName} ${contactInfo.lastName}`;
        const firstName = contactInfo.firstName || 'Donor';

        // Fetch payments for the year
        const paymentsData = await db
          .select({
            id: payment.id,
            date: payment.receivedDate,
            amount: payment.amountUsd,
            description: sql<string>`COALESCE(${pledge.campaignCode}, 'donation')`,
          })
          .from(payment)
          .leftJoin(pledge, eq(payment.pledgeId, pledge.id))
          .where(
            and(
              or(
                eq(pledge.contactId, contactId),
                eq(payment.payerContactId, contactId)
              ),
              gte(payment.receivedDate, startDateStr),
              lte(payment.receivedDate, endDateStr)
            )
          )
          .orderBy(payment.receivedDate);

        // Fetch manual donations for the year
        const donationsData = await db
          .select({
            id: manualDonation.id,
            date: manualDonation.receivedDate,
            amount: manualDonation.amountUsd,
            description: sql<string>`COALESCE(${campaign.name}, 'donation')`,
          })
          .from(manualDonation)
          .leftJoin(campaign, eq(manualDonation.campaignId, campaign.id))
          .where(
            and(
              eq(manualDonation.contactId, contactId),
              gte(manualDonation.receivedDate, startDateStr),
              lte(manualDonation.receivedDate, endDateStr)
            )
          )
          .orderBy(manualDonation.receivedDate);

        // Combine and sort all transactions
        const allTransactions = [...paymentsData, ...donationsData]
          .sort((a, b) => {
            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            return dateA - dateB;
          });

        // Calculate total amount
        const totalAmount = allTransactions.reduce((sum, transaction) => {
          return sum + parseFloat(transaction.amount?.toString() || "0");
        }, 0);

        // Generate PDF URL using the new API route
        const filename = `year-end-letter-${contactId}-${yearNum}-${Date.now()}.pdf`;
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://new-module-usd.vercel.app/';
        // Get subaccount data based on location ID (moved up for PDF params)
        const subaccountInfo = SUBACCOUNT_DATA[contactInfo.locationId || ''] || {
          subaccountName: 'Default Subaccount',
          subaccountEmail: 'default@subaccount.com'
        };
 
        // Dynamic PDF URL with all params
        const urlParams = new URLSearchParams({
          charityName: charityName || "ABC Charity",
          charityAddress: charityAddress || "1234 Main Street, Anytown, USA",
          taxId: taxId || "12-3456789",
          customNote: customNote || "Your generosity throughout the year helped over 100 children in need. Thank you for making a difference in our community!",
          signatureName: signatureName || "Executive Director",
          subaccountName: subaccountInfo.subaccountName,
          subaccountEmail: subaccountInfo.subaccountEmail
        });
        if (logoLink) {
          urlParams.append('logoLink', logoLink);
        }
        const pdfUrl = `${baseUrl}/api/year-end-letters/${filename}?${urlParams.toString()}`;

        // Use the subaccountInfo for letterData (already defined above)
        const subaccountInfo2 = SUBACCOUNT_DATA[contactInfo.locationId || ''] || {
          subaccountName: 'Default Subaccount',
          subaccountEmail: 'default@subaccount.com'
        };

        // Prepare letter data for webhook
        const letterData = {
          contactId,
          contactName,
          firstName,
          email: contactInfo.email,
          address: contactInfo.address,
          year: yearNum,
          transactions: allTransactions.map(t => ({
            date: t.date,
            amount: parseFloat(t.amount?.toString() || "0"),
            description: t.description || 'donation'
          })),
          totalAmount,
          charityName: charityName || "ABC Charity",
          charityAddress: charityAddress || "1234 Main Street, Anytown, USA",
          taxId: taxId || "12-3456789",
          customNote: customNote || "Your generosity throughout the year helped over 100 children in need. Thank you for making a difference in our community!",
          signatureName: signatureName || "Executive Director",
          pdfUrl,
          subaccountName: subaccountInfo.subaccountName,
          subaccountEmail: subaccountInfo.subaccountEmail
        };

        // Send to webhook
        const webhookResponse = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(letterData),
        });

        if (webhookResponse.ok) {
          results.push({ contactId, success: true, pdfUrl });
        } else {
          const errorText = await webhookResponse.text();
          results.push({ contactId, success: false, error: `Webhook failed: ${errorText}`, pdfUrl });
        }

      } catch (error) {
        console.error(`Error processing contact ${contactId}:`, error);
        results.push({
          contactId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    return NextResponse.json({
      message: `Processed ${results.length} contacts. ${successCount} successful, ${failureCount} failed.`,
      results,
    });

  } catch (error) {
    console.error("Error sending year-end letters:", error);
    return NextResponse.json(
      { error: "Failed to send year-end letters" },
      { status: 500 }
    );
  }
}
