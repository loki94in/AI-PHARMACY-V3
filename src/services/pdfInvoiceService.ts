import PDFDocument from 'pdfkit';
import { dbManager } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getAppDataDir } from '../config/index.js';
import { generateInvoiceBarcodeData } from './barcodeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

export class PdfInvoiceService {
  async generateInvoicePdf(invoiceId: number, outPath: string, includeStampAndSig: boolean = true): Promise<void> {
    const db = await dbManager.getConnection();
    
    // Fetch settings
    await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    const settingsRows = await db.all('SELECT key, value FROM app_settings');
    const settings: Record<string, string> = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    // Fetch invoice details with doctor name
    const invoice = await db.get(
      `SELECT si.invoice_no, si.date, si.total_amount, si.tax_amount, si.payment_medium, si.payment_status, si.discount, si.subtotal,
              c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
              d.name as doctor_name
       FROM sales_invoices si
       LEFT JOIN customers c ON si.customer_id = c.id
       LEFT JOIN doctors d ON si.doctor_id = d.id
       WHERE si.id = ?`,
      [invoiceId]
    );

    if (!invoice) {
      throw new Error(`Invoice ID ${invoiceId} not found`);
    }

    // Fetch line items
    const items = await db.all(
      `SELECT si.quantity, si.unit_price, si.loose_qty, si.discount_per, m.name as medicine_name, COALESCE(m.pack_size, 1) as pack_size,
              im.batch_no
       FROM sale_items si
       JOIN inventory_master im ON si.inventory_id = im.id
       JOIN medicines m ON im.medicine_id = m.id
       WHERE si.invoice_id = ?`,
      [invoiceId]
    );

    const shopName = settings.pharmacy_name || settings.shop_name || settings.store_name || 'PHARMACY INVOICE';
    const shopAddress = settings.address || settings.shop_address || '';
    const shopPhone = settings.phone || settings.shop_phone || settings.pharmacy_phone || '';
    const shopLicence = settings.drug_license || settings.shop_licence || settings.license_number || settings.dl_number || settings.drug_licence_no || '';
    const shopGstin = settings.gstin || '';

    const barcodeData = await generateInvoiceBarcodeData(invoice.invoice_no, invoice.date);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 30 });
        const stream = fs.createWriteStream(outPath);
        stream.on('error', reject);
        stream.on('finish', resolve);
        doc.pipe(stream);

        // Header / Business Info
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#0284c7').text(shopName, { align: 'center' });
        if (shopAddress) {
          doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(shopAddress, { align: 'center' });
        }
        const contactParts = [];
        if (shopPhone) contactParts.push(`Phone: ${shopPhone}`);
        if (shopLicence) contactParts.push(`D.L. No: ${shopLicence}`);
        if (shopGstin) contactParts.push(`GSTIN: ${shopGstin}`);
        if (contactParts.length > 0) {
          doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(contactParts.join(' | '), { align: 'center' });
        }
        doc.moveDown(0.8);

        // Divider
        doc.moveTo(30, doc.y).lineTo(565, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
        doc.moveDown(0.6);

        // Invoice Metadata & Customer Info
        const infoTop = doc.y;
        doc.fontSize(9).fillColor('#0f172a');
        
        // Left Column: Invoice Details & Doctor Info
        doc.font('Helvetica-Bold').text(`Invoice No: `, 30, infoTop, { continued: true }).font('Helvetica').text(invoice.invoice_no);
        doc.font('Helvetica-Bold').text(`Date: `, 30, doc.y + 3, { continued: true }).font('Helvetica').text(new Date(invoice.date).toLocaleString('en-IN'));
        doc.font('Helvetica-Bold').text(`Payment: `, 30, doc.y + 3, { continued: true }).font('Helvetica').text(`${invoice.payment_medium || 'CASH'} (${invoice.payment_status || 'PAID'})`);
        
        const docNameRaw = (invoice.doctor_name || '').trim();
        if (docNameRaw) {
          const docDisplayName = docNameRaw.toLowerCase().startsWith('dr') ? docNameRaw : `Dr. ${docNameRaw}`;
          doc.font('Helvetica-Bold').fillColor('#0284c7').text(`Prescribed By: `, 30, doc.y + 3, { continued: true }).font('Helvetica-Bold').text(docDisplayName);
        }

        // Right Column: Customer Details
        doc.fillColor('#0f172a');
        doc.font('Helvetica-Bold').text('Billed To:', 320, infoTop);
        doc.font('Helvetica').text(`Name: ${invoice.customer_name || 'Walk-in Customer'}`, 320, doc.y + 3);
        if (invoice.customer_phone) {
          doc.text(`Phone: ${invoice.customer_phone}`, 320, doc.y + 3);
        }
        if (invoice.customer_address) {
          doc.text(`Address: ${invoice.customer_address}`, 320, doc.y + 3);
        }

        doc.moveDown(1.2);

        // Table Header
        const tableTop = doc.y;
        doc.fontSize(8.5).fillColor('#64748b').font('Helvetica-Bold');
        doc.text('Medicine / Product Name', 30, tableTop, { width: 200 });
        doc.text('Batch No.', 235, tableTop, { width: 80 });
        doc.text('Qty', 320, tableTop, { width: 55, align: 'right' });
        doc.text('Unit Price', 380, tableTop, { width: 85, align: 'right' });
        doc.text('Total', 470, tableTop, { width: 95, align: 'right' });
        
        doc.moveTo(30, tableTop + 12).lineTo(565, tableTop + 12).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(0.8);

        // Line Items
        items.forEach(item => {
          const itemY = doc.y;
          doc.fontSize(8.5).fillColor('#0f172a').font('Helvetica');
          
          const discPer = item.discount_per || 0;
          const discountedPrice = item.unit_price * (1 - discPer / 100);
          const packSize = item.pack_size || 1;
          const looseQty = item.loose_qty || 0;
          const itemTotal = (discountedPrice * item.quantity) + ((discountedPrice / packSize) * looseQty);
          
          const nameText = discPer > 0 
            ? `${item.medicine_name} (${discPer}% Off)` 
            : item.medicine_name;
            
          doc.text(nameText, 30, itemY, { width: 200 });
          doc.text(item.batch_no ? String(item.batch_no) : '-', 235, itemY, { width: 80 });
          
          const qtyText = looseQty > 0 
            ? `${item.quantity} S + ${looseQty} L` 
            : String(item.quantity);
          doc.text(qtyText, 320, itemY, { width: 55, align: 'right' });
          
          doc.text(`₹${discountedPrice.toFixed(2)}`, 380, itemY, { width: 85, align: 'right' });
          doc.text(`₹${itemTotal.toFixed(2)}`, 470, itemY, { width: 95, align: 'right' });
          doc.moveDown(0.9);
        });

        // Totals Section
        doc.moveDown(0.5);
        doc.moveTo(380, doc.y).lineTo(565, doc.y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
        doc.moveDown(0.4);
        
        let discount = invoice.discount || 0;
        let tax = invoice.tax_amount || 0;
        let total = invoice.total_amount;
        let subtotal = total - tax;

        // Credit Bill Sharing: If payment_medium is CREDIT, share without discount amount
        if (invoice.payment_medium === 'CREDIT' && discount > 0) {
          subtotal = invoice.subtotal || (invoice.total_amount + discount - invoice.tax_amount);
          tax = invoice.tax_amount || 0;
          total = subtotal + tax;
          discount = 0; // hide discount for CREDIT
        } else if (discount > 0) {
          const subtotalInclusive = invoice.subtotal || (invoice.total_amount + discount);
          subtotal = subtotalInclusive / 1.05;
          tax = invoice.tax_amount || 0;
          total = invoice.total_amount;
        }

        doc.fontSize(8.5).fillColor('#64748b').font('Helvetica');
        doc.text('Subtotal:', 380, doc.y, { width: 85, align: 'right' });
        doc.fillColor('#0f172a').text(`₹${subtotal.toFixed(2)}`, 470, doc.y - 9, { width: 95, align: 'right' });
        
        if (discount > 0 && invoice.payment_medium !== 'CREDIT') {
          const discountExclusive = discount / 1.05;
          doc.moveDown(0.3);
          doc.fillColor('#64748b').text('Discount:', 380, doc.y, { width: 85, align: 'right' });
          doc.fillColor('#e11d48').text(`-₹${discountExclusive.toFixed(2)}`, 470, doc.y - 9, { width: 95, align: 'right' });
        }

        doc.moveDown(0.3);
        doc.fillColor('#64748b').text('Tax (5%):', 380, doc.y, { width: 85, align: 'right' });
        doc.fillColor('#0f172a').text(`₹${tax.toFixed(2)}`, 470, doc.y - 9, { width: 95, align: 'right' });
        
        doc.moveDown(0.5);
        const grandTotalY = doc.y;
        doc.fontSize(11).fillColor('#0f172a').font('Helvetica-Bold');
        doc.text('Grand Total:', 360, grandTotalY, { width: 105, align: 'right' });
        doc.text(`₹${total.toFixed(2)}`, 470, grandTotalY, { width: 95, align: 'right' });

        // Draw Scannable Invoice Barcode (QR + Code128) - Left Side
        const barcodeY = Math.min(Math.max(doc.y + 15, 660), 730);
        try {
          doc.image(barcodeData.qrBuffer, 30, barcodeY, { width: 48, height: 48 });
          doc.image(barcodeData.code128Buffer, 88, barcodeY + 2, { width: 130, height: 40 });
          doc.fontSize(6.5).font('Helvetica').fillColor('#64748b').text(`Scannable Bill Barcode: ${barcodeData.barcodeText}`, 30, barcodeY + 50);
        } catch (bcErr) {
          console.warn('[PdfInvoice] Failed to embed barcode image in PDF:', bcErr);
        }

        // Custom stamp & signature files
        const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
        const customStampPath = path.join(uploadsDir, 'custom_stamp.png');
        const customSigPath = path.join(uploadsDir, 'custom_signature.png');

        if (includeStampAndSig) {
          // Dynamic Placement Coordinates (Configurable via Stamp Studio)
          const defaultStampX = 410;
          const defaultStampY = Math.min(Math.max(grandTotalY + 5, 540), 650);
          const stampX = settings.stamp_pos_x ? Math.max(30, Math.min(500, parseFloat(settings.stamp_pos_x))) : defaultStampX;
          const stampY = settings.stamp_pos_y ? Math.max(300, Math.min(680, parseFloat(settings.stamp_pos_y))) : defaultStampY;
          const stampScale = settings.stamp_scale ? parseFloat(settings.stamp_scale) : 100;
          const stampWidth = Math.round(80 * (stampScale / 100));
          const stampRot = settings.stamp_rotation !== undefined ? parseFloat(settings.stamp_rotation) : -12;

          if (fs.existsSync(customStampPath)) {
            doc.save();
            if (stampRot !== 0) {
              doc.rotate(stampRot, { origin: [stampX + stampWidth / 2, stampY + stampWidth / 2] });
            }
            doc.image(customStampPath, stampX, stampY, { width: stampWidth });
            doc.restore();
          } else {
            // DRAW DIGITAL PHARMACY STAMP at configured position
            doc.save();
            doc.translate(stampX + stampWidth / 2, stampY + stampWidth / 2);
            doc.rotate(stampRot);
            
            const radiusOuter = Math.round(34 * (stampScale / 100));
            const radiusInner = Math.round(30 * (stampScale / 100));
            const stampColor = invoice.payment_status === 'UNPAID' ? '#f59e0b' : '#10b981';
            doc.strokeColor(stampColor).lineWidth(1.5);
            doc.circle(0, 0, radiusOuter).stroke();
            doc.circle(0, 0, radiusInner).stroke();
            
            doc.fillColor(stampColor).fontSize(6 * (stampScale / 100)).font('Helvetica');
            doc.text(shopName, -30 * (stampScale / 100), -16 * (stampScale / 100), { width: 60 * (stampScale / 100), align: 'center' });
            
            doc.fontSize(7 * (stampScale / 100));
            if (invoice.payment_status === 'UNPAID') {
              doc.font('Helvetica-Bold').text('CREDIT ACCOUNT', -30 * (stampScale / 100), -3 * (stampScale / 100), { width: 60 * (stampScale / 100), align: 'center' });
              doc.font('Helvetica').fontSize(6 * (stampScale / 100)).text('PAYMENT PENDING', -30 * (stampScale / 100), 8 * (stampScale / 100), { width: 60 * (stampScale / 100), align: 'center' });
            } else {
              doc.font('Helvetica-Bold').text('PAID & VERIFIED', -30 * (stampScale / 100), -3 * (stampScale / 100), { width: 60 * (stampScale / 100), align: 'center' });
              doc.font('Helvetica').fontSize(6 * (stampScale / 100)).text('THANK YOU', -30 * (stampScale / 100), 8 * (stampScale / 100), { width: 60 * (stampScale / 100), align: 'center' });
            }
            
            doc.restore();
          }

          // Render Signature with configured position & scale
          const defaultSigX = 425;
          const defaultSigY = barcodeY - 5;
          const sigX = settings.sig_pos_x ? Math.max(30, Math.min(500, parseFloat(settings.sig_pos_x))) : defaultSigX;
          const sigY = settings.sig_pos_y ? Math.max(300, Math.min(720, parseFloat(settings.sig_pos_y))) : defaultSigY;
          const sigScale = settings.sig_scale ? parseFloat(settings.sig_scale) : 100;
          const sigWidth = Math.round(75 * (sigScale / 100));

          if (fs.existsSync(customSigPath)) {
            doc.image(customSigPath, sigX, sigY, { width: sigWidth });
          }
          doc.moveTo(sigX - 10, sigY + 48).lineTo(sigX + sigWidth + 10, sigY + 48).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
          doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#475569').text('Authorized Signatory', sigX - 10, sigY + 51, { width: sigWidth + 20, align: 'center' });
        } else {
          const sigX = 430;
          const sigY = barcodeY + 25;
          doc.moveTo(sigX, sigY).lineTo(sigX + 110, sigY).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
          doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#475569').text('Authorized Signatory', sigX, sigY + 4, { width: 110, align: 'center' });
        }

        // Single-Page Footer Guarantee: Anchored dynamically near bottom of A4 page
        doc.fontSize(7.5).fillColor('#94a3b8').font('Helvetica').text(
          includeStampAndSig ? 'This is a computer generated document. Stamped digitally.' : 'This is an official document. Signed and stamped manually.',
          30,
          doc.page.height - 25,
          { align: 'center', width: doc.page.width - 60 }
        );

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generate an itemized Customer Credit Ledger / Statement PDF
   */
  async generateCreditStatementPdf(customerId: number, outPath: string): Promise<void> {
    const db = await dbManager.getConnection();
    const settingsRows = await db.all('SELECT key, value FROM app_settings');
    const settings: Record<string, string> = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
    if (!customer) {
      throw new Error(`Customer ID ${customerId} not found`);
    }

    const pendingInvoices = await db.all(
      `SELECT si.invoice_no, si.date, si.total_amount, si.payment_status
       FROM sales_invoices si
       WHERE si.customer_id = ? AND (si.payment_medium = 'CREDIT' OR si.payment_status = 'UNPAID' OR si.payment_status = 'PENDING') AND si.payment_status != 'PAID'
       ORDER BY si.date ASC, si.id ASC`,
      [customerId]
    );

    const shopName = settings.pharmacy_name || settings.shop_name || settings.store_name || 'PHARMACY CREDIT LEDGER';
    const shopAddress = settings.address || settings.shop_address || '';
    const shopPhone = settings.phone || settings.shop_phone || settings.pharmacy_phone || '';
    const shopLicence = settings.drug_license || settings.shop_licence || settings.license_number || settings.dl_number || settings.drug_licence_no || '';
    const shopGstin = settings.gstin || '';

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 30 });
        const stream = fs.createWriteStream(outPath);
        stream.on('error', reject);
        stream.on('finish', resolve);
        doc.pipe(stream);

        // Header
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#0284c7').text(shopName, { align: 'center' });
        if (shopAddress) {
          doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(shopAddress, { align: 'center' });
        }
        const contactParts = [];
        if (shopPhone) contactParts.push(`Phone: ${shopPhone}`);
        if (shopLicence) contactParts.push(`D.L. No: ${shopLicence}`);
        if (shopGstin) contactParts.push(`GSTIN: ${shopGstin}`);
        if (contactParts.length > 0) {
          doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(contactParts.join(' | '), { align: 'center' });
        }
        doc.moveDown(0.8);
        doc.moveTo(30, doc.y).lineTo(565, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
        doc.moveDown(0.8);

        // Document Title
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('CUSTOMER CREDIT STATEMENT & LEDGER SUMMARY', { align: 'center' });
        doc.moveDown(0.8);

        // Customer Info
        const infoTop = doc.y;
        doc.fontSize(9).fillColor('#0f172a');
        doc.font('Helvetica-Bold').text('Customer Details:', 30, infoTop);
        doc.font('Helvetica').text(`Name: ${customer.name || 'Customer'}`, 30, doc.y + 3);
        if (customer.phone) doc.text(`Phone: ${customer.phone}`, 30, doc.y + 3);
        if (customer.address) doc.text(`Address: ${customer.address}`, 30, doc.y + 3);

        const dueDateStr = customer.credit_due_date ? new Date(customer.credit_due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'As agreed';
        doc.font('Helvetica-Bold').text('Account Summary:', 320, infoTop);
        doc.font('Helvetica').text(`Statement Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 320, doc.y + 3);
        doc.text(`Due Date: ${dueDateStr}`, 320, doc.y + 3);
        const creditBal = Number(customer.credit_balance || 0);
        doc.font('Helvetica-Bold').fillColor('#e11d48').text(`Outstanding Balance: ₹${creditBal.toFixed(2)}`, 320, doc.y + 3);

        doc.moveDown(1.2);

        // Table of Unpaid Invoices
        const tableTop = doc.y;
        doc.fontSize(8.5).fillColor('#64748b').font('Helvetica-Bold');
        doc.text('Bill / Invoice #', 30, tableTop, { width: 160 });
        doc.text('Date', 200, tableTop, { width: 110 });
        doc.text('Status', 320, tableTop, { width: 110 });
        doc.text('Amount (₹)', 440, tableTop, { width: 125, align: 'right' });

        doc.moveTo(30, tableTop + 12).lineTo(565, tableTop + 12).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(0.8);

        let totalCalculated = 0;
        if (pendingInvoices.length > 0) {
          pendingInvoices.forEach(inv => {
            const itemY = doc.y;
            doc.fontSize(8.5).fillColor('#0f172a').font('Helvetica');
            const amt = Number(inv.total_amount || 0);
            totalCalculated += amt;
            const dFormatted = inv.date ? new Date(inv.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
            doc.text(inv.invoice_no, 30, itemY, { width: 160 });
            doc.text(dFormatted, 200, itemY, { width: 110 });
            doc.text(inv.payment_status || 'UNPAID', 320, itemY, { width: 110 });
            doc.text(`₹${amt.toFixed(2)}`, 440, itemY, { width: 125, align: 'right' });
            doc.moveDown(0.9);
          });
        } else {
          doc.fontSize(8.5).fillColor('#64748b').font('Helvetica').text('No pending credit bills recorded.', 30, doc.y, { align: 'center' });
          doc.moveDown(1.2);
        }

        doc.moveTo(30, doc.y).lineTo(565, doc.y).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(0.8);

        const finalTotal = creditBal > 0 ? creditBal : totalCalculated;
        doc.fontSize(11).fillColor('#0f172a').font('Helvetica-Bold');
        doc.text('Total Outstanding Payable:', 250, doc.y, { width: 180, align: 'right' });
        doc.fillColor('#e11d48').text(`₹${finalTotal.toFixed(2)}`, 440, doc.y - 11, { width: 125, align: 'right' });

        // Digital stamp placed on bottom right over total area
        const stampY = Math.min(Math.max(doc.y + 15, 650), 730);
        doc.save();
        doc.translate(480, stampY);
        doc.rotate(-10);
        doc.strokeColor('#f59e0b').lineWidth(1.8);
        doc.circle(0, 0, 32).stroke();
        doc.fillColor('#f59e0b').fontSize(6.5).font('Helvetica-Bold');
        doc.text('CREDIT ACCOUNT', -28, -8, { width: 56, align: 'center' });
        doc.text('STATEMENT', -28, 2, { width: 56, align: 'center' });
        doc.restore();

        // Dynamic footer
        doc.fontSize(7.5).fillColor('#94a3b8').font('Helvetica').text(
          'This is an official pharmacy credit ledger statement. Stamped digitally.',
          30,
          doc.page.height - 25,
          { align: 'center', width: doc.page.width - 60 }
        );

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generate a Patient Refill Reminder / Advisory Slip PDF
   */
  async generateRefillSchedulePdf(refillId: number, outPath: string): Promise<void> {
    const db = await dbManager.getConnection();
    const settingsRows = await db.all('SELECT key, value FROM app_settings');
    const settings: Record<string, string> = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    const refill = await db.get(
      `SELECT pr.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
       FROM patient_refills pr
       LEFT JOIN customers c ON pr.customer_id = c.id
       WHERE pr.id = ?`,
      [refillId]
    );

    if (!refill) {
      throw new Error(`Refill record ID ${refillId} not found`);
    }

    const shopName = settings.pharmacy_name || settings.shop_name || settings.store_name || 'AI PHARMACY CARE';
    const shopAddress = settings.address || settings.shop_address || '';
    const shopPhone = settings.phone || settings.shop_phone || settings.pharmacy_phone || '';
    const shopLicence = settings.drug_license || settings.shop_licence || settings.license_number || settings.dl_number || settings.drug_licence_no || '';
    const shopGstin = settings.gstin || '';

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 30 });
        const stream = fs.createWriteStream(outPath);
        stream.on('error', reject);
        stream.on('finish', resolve);
        doc.pipe(stream);

        // Header
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#0284c7').text(shopName, { align: 'center' });
        if (shopAddress) {
          doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(shopAddress, { align: 'center' });
        }
        const contactParts = [];
        if (shopPhone) contactParts.push(`Helpline: ${shopPhone}`);
        if (shopLicence) contactParts.push(`D.L. No: ${shopLicence}`);
        if (shopGstin) contactParts.push(`GSTIN: ${shopGstin}`);
        if (contactParts.length > 0) {
          doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(contactParts.join(' | '), { align: 'center' });
        }
        doc.moveDown(0.8);
        doc.moveTo(30, doc.y).lineTo(565, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
        doc.moveDown(0.8);

        // Title
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('PRESCRIPTION REFILL ADVISORY & SCHEDULE', { align: 'center' });
        doc.moveDown(1);

        // Patient details
        const infoTop = doc.y;
        doc.fontSize(9).fillColor('#0f172a');
        doc.font('Helvetica-Bold').text('Patient Information:', 30, infoTop);
        doc.font('Helvetica').text(`Name: ${refill.patient_name || refill.customer_name || 'Patient'}`, 30, doc.y + 3);
        doc.text(`Phone: ${refill.patient_phone || refill.customer_phone || '-'}`, 30, doc.y + 3);

        const nextDateStr = refill.next_refill_date ? new Date(refill.next_refill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Immediate';
        doc.font('Helvetica-Bold').text('Refill Schedule Details:', 320, infoTop);
        doc.font('Helvetica').text(`Refill Due Date: ${nextDateStr}`, 320, doc.y + 3);
        doc.text(`Cycle Interval: ${refill.refill_days || 30} Days`, 320, doc.y + 3);

        doc.moveDown(1.2);

        // Medicine details
        const tableTop = doc.y;
        doc.fontSize(8.5).fillColor('#64748b').font('Helvetica-Bold');
        doc.text('Prescribed Medicine', 30, tableTop, { width: 280 });
        doc.text('Dosage / Frequency', 320, tableTop, { width: 130 });
        doc.text('Quantity', 460, tableTop, { width: 105, align: 'right' });

        doc.moveTo(30, tableTop + 12).lineTo(565, tableTop + 12).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(0.8);

        const medY = doc.y;
        doc.fontSize(9).fillColor('#0f172a').font('Helvetica');
        doc.text(refill.medicine_name || 'Prescribed Medicine', 30, medY, { width: 280 });
        doc.text(refill.dosage || 'As directed', 320, medY, { width: 130 });
        doc.text(String(refill.quantity_needed || refill.quantity || 1), 460, medY, { width: 105, align: 'right' });
        doc.moveDown(1.5);

        doc.fontSize(8.5).fillColor('#0284c7').font('Helvetica-Bold').text('Refill Advisory Note:');
        doc.fontSize(8.5).fillColor('#334155').font('Helvetica').text(
          'To ensure uninterrupted course continuity of your essential medications, please collect your scheduled refill at your earliest convenience or contact our pharmacy desk for prompt delivery.',
          { width: 535, align: 'justify' }
        );

        // Dynamic footer
        doc.fontSize(7.5).fillColor('#94a3b8').font('Helvetica').text(
          'This is a verified pharmacy refill advisory slip.',
          30,
          doc.page.height - 25,
          { align: 'center', width: doc.page.width - 60 }
        );

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generate Special Order Arrival / Collection Slip PDF
   */
  async generateSpecialOrderSlipPdf(orderId: number, outPath: string): Promise<void> {
    const db = await dbManager.getConnection();
    const settingsRows = await db.all('SELECT key, value FROM app_settings');
    const settings: Record<string, string> = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) {
      throw new Error(`Special Order ID ${orderId} not found`);
    }

    const shopName = settings.pharmacy_name || settings.shop_name || settings.store_name || 'AI PHARMACY';
    const shopAddress = settings.address || settings.shop_address || '';
    const shopPhone = settings.phone || settings.shop_phone || settings.pharmacy_phone || '';
    const shopLicence = settings.drug_license || settings.shop_licence || settings.license_number || settings.dl_number || settings.drug_licence_no || '';
    const shopGstin = settings.gstin || '';

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 30 });
        const stream = fs.createWriteStream(outPath);
        stream.on('error', reject);
        stream.on('finish', resolve);
        doc.pipe(stream);

        // Header
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#0284c7').text(shopName, { align: 'center' });
        if (shopAddress) {
          doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(shopAddress, { align: 'center' });
        }
        const contactParts = [];
        if (shopPhone) contactParts.push(`Phone: ${shopPhone}`);
        if (shopLicence) contactParts.push(`D.L. No: ${shopLicence}`);
        if (shopGstin) contactParts.push(`GSTIN: ${shopGstin}`);
        if (contactParts.length > 0) {
          doc.font('Helvetica').fontSize(8.5).fillColor('#64748b').text(contactParts.join(' | '), { align: 'center' });
        }
        doc.moveDown(0.8);
        doc.moveTo(30, doc.y).lineTo(565, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
        doc.moveDown(0.8);

        // Title
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('SPECIAL MEDICINE ORDER ARRIVAL & PICKUP SLIP', { align: 'center' });
        doc.moveDown(1);

        // Order & Customer Details
        const infoTop = doc.y;
        doc.fontSize(9).fillColor('#0f172a');
        doc.font('Helvetica-Bold').text('Customer Details:', 30, infoTop);
        doc.font('Helvetica').text(`Name: ${order.requester || 'Customer'}`, 30, doc.y + 3);
        doc.text(`Phone: ${order.phone || '-'}`, 30, doc.y + 3);

        doc.font('Helvetica-Bold').text('Order Details:', 320, infoTop);
        doc.font('Helvetica').text(`Order Reference: #SO-${order.id}`, 320, doc.y + 3);
        doc.text(`Arrival Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 320, doc.y + 3);
        doc.font('Helvetica-Bold').fillColor('#10b981').text('Status: READY FOR PICKUP', 320, doc.y + 3);

        doc.moveDown(1.2);

        // Product item table
        const tableTop = doc.y;
        doc.fontSize(8.5).fillColor('#64748b').font('Helvetica-Bold');
        doc.text('Requested Product / Medicine', 30, tableTop, { width: 370 });
        doc.text('Quantity', 410, tableTop, { width: 155, align: 'right' });

        doc.moveTo(30, tableTop + 12).lineTo(565, tableTop + 12).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(0.8);

        const prodY = doc.y;
        doc.fontSize(9.5).fillColor('#0f172a').font('Helvetica-Bold');
        doc.text(order.product || 'Special Requested Medicine', 30, prodY, { width: 370 });
        doc.text(`${order.qty || 1} units`, 410, prodY, { width: 155, align: 'right' });
        doc.moveDown(1.5);

        doc.fontSize(8.5).fillColor('#0284c7').font('Helvetica-Bold').text('Pickup Instructions:');
        doc.fontSize(8.5).fillColor('#334155').font('Helvetica').text(
          'Your specially requested medicine has arrived and is securely reserved at the pharmacy counter. Please present this slip or your phone number upon collection.',
          { width: 535, align: 'justify' }
        );

        // Dynamic footer
        doc.fontSize(7.5).fillColor('#94a3b8').font('Helvetica').text(
          'This is an authentic pharmacy collection slip.',
          30,
          doc.page.height - 25,
          { align: 'center', width: doc.page.width - 60 }
        );

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

export const pdfInvoiceService = new PdfInvoiceService();

