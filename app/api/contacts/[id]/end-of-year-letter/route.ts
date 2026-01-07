import { db } from "@/lib/db";
import { payment, manualDonation, pledge, contact, campaign } from "@/lib/db/schema";
import { eq, or, and, gte, lte, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import jsPDF from "jspdf";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contactId = parseInt(id, 10);
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || "", 10);

  if (!year || isNaN(year)) {
    return NextResponse.json({ error: "Year parameter is required" }, { status: 400 });
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const contactInfo = contactData[0];
    const contactName = contactInfo.displayName || `${contactInfo.firstName} ${contactInfo.lastName}`;
    const firstName = contactInfo.firstName || 'Donor';

    // Define date range for the year
    const startDateStr = `${year}-01-01`;
    const endDateStr = `${year}-12-31`;

    // Fetch payments for the year
    const paymentsData = await db
      .select({
        id: payment.id,
        date: payment.receivedDate,
        amount: payment.amountUsd,
        description: pledge.description,
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
        description: sql<string>`'Direct Donation'`,
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

    // Create PDF Document using jsPDF
    const doc = new jsPDF();
    let yPosition = 20;

    // Organization header (centered) - CUSTOMIZE THESE
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('ABC Charity', doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
    yPosition += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('1234 Main Street, Anytown, USA', doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
    yPosition += 5;
    doc.text('Federal Tax ID: 12-3456789', doc.internal.pageSize.width / 2, yPosition, { align: 'center' });
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

    // Body text - CUSTOMIZE THIS MESSAGE
    const bodyText = `Thank you for your support of ABC Charity this past year. We are pleased to provide you with a summary of your ${year} contributions:`;
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
      const descStr = transaction.description || 'Direct Donation';

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

    // Impact statement - CUSTOMIZE THIS MESSAGE
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const impactText = `Your generosity throughout the year helped over 100 children in need. Thank you for making a difference in our community!`;
    const splitImpact = doc.splitTextToSize(impactText, 170);
    doc.text(splitImpact, 20, yPosition);
    yPosition += splitImpact.length * 5 + 10;

    // Closing
    doc.text('Sincerely,', 20, yPosition);
    yPosition += 15;

    // Signature - CUSTOMIZE THESE
    doc.setFont('helvetica', 'italic');
    doc.text('Signature', 20, yPosition);
    yPosition += 5;
    doc.setFont('helvetica', 'normal');
    doc.text('Executive Director', 20, yPosition);

    // Generate PDF buffer
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    // Return PDF as response
    return new NextResponse(pdfBuffer as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="donation-letter-${year}.pdf"`,
      },
    });

  } catch (error) {
    console.error("End of year letter error:", error);
    return NextResponse.json(
      { error: "Failed to generate end of year letter" },
      { status: 500 }
    );
  }
}