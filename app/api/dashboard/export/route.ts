import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { contact, payment, pledge, paymentPlan } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { isRevenueStatus } from "@/lib/reports/donations-source";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface JsPDFWithAutoTable extends jsPDF {
  lastAutoTable: {
    finalY: number;
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "csv";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    // Build date filter
    let dateFilter = undefined;
    if (startDate && endDate) {
      dateFilter = and(
        gte(payment.createdAt, new Date(startDate)),
        lte(payment.createdAt, new Date(endDate))
      );
    }

    // Fetch dashboard data
    const [overviewData] = await db
      .select({
        totalContacts: sql<number>`COUNT(DISTINCT ${contact.id})`,
        totalPledges: sql<number>`COUNT(DISTINCT ${pledge.id})`,
        totalPayments: sql<number>`COUNT(DISTINCT ${payment.id})`,
        totalPledgeAmount: sql<number>`COALESCE(SUM(${pledge.originalAmount}), 0)`,
        totalPaymentAmount: sql<number>`COALESCE(SUM(${payment.amount}), 0)`,
        activePlans: sql<number>`COUNT(DISTINCT CASE WHEN ${paymentPlan.planStatus} = 'active' THEN ${paymentPlan.id} END)`,
        collectionRate: sql<number>`ROUND(CASE WHEN COALESCE(SUM(${pledge.originalAmount}), 0) > 0 THEN (COALESCE(SUM(${payment.amount}), 0) / COALESCE(SUM(${pledge.originalAmount}), 0)) * 100 ELSE 0 END, 2)`,
      })
      .from(contact)
      .leftJoin(pledge, eq(contact.id, pledge.contactId))
      // Exclude refunded/failed/cancelled from payment totals (filter in JOIN).
      .leftJoin(payment, and(eq(pledge.id, payment.pledgeId), isRevenueStatus(payment.paymentStatus)))
      .leftJoin(paymentPlan, eq(pledge.id, paymentPlan.pledgeId))
      .where(dateFilter);

    // Fetch trends data
    const trendsData = await db
      .select({
        month: sql<string>`TO_CHAR(${payment.createdAt}, 'YYYY-MM')`,
        payments: sql<number>`SUM(${payment.amount})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(payment)
      .where(and(dateFilter, isRevenueStatus(payment.paymentStatus)))
      .groupBy(sql`TO_CHAR(${payment.createdAt}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${payment.createdAt}, 'YYYY-MM')`);

    // Fetch payment methods data
    const paymentMethodsData = await db
      .select({
        method: payment.paymentMethod,
        amount: sql<number>`SUM(${payment.amount})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(payment)
      .where(and(dateFilter, isRevenueStatus(payment.paymentStatus)))
      .groupBy(payment.paymentMethod);

    // Fetch top donors
    const topDonorsData = await db
      .select({
        name: sql<string>`CONCAT(${contact.firstName}, ' ', ${contact.lastName})`,
        pledgeAmount: sql<number>`SUM(${pledge.originalAmount})`,
        paymentAmount: sql<number>`SUM(${payment.amount})`,
        pledges: sql<number>`COUNT(DISTINCT ${pledge.id})`,
        payments: sql<number>`COUNT(DISTINCT ${payment.id})`,
        completion: sql<number>`ROUND(CASE WHEN SUM(${pledge.originalAmount}) > 0 THEN (SUM(${payment.amount}) / SUM(${pledge.originalAmount})) * 100 ELSE 0 END, 2)`,
      })
      .from(contact)
      .leftJoin(pledge, eq(contact.id, pledge.contactId))
      .leftJoin(payment, and(eq(pledge.id, payment.pledgeId), isRevenueStatus(payment.paymentStatus)))
      .where(dateFilter)
      .groupBy(contact.id, contact.firstName, contact.lastName)
      .orderBy(sql`SUM(${payment.amount}) DESC`)
      .limit(10);

    // Prepare data for export
    const exportData = {
      overview: {
        "Total Contacts": overviewData.totalContacts,
        "Total Pledges": overviewData.totalPledges,
        "Total Payments": overviewData.totalPayments,
        "Total Pledge Amount": overviewData.totalPledgeAmount,
        "Total Payment Amount": overviewData.totalPaymentAmount,
        "Active Plans": overviewData.activePlans,
        "Collection Rate (%)": overviewData.collectionRate,
      },
      trends: trendsData.map(item => ({
        "Month": item.month,
        "Payment Count": item.count,
        "Total Amount": item.payments,
      })),
      paymentMethods: paymentMethodsData.map(item => ({
        "Payment Method": item.method,
        "Amount": item.amount,
        "Count": item.count,
      })),
      topDonors: topDonorsData.map(item => ({
        "Name": item.name,
        "Pledge Amount": item.pledgeAmount,
        "Payment Amount": item.paymentAmount,
        "Pledges": item.pledges,
        "Payments": item.payments,
        "Completion (%)": item.completion,
      })),
    };

    if (format === "csv") {
      // Generate CSV
      const csvData = [];

      // Overview
      csvData.push(["Overview"]);
      csvData.push(Object.keys(exportData.overview));
      csvData.push(Object.values(exportData.overview));
      csvData.push([]);

      // Trends
      csvData.push(["Trends"]);
      if (exportData.trends.length > 0) {
        csvData.push(Object.keys(exportData.trends[0]));
        exportData.trends.forEach(row => csvData.push(Object.values(row)));
      }
      csvData.push([]);

      // Payment Methods
      csvData.push(["Payment Methods"]);
      if (exportData.paymentMethods.length > 0) {
        csvData.push(Object.keys(exportData.paymentMethods[0]));
        exportData.paymentMethods.forEach(row => csvData.push(Object.values(row)));
      }
      csvData.push([]);

      // Top Donors
      csvData.push(["Top Donors"]);
      if (exportData.topDonors.length > 0) {
        csvData.push(Object.keys(exportData.topDonors[0]));
        exportData.topDonors.forEach(row => csvData.push(Object.values(row)));
      }

      const csvContent = csvData.map(row =>
        row.map(cell => `"${cell}"`).join(",")
      ).join("\n");

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="dashboard-export-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    } else if (format === "pdf") {
      // Generate PDF
      const doc = new jsPDF() as JsPDFWithAutoTable;

      doc.setFontSize(20);
      doc.text("Dashboard Export", 20, 20);

      doc.setFontSize(12);
      doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 20, 35);

      let yPosition = 50;

      // Overview section
      doc.setFontSize(16);
      doc.text("Overview", 20, yPosition);
      yPosition += 10;

      const overviewTableData = Object.entries(exportData.overview).map(([key, value]) => [key, value.toString()]);
      autoTable(doc, {
        startY: yPosition,
        head: [["Metric", "Value"]],
        body: overviewTableData,
        theme: "grid",
      });
      yPosition = doc.lastAutoTable.finalY + 20;

      // Trends section
      if (exportData.trends.length > 0) {
        doc.setFontSize(16);
        doc.text("Trends", 20, yPosition);
        yPosition += 10;

        autoTable(doc, {
          startY: yPosition,
          head: [["Month", "Payment Count", "Total Amount"]],
          body: exportData.trends.map(row => [row["Month"], row["Payment Count"].toString(), row["Total Amount"].toString()]),
          theme: "grid",
        });
        yPosition = doc.lastAutoTable.finalY + 20;
      }

      // Payment Methods section
      if (exportData.paymentMethods.length > 0) {
        doc.setFontSize(16);
        doc.text("Payment Methods", 20, yPosition);
        yPosition += 10;

        autoTable(doc, {
          startY: yPosition,
          head: [["Payment Method", "Amount", "Count"]],
          body: exportData.paymentMethods.map(row => [row["Payment Method"], row["Amount"].toString(), row["Count"].toString()]),
          theme: "grid",
        });
        yPosition = doc.lastAutoTable.finalY + 20;
      }

      // Top Donors section
      if (exportData.topDonors.length > 0) {
        doc.setFontSize(16);
        doc.text("Top Donors", 20, yPosition);
        yPosition += 10;

        autoTable(doc, {
          startY: yPosition,
          head: [["Name", "Pledge Amount", "Payment Amount", "Completion %"]],
          body: exportData.topDonors.map(row => [
            row["Name"],
            row["Pledge Amount"].toString(),
            row["Payment Amount"].toString(),
            row["Completion (%)"].toString()
          ]),
          theme: "grid",
        });
      }

      const pdfBuffer = doc.output("arraybuffer");

      return new NextResponse(pdfBuffer, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="dashboard-export-${new Date().toISOString().split('T')[0]}.pdf"`,
        },
      });
    }

    return NextResponse.json({ error: "Invalid format" }, { status: 400 });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
