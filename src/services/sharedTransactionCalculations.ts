import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { dbManager } from '../database/connection.js';
import { generateInvoiceBarcodeData } from './barcodeService.js';
import { getAppDataDir } from '../config/index.js';

export interface InvoiceBarcodeResponse {
  success: boolean;
  invoiceNo: string;
  barcodeText: string;
  qrDataUrl: string;
  code128DataUrl: string;
  pdfUrl: string;
}

/**
 * Shared helper to generate scannable barcode label (Code128 + QR) and printable PDF
 * for a sale invoice. Used by both /api/sales and /api/utilities.
 */
export async function generateSaleInvoiceBarcodeLabel(invoiceNo: string): Promise<InvoiceBarcodeResponse> {
  const db = await dbManager.getConnection();
  const invoice = await db.get(
    `SELECT si.invoice_no, si.date, si.total_amount, c.name as customer_name, c.phone as customer_phone
     FROM sales_invoices si
     LEFT JOIN customers c ON si.customer_id = c.id
     WHERE si.invoice_no = ? OR si.id = ?`,
    [invoiceNo, invoiceNo]
  );

  const actualInvoiceNo = invoice ? invoice.invoice_no : invoiceNo;
  const invoiceDate = invoice ? invoice.date : undefined;
  const barcodeData = await generateInvoiceBarcodeData(actualInvoiceNo, invoiceDate);

  // Fetch shop details from app_settings
  const settingsRows = await db.all('SELECT key, value FROM app_settings');
  const settings: Record<string, string> = {};
  settingsRows.forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });

  const shopName = settings.shop_name || 'AI PHARMACY OS';
  const shopPhone = settings.shop_phone || '';

  // Build printable PDF label
  const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const doc = new PDFDocument({ size: [350, 220], margin: 15 });
  const sanitizeNo = actualInvoiceNo.replace(/[^a-zA-Z0-9_-]/g, '_');
  const pdfPath = path.join(uploadsDir, `barcode_invoice_${sanitizeNo}_${Date.now()}.pdf`);
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  // Header
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#0284c7').text(shopName, { align: 'center' });
  if (shopPhone) {
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`Ph: ${shopPhone}`, { align: 'center' });
  }
  doc.moveDown(0.5);

  // Metadata
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(`Invoice: ${actualInvoiceNo}`, { align: 'center' });
  if (invoice) {
    const formattedDate = new Date(invoice.date).toLocaleDateString();
    const custText = invoice.customer_name ? `Customer: ${invoice.customer_name}` : 'Walk-in Customer';
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(`Date: ${formattedDate} | ${custText} | Total: ₹${Number(invoice.total_amount || 0).toFixed(2)}`, { align: 'center' });
  }

  doc.moveDown(0.5);

  // Render Barcodes
  const startY = doc.y;
  doc.image(barcodeData.qrBuffer, 25, startY, { width: 85, height: 85 });
  doc.image(barcodeData.code128Buffer, 125, startY + 10, { width: 200, height: 60 });
  doc.fontSize(7).fillColor('#94a3b8').text(`Scan Code128 or QR for return lookup (${barcodeData.barcodeText})`, 15, 195, { align: 'center' });
  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });

  return {
    success: true,
    invoiceNo: actualInvoiceNo,
    barcodeText: barcodeData.barcodeText,
    qrDataUrl: barcodeData.qrDataUrl,
    code128DataUrl: barcodeData.code128DataUrl,
    pdfUrl: `/uploads/${path.basename(pdfPath)}`
  };
}
