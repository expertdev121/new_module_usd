import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, or, and, gte, lte, sql } from "drizzle-orm";
import { payment, manualDonation, pledge, contact, campaign } from "@/lib/db/schema";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import jsPDF from "jspdf";

const WEBHOOK_URL = "https://services.leadconnectorhq.com/hooks/4Nzcp3vUgVbOoN9uxu5F/webhook-trigger/e688244a-2ee6-49c5-a8be-668f547b6b2b";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { contactIds, year, charityName, charityAddress, taxId, customNote, signatureName } = body;

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

        // Generate PDF
        const doc = new jsPDF();
        let yPosition = 20;

        // Organization header (centered)
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(charityName || "ABC Charity", doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
        yPosition += 10;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(charityAddress || "1234 Main Street, Anytown, USA", doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
        yPosition += 5;
        doc.text(`Federal Tax ID: ${taxId || "12-3456789"}`, doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
        yPosition += 15;

        // Date
        const today = new Date();
        doc.text(today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), 20, yPosition);
        yPosition += 15;

        // Donor address
        doc.text(contactName, 20, yPosition);
        yPosition += 5;
        if (contactInfo.address) {
          doc.text(contactInfo.address, 20, yPosition);
          yPosition += 5;
        }
        yPosition += 10;

        // Salutation
        doc.text(`Dear ${firstName},`, 20, yPosition);
        yPosition += 15;

        // Body text
        const bodyText = `Thank you for your support of ${charityName || "ABC Charity"} this past year. We are pleased to provide you with a summary of your ${yearNum} contributions:`;
        const splitBody = doc.splitTextToSize(bodyText, 170);
        doc.text(splitBody, 20, yPosition);
        yPosition += splitBody.length * 5 + 10;

        // Table headers
        doc.setFont('helvetica', 'bold');
        doc.text('Date', 20, yPosition);
        doc.text('Amount', 80, yPosition);
        doc.text('Description', 120, yPosition);
        yPosition += 10;

        // Table data
        doc.setFont('helvetica', 'normal');
        allTransactions.forEach((transaction) => {
          const dateStr = transaction.date
            ? new Date(transaction.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
            : 'N/A';
          const amountStr = `$${parseFloat(transaction.amount?.toString() || "0").toFixed(0)}`;
          const descStr = transaction.description || 'donation';

          doc.text(dateStr, 20, yPosition);
          doc.text(amountStr, 80, yPosition);
          const splitDesc = doc.splitTextToSize(descStr, 70);
          doc.text(splitDesc, 120, yPosition);
          yPosition += Math.max(splitDesc.length * 5, 7);
        });

        yPosition += 5;

        // Total
        doc.setFont('helvetica', 'bold');
        doc.text('Total', 20, yPosition);
        doc.text(`$${totalAmount.toFixed(0)}`, 80, yPosition);
        yPosition += 15;

        // Note
        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        const noteText = 'Note: for donations of goods and services, the fair market value should be determined by you.';
        const splitNote = doc.splitTextToSize(noteText, 170);
        doc.text(splitNote, 20, yPosition);
        yPosition += splitNote.length * 4 + 10;

        // Impact statement
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const impactNote = customNote || "Your generosity throughout the year helped over 100 children in need. Thank you for making a difference in our community!";
        const splitImpact = doc.splitTextToSize(impactNote, 170);
        doc.text(splitImpact, 20, yPosition);
        yPosition += splitImpact.length * 5 + 10;

        // Closing
        doc.text('Sincerely,', 20, yPosition);
        yPosition += 15;

        // Signature
        doc.setFont('helvetica', 'italic');
        doc.text('Signature', 20, yPosition);
        yPosition += 5;
        doc.setFont('helvetica', 'normal');
        doc.text(signatureName || "Executive Director", 20, yPosition);

        // Generate PDF buffer
        const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

        // Save PDF to public directory
        const filename = `donation-letter-${contactId}-${yearNum}-${Date.now()}.pdf`;
        const fs = require('fs');
        const path = require('path');
        const publicDir = path.join(process.cwd(), 'public', 'receipts');

        // Ensure directory exists
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }

        const filePath = path.join(publicDir, filename);
        fs.writeFileSync(filePath, pdfBuffer);

        // Generate PDF URL
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const pdfUrl = `${baseUrl}/receipts/${filename}`;

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
          pdfUrl
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
