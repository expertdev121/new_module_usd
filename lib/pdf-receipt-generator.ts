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

  // === HEADER ===
  // Load the logo only from `public/Logo.jpg`. If the file doesn't exist or
  // fails to read, skip adding a logo to the PDF (no embedded fallback).
  const publicLogoPath = path.join(process.cwd(), 'public', 'Logo.jpg');
  try {
    if (fs.existsSync(publicLogoPath)) {
      const imgBuffer = fs.readFileSync(publicLogoPath);
      const ext = path.extname(publicLogoPath).toLowerCase();
      const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      const imgFormat: 'PNG' | 'JPEG' = mime.includes('png') ? 'PNG' : 'JPEG';
      const logoDataUri = `data:${mime};base64,${imgBuffer.toString('base64')}`;
      doc.addImage(logoDataUri, imgFormat, 15, 12, 25, 25);
    }
    // if file doesn't exist, intentionally do nothing (no logo)
  } catch (err) {
    // If reading the public logo fails, do not add any image. We avoid throwing
    // so PDF generation continues without a logo.
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Texas Torah Institute', 195, 20, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('6506 Frankford Rd.', 195, 26, { align: 'right' });
  doc.text('Dallas, TX 75252', 195, 31, { align: 'right' });
  doc.text('United States', 195, 36, { align: 'right' });
  doc.setTextColor(0, 0, 255);
  doc.text('www.texastorah.org', 195, 41, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  // === BILL TO & RECEIPT INFO ===
  let yPos = 55;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Billed to', 15, yPos);
  yPos += 6;
  doc.text(data.contactName, 15, yPos);
  yPos += 5;
  doc.setFont('helvetica', 'normal');
  if (data.contactPhone) {
    doc.text(data.contactPhone, 15, yPos);
    yPos += 5;
  }
  doc.text(data.contactEmail, 15, yPos);

  // Right side info (Receipt and Date)
  doc.setFontSize(10);
  const rightLabelX = 140; // column start for labels
  const rightValueX = 190; // aligned right for values

  // Receipt No
  doc.setFont('helvetica', 'normal');
  doc.text('Receipt No', rightLabelX, 55);
  doc.setFont('helvetica', 'bold');
  doc.text(`${data.receiptNumber || `REC${data.paymentId}`}`, rightValueX, 55, { align: 'right' });

  // Date Paid
  doc.setFont('helvetica', 'normal');
  doc.text('Date Paid', rightLabelX, 67);
  doc.setFont('helvetica', 'bold');
  doc.text(
    new Date(data.paymentDate).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
    rightValueX,
    67,
    { align: 'right' }
  );


  // === TABLE HEADER ===
  yPos += 20;
  doc.setLineWidth(0.3);
  doc.line(15, yPos, 195, yPos);
  yPos += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Campaign name', 25, yPos);
  doc.text('Donation', 170, yPos, { align: 'right' });
  yPos += 3;
  doc.line(15, yPos, 195, yPos);

  // === TABLE BODY ===
  yPos += 10;
  doc.setFont('helvetica', 'normal');
  const campaignName =
    data.campaign || data.pledgeDescription || data.category || 'General Donation';
  doc.text(campaignName, 25, yPos);
  doc.text(
    `${data.currency}${parseFloat(data.amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
    })}`,
    170,
    yPos,
    { align: 'right' }
  );

  // === TOTAL ONLY (removed subtotal) ===
  yPos += 10;
  doc.line(15, yPos, 195, yPos);
  yPos += 8;
  doc.setFont('helvetica', 'normal');
  doc.text('Total (USD)', 150, yPos);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `${data.currency}${parseFloat(data.amount).toFixed(2)}`,
    190,
    yPos,
    { align: 'right' }
  );

  // === TERMS & NOTES ===
  yPos += 20;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Terms & Notes', 15, yPos);
  yPos += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const notes = [
    'Registered Charity: 02-0699665',
    'No goods or services were provided in exchange for this contribution.',
    'If your donation(s) have been made via a third party or a donor advised fund, please consider this letter as an acknowledgment only.',
  ];
  notes.forEach((line) => {
    doc.text(line, 15, yPos);
    yPos += 5;
  });

  // === FOOTER ===
  yPos = 275;
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text('Thank you for your generous support!', 105, yPos, { align: 'center' });

  const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
  return pdfBuffer;
}


export function generateReceiptFilename(paymentId: number, paymentType?: string): string {
  const timestamp = Date.now();
  const type = paymentType || 'payment';
  return `receipt-${type}-${paymentId}-${timestamp}.pdf`;
}

export async function savePDFToPublic(pdfBuffer: Buffer, filename: string): Promise<string> {
  // In production environments like Vercel, we can't write to the file system
  // So we just return the path - the PDF will be generated on-demand
  return `/receipts/${filename}`;
}

export async function cleanupOldReceipts(daysOld = 30): Promise<number> {
  const publicDir = path.join(process.cwd(), 'public', 'receipts');
  if (!fs.existsSync(publicDir)) return 0;
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
