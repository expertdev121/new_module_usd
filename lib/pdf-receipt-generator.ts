// lib/pdf-receipt-generator.ts
import { jsPDF } from 'jspdf';
import fs from 'fs';
import path from 'path';

export interface ReceiptData {
  paymentId: number;
  amount: string;
  currency: string;
  paymentDate: string;
  paymentMethod?: string;
  referenceNumber?: string;
  receiptNumber?: string;
  notes?: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  pledgeDescription?: string;
  pledgeOriginalAmount?: string;
  pledgeCurrency?: string;
  category?: string;
  campaign?: string;
}

export function generatePDFReceipt(data: ReceiptData): Buffer {
  const doc = new jsPDF();
  
  // Set font
  doc.setFont('helvetica');
  
  // Add blue header background
  doc.setFillColor(41, 98, 255);
  doc.rect(0, 0, 210, 50, 'F');
  
  // Add placeholder logo circle (you can replace this with actual logo later)
  doc.setFillColor(255, 255, 255);
  doc.circle(30, 25, 12, 'F');
  doc.setTextColor(41, 98, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('TTI', 30, 27, { align: 'center' });
  
  // Organization name and info in header
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('Texas Torah Institute', 55, 22);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Address Line 1, City, State ZIP', 55, 30);
  doc.text('contact@texastorahinstitute.org | (123) 456-7890', 55, 36);
  
  // Receipt title
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('RECEIPT', 180, 25, { align: 'right' });
  
  let yPos = 65;
  
  // Receipt details box
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.rect(20, yPos, 170, 25);
  
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  const leftCol = 25;
  const midCol = 95;
  const rightCol = 135;
  
  yPos += 7;
  
  // Receipt number and date
  doc.text('Receipt #:', leftCol, yPos);
  doc.setFont('helvetica', 'bold');
  doc.text(`${data.receiptNumber || `R-${data.paymentId}`}`, leftCol + 22, yPos);
  doc.setFont('helvetica', 'normal');
  
  doc.text('Payment ID:', midCol, yPos);
  doc.setFont('helvetica', 'bold');
  doc.text(`#${data.paymentId}`, midCol + 25, yPos);
  doc.setFont('helvetica', 'normal');
  
  doc.text('Date:', rightCol, yPos);
  doc.setFont('helvetica', 'bold');
  doc.text(new Date(data.paymentDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }), rightCol + 12, yPos);
  doc.setFont('helvetica', 'normal');
  
  yPos += 7;
  
  if (data.paymentMethod) {
    doc.text('Payment Method:', leftCol, yPos);
    doc.setFont('helvetica', 'bold');
    doc.text(data.paymentMethod, leftCol + 35, yPos);
    doc.setFont('helvetica', 'normal');
  }
  
  if (data.referenceNumber) {
    doc.text('Reference:', midCol, yPos);
    doc.text(data.referenceNumber, midCol + 22, yPos);
  }
  
  yPos += 20;
  
  // Bill To section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(41, 98, 255);
  doc.text('BILL TO', 20, yPos);
  yPos += 8;
  
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  doc.setFont('helvetica', 'bold');
  doc.text(data.contactName, 20, yPos);
  yPos += 6;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(data.contactEmail, 20, yPos);
  yPos += 6;
  
  if (data.contactPhone) {
    doc.text(data.contactPhone, 20, yPos);
    yPos += 6;
  }
  
  yPos += 10;
  
  // Payment details table
  doc.setFillColor(245, 247, 250);
  doc.rect(20, yPos, 170, 10, 'F');
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 60);
  doc.text('DESCRIPTION', 25, yPos + 7);
  doc.text('AMOUNT', 165, yPos + 7, { align: 'right' });
  
  yPos += 10;
  
  doc.setLineWidth(0.3);
  doc.setDrawColor(220, 220, 220);
  doc.line(20, yPos, 190, yPos);
  
  yPos += 8;
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  
  let description = 'Payment';
  if (data.pledgeDescription) {
    description = data.pledgeDescription;
  } else if (data.campaign) {
    description = `${data.campaign} Donation`;
  } else if (data.category) {
    description = data.category;
  }
  
  const descLines = doc.splitTextToSize(description, 120);
  doc.text(descLines, 25, yPos);
  
  doc.setFont('helvetica', 'bold');
  doc.text(`${data.currency} ${parseFloat(data.amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`, 185, yPos, { align: 'right' });
  
  yPos += (descLines.length * 5) + 5;
  
  // Show pledge info if available
  if (data.pledgeOriginalAmount && data.pledgeCurrency) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 100, 100);
    doc.text(`(Part of ${data.pledgeCurrency} ${data.pledgeOriginalAmount} pledge)`, 25, yPos);
    yPos += 8;
  }
  
  // Campaign info if available
  if (data.campaign && !data.pledgeDescription) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 100, 100);
    doc.text(`Campaign: ${data.campaign}`, 25, yPos);
    yPos += 8;
  }
  
  doc.setDrawColor(220, 220, 220);
  doc.line(20, yPos, 190, yPos);
  
  yPos += 8;
  
  // Total section
  doc.setFillColor(245, 247, 250);
  doc.rect(130, yPos - 5, 60, 12, 'F');
  
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 60);
  doc.text('TOTAL PAID', 135, yPos + 3);
  
  doc.setFontSize(14);
  doc.setTextColor(0, 128, 0);
  doc.text(`${data.currency} ${parseFloat(data.amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`, 185, yPos + 3, { align: 'right' });
  
  yPos += 20;
  
  // Notes section
  if (data.notes) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(60, 60, 60);
    doc.text('NOTES', 20, yPos);
    yPos += 7;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    const notesLines = doc.splitTextToSize(data.notes, 170);
    doc.text(notesLines, 20, yPos);
    yPos += (notesLines.length * 5) + 10;
  }
  
  // Footer
  yPos = 270;
  doc.setDrawColor(220, 220, 220);
  doc.line(20, yPos, 190, yPos);
  yPos += 6;
  
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'italic');
  doc.text('Thank you for your generous support!', 105, yPos, { align: 'center' });
  yPos += 5;
  
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated on ${new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}`, 105, yPos, { align: 'center' });
  
  const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
  return pdfBuffer;
}

export function generateReceiptFilename(paymentId: number, paymentType?: string): string {
  const timestamp = Date.now();
  const type = paymentType || 'payment';
  return `receipt-${type}-${paymentId}-${timestamp}.pdf`;
}

// Save PDF to public directory
export async function savePDFToPublic(pdfBuffer: Buffer, filename: string): Promise<string> {
  const publicDir = path.join(process.cwd(), 'public', 'receipts');
  
  // Create receipts directory if it doesn't exist
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  
  const filePath = path.join(publicDir, filename);
  
  // Write file
  await fs.promises.writeFile(filePath, pdfBuffer);
  
  // Return URL path (not file system path)
  return `/receipts/${filename}`;
}

// Optional: Clean up old receipts (older than 30 days)
export async function cleanupOldReceipts(daysOld = 30): Promise<number> {
  const publicDir = path.join(process.cwd(), 'public', 'receipts');
  
  if (!fs.existsSync(publicDir)) {
    return 0;
  }
  
  const files = await fs.promises.readdir(publicDir);
  const now = Date.now();
  const maxAge = daysOld * 24 * 60 * 60 * 1000;
  let deletedCount = 0;
  
  for (const file of files) {
    const filePath = path.join(publicDir, file);
    const stats = await fs.promises.stat(filePath);
    
    if (now - stats.mtimeMs > maxAge) {
      await fs.promises.unlink(filePath);
      deletedCount++;
    }
  }
  
  return deletedCount;
}