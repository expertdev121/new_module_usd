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
  paymentType: 'manual' | 'regular';
}

export function generatePDFReceipt(data: ReceiptData): Buffer {
  const doc = new jsPDF();
  
  // Set font
  doc.setFont('helvetica');
  
  // Header
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.text('PAYMENT RECEIPT', 105, 20, { align: 'center' });
  
  // Organization info
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('Texas Torah Institute', 105, 30, { align: 'center' });
  doc.text('Address Line 1, City, State ZIP', 105, 35, { align: 'center' });
  
  // Line separator
  doc.setDrawColor(200, 200, 200);
  doc.line(20, 42, 190, 42);
  
  let yPos = 55;
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  
  // Payment Information Section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Payment Information', 20, yPos);
  yPos += 8;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  const leftCol = 20;
  const rightCol = 110;
  
  // Payment ID and Date
  doc.text(`Payment ID:`, leftCol, yPos);
  doc.setFont('helvetica', 'bold');
  doc.text(`#${data.paymentId}`, leftCol + 35, yPos);
  doc.setFont('helvetica', 'normal');
  
  doc.text(`Payment Date:`, rightCol, yPos);
  doc.setFont('helvetica', 'bold');
  doc.text(new Date(data.paymentDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }), rightCol + 35, yPos);
  doc.setFont('helvetica', 'normal');
  yPos += 7;
  
  // Amount
  doc.text(`Amount:`, leftCol, yPos);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 128, 0);
  doc.text(`${data.currency} ${parseFloat(data.amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`, leftCol + 35, yPos);
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  if (data.paymentMethod) {
    doc.text(`Payment Method:`, rightCol, yPos);
    doc.setFont('helvetica', 'bold');
    doc.text(data.paymentMethod, rightCol + 35, yPos);
    doc.setFont('helvetica', 'normal');
  }
  yPos += 7;
  
  if (data.referenceNumber) {
    doc.text(`Reference #:`, leftCol, yPos);
    doc.text(data.referenceNumber, leftCol + 35, yPos);
    yPos += 7;
  }
  
  if (data.receiptNumber) {
    doc.text(`Receipt #:`, leftCol, yPos);
    doc.text(data.receiptNumber, leftCol + 35, yPos);
    yPos += 7;
  }
  
  yPos += 5;
  
  // Contact Information
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Contact Information', 20, yPos);
  yPos += 8;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  doc.text(`Name:`, leftCol, yPos);
  doc.setFont('helvetica', 'bold');
  doc.text(data.contactName, leftCol + 25, yPos);
  doc.setFont('helvetica', 'normal');
  yPos += 7;
  
  doc.text(`Email:`, leftCol, yPos);
  doc.text(data.contactEmail, leftCol + 25, yPos);
  yPos += 7;
  
  if (data.contactPhone) {
    doc.text(`Phone:`, leftCol, yPos);
    doc.text(data.contactPhone, leftCol + 25, yPos);
    yPos += 7;
  }
  
  // Campaign/Category
  if (data.campaign || data.category) {
    yPos += 5;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Campaign Information', 20, yPos);
    yPos += 8;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    if (data.campaign) {
      doc.text(`Campaign:`, leftCol, yPos);
      doc.setFont('helvetica', 'bold');
      doc.text(data.campaign, leftCol + 25, yPos);
      doc.setFont('helvetica', 'normal');
      yPos += 7;
    }
    
    if (data.category) {
      doc.text(`Category:`, leftCol, yPos);
      doc.text(data.category, leftCol + 25, yPos);
      yPos += 7;
    }
  }
  
  // Pledge Information
  if (data.pledgeDescription || data.pledgeOriginalAmount) {
    yPos += 5;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Pledge Information', 20, yPos);
    yPos += 8;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    if (data.pledgeDescription) {
      doc.text(`Description:`, leftCol, yPos);
      const description = doc.splitTextToSize(data.pledgeDescription, 140);
      doc.text(description, leftCol + 30, yPos);
      yPos += (description.length * 7);
    }
    
    if (data.pledgeOriginalAmount && data.pledgeCurrency) {
      doc.text(`Original Pledge:`, leftCol, yPos);
      doc.text(`${data.pledgeCurrency} ${data.pledgeOriginalAmount}`, leftCol + 35, yPos);
      yPos += 7;
    }
  }
  
  // Notes
  if (data.notes) {
    yPos += 5;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Notes', 20, yPos);
    yPos += 8;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const notesLines = doc.splitTextToSize(data.notes, 170);
    doc.text(notesLines, leftCol, yPos);
    yPos += (notesLines.length * 7);
  }
  
  // Footer
  yPos = 270;
  doc.setDrawColor(200, 200, 200);
  doc.line(20, yPos, 190, yPos);
  yPos += 7;
  
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text('Thank you for your generous support!', 105, yPos, { align: 'center' });
  yPos += 5;
  doc.text(`Generated on: ${new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}`, 105, yPos, { align: 'center' });
  
  const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
  return pdfBuffer;
}

export function generateReceiptFilename(paymentId: number, paymentType: 'manual' | 'regular'): string {
  const timestamp = Date.now();
  return `receipt-${paymentType}-${paymentId}-${timestamp}.pdf`;
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