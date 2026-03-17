import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, or, and, gte, lte, sql } from "drizzle-orm";
import { payment, manualDonation, pledge, contact, campaign } from "@/lib/db/schema";
import jsPDF from "jspdf";
import https from "https";
import http from "http";

// Helper function to download image from URL and convert to base64
async function downloadImageAsBase64(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const protocol = url.startsWith("https://") ? https : http;
    const request = protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        resolve(null);
        return;
      }

      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString("base64");
        const mimeType = response.headers["content-type"] || "image/jpeg";
        resolve(`data:${mimeType};base64,${base64}`);
      });
    });

    request.on("error", () => resolve(null));
    request.setTimeout(5000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await context.params;
    const { searchParams } = new URL(request.url);

    const logoLink = searchParams.get("logoLink");
    const charityName = searchParams.get("charityName") || "ABC Charity";
    const charityAddress =
      searchParams.get("charityAddress") ||
      "1234 Main Street, Anytown, USA";
    const taxId = searchParams.get("taxId") || "12-3456789";
    const customNote =
      searchParams.get("customNote") ||
      "Your generosity throughout the year helped many people in need.";
    const signatureName =
      searchParams.get("signatureName") || "Executive Director";
    const subaccountName = searchParams.get("subaccountName") || charityName;

    // Validate filename
    if (
      !filename ||
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    if (!filename.endsWith(".pdf")) {
      return NextResponse.json(
        { error: "Only PDF files are allowed" },
        { status: 400 }
      );
    }

    const match = filename.match(/^year-end-letter-(\d+)-(\d{4})-\d+\.pdf$/);

    if (!match) {
      return NextResponse.json(
        { error: "Invalid year-end letter filename format" },
        { status: 400 }
      );
    }

    const [, contactIdStr, yearStr] = match;

    const contactId = parseInt(contactIdStr, 10);
    const yearNum = parseInt(yearStr, 10);

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
    const contactName =
      contactInfo.displayName ||
      `${contactInfo.firstName} ${contactInfo.lastName}`;
    const firstName = contactInfo.firstName || "Donor";

    const startDateStr = `${yearNum}-01-01`;
    const endDateStr = `${yearNum}-12-31`;

    // Payments
    const paymentsData = await db
      .select({
        id: payment.id,
        date: payment.receivedDate,
        amount: payment.amountUsd,
        description: sql<string>`COALESCE(${pledge.campaignCode}, 'Donation')`,
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

    // Manual donations
    const donationsData = await db
      .select({
        id: manualDonation.id,
        date: manualDonation.receivedDate,
        amount: manualDonation.amountUsd,
        description: sql<string>`COALESCE(${campaign.name}, 'Donation')`,
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

    const allTransactions = [...paymentsData, ...donationsData].sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateA - dateB;
    });

    const totalAmount = allTransactions.reduce((sum, transaction) => {
      return sum + parseFloat(transaction.amount?.toString() || "0");
    }, 0);

    // ===================== PDF DESIGN =====================

    const doc = new jsPDF();

    const leftMargin = 25;
    const rightMargin = 185;
    const center = 105;

    let y = 25;

    // Header
    if (logoLink) {
      const logo = await downloadImageAsBase64(logoLink);
      if (logo) doc.addImage(logo, "JPEG", 85, y, 40, 20);
      y += 25;
    }

    doc.setFont("times", "bold");
    doc.setFontSize(20);
    doc.text(charityName.toUpperCase(), center, y, { align: "center" });

    doc.setFontSize(10);
    doc.setFont("times", "normal");
    doc.text(charityAddress, center, y + 6, { align: "center" });

    y += 20;

    // Date
    doc.text(
      new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
      leftMargin,
      y
    );

    y += 12;

    // Address
    // doc.text(contactName, leftMargin, y);
    // y += 6;

    // if (contactInfo.address) {
    //   const addr = doc.splitTextToSize(contactInfo.address, 90);
    //   doc.text(addr, leftMargin, y);
    //   y += addr.length * 5;
    // }

    y += 10;

    // Greeting
    doc.text(`Dear ${contactName},`, leftMargin, y);
    y += 10;

    // Body
    const bodyText = `Thank you so much for your donations throughout the past year to ${charityName}. Because of your generosity, we are able to continue our mission of helping and inspiring so many. May G-d grant you and yours much happiness, success, and good health.`;

    const bodyLines = doc.splitTextToSize(bodyText, rightMargin - leftMargin);
    doc.text(bodyLines, leftMargin, y);

    y += bodyLines.length * 5 + 10;

    doc.text(signatureName, leftMargin, y);
    y += 8;

    doc.text(
      "*If we inadvertently missed some donations, please reference the date & amount and we will send you an amended receipt.",
      leftMargin,
      y
    );

    y += 10;

    doc.text("Please see details below.", leftMargin, y);

    y += 12;

    // Table Header
    const colDate = leftMargin;
    const colPurpose = 100;
    const colAmount = 170;

    doc.setFont("times", "bold");

    doc.text("Payment Date", colDate, y);
    doc.text("Purpose", colPurpose, y);
    doc.text("Amount", colAmount, y, { align: "right" });

    y += 2;

    doc.line(leftMargin, y, rightMargin, y);

    y += 6;

    doc.setFont("times", "normal");

    allTransactions.forEach((t) => {
      const dateStr = t.date
        ? new Date(t.date).toLocaleDateString("en-US")
        : "";

      const amountStr = `$${parseFloat(
        t.amount?.toString() || "0"
      ).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

      const purpose = t.description || "Donation";

      doc.text(dateStr, colDate, y);
      doc.text(purpose, colPurpose, y);
      doc.text(amountStr, colAmount, y, { align: "right" });

      y += 6;

      if (y > 270) {
        doc.addPage();
        y = 25;
      }
    });

    y += 4;

    doc.setFont("times", "bold");
    doc.text(
      `Total: $${totalAmount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
      })}`,
      colAmount,
      y,
      { align: "right" }
    );

    y += 20;

    doc.setFont("times", "normal");
    doc.setFontSize(9);

    const footer = `Your donation to ${charityName} - Tax ID ${taxId} is fully tax-deductible to the extent allowed by law. No goods or services were provided in consideration, in whole or in part, for this contribution. Please keep this letter as your receipt.`;

    const footerLines = doc.splitTextToSize(
      footer,
      rightMargin - leftMargin
    );

    doc.text(footerLines, leftMargin, y);

    // ===================== OUTPUT =====================

    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength
    ) as ArrayBuffer;

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to serve year-end letter",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";