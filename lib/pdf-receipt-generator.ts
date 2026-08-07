// lib/pdf-receipt-generator.ts
import { jsPDF } from 'jspdf';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

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
  locationId?: string;
}

interface LocationConfig {
  name: string;
  address: string[];
  website: string;
  charityNumber?: string;
  logoPath?: string;
}

// Helper function to download image from URL and convert to base64
async function downloadImageAsBase64(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https://') ? https : http;
    const request = protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        resolve(null);
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString('base64');
        const mimeType = response.headers['content-type'] || 'image/jpeg';
        resolve(`data:${mimeType};base64,${base64}`);
      });
    });

    request.on('error', () => resolve(null));
    request.setTimeout(5000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

// Location configurations
const locationConfigs: Record<string, LocationConfig> = {
  'E7yO96aiKmYvsbU2tRzc': {
    name: 'Texas Torah Institute',
    address: ['6506 Frankford Rd.', 'Dallas, TX 75252', 'United States'],
    website: 'www.texastorah.org',
    charityNumber: '02-0699665',
    logoPath: 'https://storage.googleapis.com/msgsndr/g9JSoJ1FInnA6N0SHXi7/media/6983703c0a7fd12f9d3f83e3.png',
  },
  'g9JSoJ1FInnA6N0SHXi7': {
    name: 'Chabad of North Ranch',
    address: ['123 Main St.', 'Dallas, TX 75201', 'United States'],
    website: 'www.northranchchabad.org',
    charityNumber: '02-0699666',
    logoPath: 'https://storage.googleapis.com/highlevel-backend.appspot.com/location/g9JSoJ1FInnA6N0SHXi7/workflow/north-texas-logo.jpg',
  },
  'KVgMIrEYRkKRcfeicJBm': {
    name: 'Just One Life',
    address: ['456 Oak Ave.', 'New York, NY 10001', 'United States'],
    website: 'www.justonelife.org',
    charityNumber: '02-0699667',
    logoPath: 'https://storage.googleapis.com/highlevel-backend.appspot.com/location/KVgMIrEYRkKRcfeicJBm/workflow/a88f5f4c-d735-47d2-a1d0-146097a34cbd/7349e2bf-8aa1-497c-b388-6efb691d7187.jpg?alt=media&token=5013dc33-93b3-4be3-b19d-2afa871f8019',
  },
  'asI8eHkRqF8RpX1VXhHz': {
    name: 'Chabad at Oberlin College',
    address: ['789 College Rd.', 'Oberlin, OH 44074', 'United States'],
    website: 'www.chabadoberlin.org',
    charityNumber: '02-0699668',
    logoPath: 'https://storage.googleapis.com/msgsndr/h0RGDXEon3Q4Fu3KlpQC/media/6890ead7902503b7ae790d6d.png',
  },
  '4RFAAkbc9Ap17F4Ow5PI': {
    name: 'Chabad of Kentucky',
    address: ['321 State St.', 'Louisville, KY 40202', 'United States'],
    website: 'www.chabadkentucky.org',
    charityNumber: '02-0699669',
    logoPath: 'https://storage.googleapis.com/highlevel-backend.appspot.com/location/4RFAAkbc9Ap17F4Ow5PI/workflow/kentucky-logo.jpg',
  },
  'h0RGDXEon3Q4Fu3KlpQC': {
    name: 'Performing Stars of Marin',
    address: ['654 Broadway', 'San Francisco, CA 94102', 'United States'],
    website: 'www.chabadmarin.org',
    charityNumber: '02-0699670',
    logoPath: 'https://storage.googleapis.com/msgsndr/O4KZGhjFcY6IFdK8kLZE/media/6983731a4599869c35470e5e.png',
  },
  'QeDsxMGYS4IJAyVtGPgZ': {
    name: 'Star Senior Solutions',
    address: ['987 York Ave.', 'New York, NY 10028', 'United States'],
    website: 'tracy@startseniorsolutions.org',
    charityNumber: '02-0699671',
    logoPath: 'https://storage.googleapis.com/msgsndr/QeDsxMGYS4IJAyVtGPgZ/media/6855ccef50dfe62a2120f9f9.jpeg',
  },
  '4Nzcp3vUgVbOoN9uxu5F': {
    name: 'Chabad of the Valley',
    address: ['147 Valley Rd.', 'Phoenix, AZ 85001', 'United States'],
    website: 'www.chabadvalley.org',
    charityNumber: '02-0699672',
    logoPath: 'https://storage.googleapis.com/highlevel-backend.appspot.com/location/4Nzcp3vUgVbOoN9uxu5F/workflow/valley-logo.jpg',
  },
  'NikJ6tAcHSe8UCLgYMqM': {
    name: 'Benchmark Adventure Ministries',
    address: ['150 39th Avenue N', 'Nashville 37209', 'United States'],
    website: 'office@benchmark.org',
    charityNumber: '02-0699672',
    logoPath: 'https://assets.cdn.filesafe.space/NikJ6tAcHSe8UCLgYMqM/media/69a1887e917b4b6441eb6bf1.png',
  },
  'sNXq6gyPrArxiSrFEaaf': {
    name: 'Yeshiva Ohr David',
    address: ['', '', ''],
    website: 'www.ohrdavid.org',
    charityNumber: '',
    logoPath: '',
  },
};

// Safe fallback so a new tenant that isn't in the map above still gets a
// (generic) receipt instead of crashing the PDF generator with
// "Cannot read properties of undefined (reading 'name')".
const DEFAULT_LOCATION_CONFIG: LocationConfig = {
  name: 'Donation Receipt',
  address: ['', '', ''],
  website: '',
  charityNumber: '',
  logoPath: '',
};

export async function generatePDFReceipt(data: ReceiptData): Promise<Buffer> {
  const doc = new jsPDF();

  // Get location configuration
  const locationConfig =
    (data.locationId && locationConfigs[data.locationId]) ||
    locationConfigs['E7yO96aiKmYvsbU2tRzc'] ||
    DEFAULT_LOCATION_CONFIG;

  // === HEADER ===
  // Load the logo from location-specific URL or fallback to public/Logo.jpg
  try {
    let logoDataUri: string | null = null;

    if (locationConfig.logoPath) {
      // Download location-specific logo from URL
      logoDataUri = await downloadImageAsBase64(locationConfig.logoPath);
    }

    if (logoDataUri) {
      // Use downloaded logo
      doc.addImage(logoDataUri, 'JPEG', 15, 12, 25, 25);
    } else {
      // Fallback to public/Logo.jpg if no location-specific logo or download failed
      const publicLogoPath = path.join(process.cwd(), 'public', 'Logo.jpg');
      if (fs.existsSync(publicLogoPath)) {
        const imgBuffer = fs.readFileSync(publicLogoPath);
        const ext = path.extname(publicLogoPath).toLowerCase();
        const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
        const imgFormat: 'PNG' | 'JPEG' = mime.includes('png') ? 'PNG' : 'JPEG';
        logoDataUri = `data:${mime};base64,${imgBuffer.toString('base64')}`;
        doc.addImage(logoDataUri, imgFormat, 15, 12, 25, 25);
      }
    }
    // if file doesn't exist or URL fails, intentionally do nothing (no logo)
  } catch (err) {
    // If reading the logo fails, do not add any image. We avoid throwing
    // so PDF generation continues without a logo.
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(locationConfig.name, 195, 20, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  locationConfig.address.forEach((line, index) => {
    doc.text(line, 195, 26 + (index * 5), { align: 'right' });
  });
  doc.setTextColor(0, 0, 255);
  doc.text(locationConfig.website, 195, 41, { align: 'right' });
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
    `${data.currency} ${parseFloat(data.amount).toLocaleString('en-US', {
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
    `${data.currency} ${parseFloat(data.amount).toFixed(2)}`,
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
    `Registered Charity: ${locationConfig.charityNumber || '02-0699665'}`,
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
