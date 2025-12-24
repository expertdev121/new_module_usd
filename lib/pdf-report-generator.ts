import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface ReportData {
  [key: string]: string | number | null;
}

export interface PDFReportOptions {
  title: string;
  subtitle?: string;
  data: ReportData[];
  filename: string;
  includeTimestamp?: boolean;
}

export function generateReportPDF(options: PDFReportOptions): Buffer {
  const { title, subtitle, data, includeTimestamp = true } = options;

  const doc = new jsPDF('landscape'); // Use landscape for better column width

  // Start directly with report title (no logo or company info)
  let yPos = 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title, 15, yPos);

  if (subtitle) {
    yPos += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(subtitle, 15, yPos);
  }

  // Add timestamp if requested
  if (includeTimestamp) {
    yPos += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 15, yPos);
    doc.setTextColor(0);
  }

  // Prepare table data
  if (data.length > 0) {
    const headers = Object.keys(data[0]);
    const body = data.map(row =>
      headers.map(header => {
        const value = row[header];
        return value !== null && value !== undefined ? String(value) : '';
      })
    );

    // Add table
    yPos += 8;
    autoTable(doc, {
      head: [headers],
      body: body,
      startY: yPos,
      styles: {
        fontSize: 8,
        cellPadding: 2.5,
        minCellHeight: 6,
        halign: 'left',
        valign: 'middle',
        lineWidth: 0.1,
        lineColor: [200, 200, 200],
      },
      headStyles: {
        fillColor: [144, 238, 144], // Light green header
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        fontSize: 8,
        cellPadding: 3,
        minCellHeight: 7,
        halign: 'center',
      },
      alternateRowStyles: {
        fillColor: [250, 250, 250],
      },
      margin: { top: 10, left: 10, right: 10 },
      tableWidth: 'auto',
      theme: 'grid',
      didDrawPage: function(data: any) {
        // Add page number at bottom
        const pageCount = doc.getNumberOfPages();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text(
          `Page ${data.pageNumber} of ${pageCount}`,
          doc.internal.pageSize.width - 15,
          doc.internal.pageSize.height - 10,
          { align: 'right' }
        );
        doc.setTextColor(0);
      },
    });
  } else {
    yPos += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('No data available for the selected criteria.', 15, yPos);
  }

  const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
  return pdfBuffer;
}

export function generateReportFilename(baseName: string, extension: 'csv' | 'pdf' = 'pdf'): string {
  const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format
  return `${baseName}-${timestamp}.${extension}`;
}