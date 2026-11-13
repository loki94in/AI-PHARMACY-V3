import { dbManager } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
// import { fileURLToPath } from 'url';
import { pdfInvoiceService } from './pdfInvoiceService.js';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';
// import { isReady } from '../whatsappClient.js';
import { getAppDataDir } from '../config/index.js';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const UPLOADS_DIR = path.resolve(getAppDataDir(), 'uploads');

export class WhatsappInvoiceService {
  async sendInvoiceViaWhatsApp(invoiceId: number, options?: { isConversion?: boolean }): Promise<boolean> {
    let db;
    try {
      db = await dbManager.getConnection();

      const enabledRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_wa_invoice_pdf_enabled'");
      if (enabledRow?.value === 'false') {
        console.log(`Invoice WhatsApp delivery automation disabled — skipping send for invoice ID ${invoiceId}`);
        return false;
      }

      const invoice = await db.get(
        `SELECT si.invoice_no, si.date, si.total_amount, si.payment_medium, si.payment_status, si.customer_id,
                si.customer_name_snapshot, si.customer_phone_snapshot,
                c.name as customer_name, c.phone as customer_phone, c.credit_balance, c.language as customer_language
         FROM sales_invoices si
         LEFT JOIN customers c ON si.customer_id = c.id
         WHERE si.id = ?`,
        [invoiceId]
      );

      if (!invoice) {
        console.error(`Invoice ID ${invoiceId} not found for WhatsApp dispatch`);
        return false;
      }

      const customerName = (invoice.customer_name || invoice.customer_name_snapshot || 'Customer').trim();
      let phone = (invoice.customer_phone || invoice.customer_phone_snapshot || '').trim();
      if (!phone && invoice.customer_id) {
        const custRow = await db.get('SELECT phone, language, credit_balance FROM customers WHERE id = ?', [invoice.customer_id]);
        phone = (custRow?.phone || '').trim();
        if (!invoice.customer_language && custRow?.language) {
          invoice.customer_language = custRow.language;
        }
        if (custRow?.credit_balance !== undefined && custRow?.credit_balance !== null) {
          invoice.credit_balance = custRow.credit_balance;
        }
      }

      const rawDigits = phone.replace(/\D/g, '');
      const cleanPhone = rawDigits.length === 12 && rawDigits.startsWith('91')
        ? rawDigits.slice(2)
        : (rawDigits.length > 10 ? rawDigits.slice(-10) : rawDigits);

      if (!cleanPhone || cleanPhone.length !== 10) {
        console.warn(`No valid 10-digit phone number available for customer in Invoice ID ${invoiceId}. Skipping WhatsApp.`);
        return false;
      }

      // Format instant WhatsApp text message
      const formatDate = (dStr?: string) => {
        if (!dStr) return '';
        try {
          const d = new Date(dStr);
          return isNaN(d.getTime()) ? dStr : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch {
          return dStr || '';
        }
      };

      const formattedDate = formatDate(invoice.date || new Date().toISOString());
      const rawLang = String(invoice.customer_language || 'mr').toLowerCase().trim();
      const lang = rawLang.startsWith('hi') ? 'hi' : rawLang.startsWith('en') ? 'en' : 'mr';
      const isConversion = Boolean(options?.isConversion);

      let recentBillsText = '';
      const isCredit = invoice.payment_medium === 'CREDIT' || invoice.payment_status === 'UNPAID';
      const totalDues = Number(invoice.credit_balance !== undefined && invoice.credit_balance !== null ? invoice.credit_balance : (invoice.total_amount || 0));

      if (isCredit && invoice.customer_id) {
        try {
          const creditRows = await db.all(
            `SELECT id, invoice_no, date, total_amount 
             FROM sales_invoices 
             WHERE customer_id = ? AND (payment_medium = 'CREDIT' OR payment_status IN ('UNPAID', 'PENDING'))
             ORDER BY id DESC LIMIT 4`,
            [invoice.customer_id]
          );
          if (creditRows && creditRows.length > 0) {
            const headerLabel = lang === 'mr' ? '📜 *मागील उधारी बिले:*' : lang === 'hi' ? '📜 *पिछले उधार बिल:*' : '📜 *Recent Credit Bills:*';
            recentBillsText += `${headerLabel}\n`;
            creditRows.forEach((r: any, idx: number) => {
              const rDate = formatDate(r.date);
              const isCurrent = r.id === invoiceId || r.invoice_no === invoice.invoice_no;
              const curTag = isCurrent ? (lang === 'mr' ? ' [सध्याचे]' : lang === 'hi' ? ' [वर्तमान]' : ' [Current]') : '';
              recentBillsText += `${idx + 1}. *#${r.invoice_no}* (${rDate}) — ₹${Number(r.total_amount || 0).toFixed(2)}${curTag}\n`;
            });
            recentBillsText += `\n`;
          }
        } catch (histErr) {
          console.warn('[WhatsappInvoiceService] Could not fetch recent credit bills history:', histErr);
        }
      }

      let caption = '';
      if (lang === 'mr') {
        caption = `सस्नेह नमस्कार ${customerName},\n\n`;
        if (isConversion) {
          caption += `📌 *उधारी खात्यावर वर्ग (Cash to Credit) नोंद*\n\n`;
          caption += `🧾 *बिल (#${invoice.invoice_no}) उधारी खात्यावर नोंदवले गेले आहे.*\n`;
          caption += `• तारीख: *${formattedDate}*\n`;
          caption += `• बिलाची रक्कम: *₹${Number(invoice.total_amount || 0).toFixed(2)}*\n\n`;
          if (recentBillsText) caption += recentBillsText;
          caption += `💰 *एकूण बाकी रक्कम: ₹${totalDues.toFixed(2)}*\n\n`;
          caption += `📎 सविस्तर बिलाची PDF प्रत वरील फाईलमध्ये जोडली आहे.\n`;
          caption += `हे बिल आपल्या उधारी खात्यावर वर्ग करण्यात आले आहे.\n`;
        } else if (isCredit) {
          caption += `📌 *उधारी खरेदी बिल व खात्याचा तपशील*\n\n`;
          caption += `🧾 *सध्याचे बिल (#${invoice.invoice_no})*\n`;
          caption += `• तारीख: *${formattedDate}*\n`;
          caption += `• बिलाची रक्कम: *₹${Number(invoice.total_amount || 0).toFixed(2)}*\n\n`;
          if (recentBillsText) caption += recentBillsText;
          caption += `💰 *एकूण बाकी रक्कम: ₹${totalDues.toFixed(2)}*\n\n`;
          caption += `📎 सविस्तर बिलाची PDF प्रत वरील फाईलमध्ये जोडली आहे.\n`;
          caption += `हे बिल आपल्या उधारी खात्यावर नोंदवले गेले आहे.\n`;
        } else {
          caption += `📄 *विक्री बिल: #${invoice.invoice_no}*\n`;
          caption += `भरलेली रक्कम: *₹${Number(invoice.total_amount || 0).toFixed(2)}*\n\n`;
          caption += `आपल्या खरेदीबद्दल मनःपूर्वक धन्यवाद! 🙏\n\n`;
        }
        caption += `— AI Pharmacy OS`;
      } else if (lang === 'hi') {
        caption = `नमस्ते ${customerName},\n\n`;
        if (isConversion) {
          caption += `📌 *उधार खाते में अंतरण (Cash to Credit) सूचना*\n\n`;
          caption += `🧾 *बिल (#${invoice.invoice_no}) उधार खाते में दर्ज किया गया है।*\n`;
          caption += `• दिनांक: *${formattedDate}*\n`;
          caption += `• बिल राशि: *₹${Number(invoice.total_amount || 0).toFixed(2)}*\n\n`;
          if (recentBillsText) caption += recentBillsText;
          caption += `💰 *कुल बकाया राशि: ₹${totalDues.toFixed(2)}*\n\n`;
          caption += `📎 विस्तृत दवा बिल PDF ऊपर संलग्न है।\n`;
          caption += `यह बिल आपके उधार खाते में दर्ज कर दिया गया है।\n`;
        } else if (isCredit) {
          caption += `📌 *उधार खरीद बिल एवं खाता विवरण*\n\n`;
          caption += `🧾 *वर्तमान बिल (#${invoice.invoice_no})*\n`;
          caption += `• दिनांक: *${formattedDate}*\n`;
          caption += `• बिल राशि: *₹${Number(invoice.total_amount || 0).toFixed(2)}*\n\n`;
          if (recentBillsText) caption += recentBillsText;
          caption += `💰 *कुल बकाया राशि: ₹${totalDues.toFixed(2)}*\n\n`;
          caption += `📎 विस्तृत दवा बिल PDF ऊपर संलग्न है।\n`;
          caption += `यह बिल आपके उधार खाते में दर्ज कर दिया गया है।\n`;
        } else {
          caption += `📄 *बिक्री बिल: #${invoice.invoice_no}*\n`;
          caption += `भुगतान की गई राशि: *₹${Number(invoice.total_amount || 0).toFixed(2)}*\n\n`;
          caption += `आपकी खरीद के लिए बहुत-बहुत धन्यवाद! 🙏\n\n`;
        }
        caption += `— AI Pharmacy OS`;
      } else {
        caption = `Dear ${customerName},\n\n`;
        if (isConversion) {
          caption += `📌 *Credit Conversion Notice (Cash to Credit)*\n\n`;
          caption += `🧾 *Bill (#${invoice.invoice_no}) has been converted & posted to your credit ledger account.*\n`;
          caption += `• Date: *${formattedDate}*\n`;
          caption += `• Bill Amount: *₹${Number(invoice.total_amount || 0).toFixed(2)}*\n\n`;
          if (recentBillsText) caption += recentBillsText;
          caption += `💰 *Total Outstanding Balance: ₹${totalDues.toFixed(2)}*\n\n`;
          caption += `📎 Detailed medicine invoice is attached in the PDF above.\n`;
          caption += `This bill has been posted to your credit ledger account.\n`;
        } else if (isCredit) {
          caption += `📌 *Credit Purchase Bill & Account Summary*\n\n`;
          caption += `🧾 *Current Bill (#${invoice.invoice_no})*\n`;
          caption += `• Date: *${formattedDate}*\n`;
          caption += `• Bill Amount: *₹${Number(invoice.total_amount || 0).toFixed(2)}*\n\n`;
          if (recentBillsText) caption += recentBillsText;
          caption += `💰 *Total Outstanding Balance: ₹${totalDues.toFixed(2)}*\n\n`;
          caption += `📎 Detailed medicine invoice is attached in the PDF above.\n`;
          caption += `This bill has been posted to your credit ledger account.\n`;
        } else {
          caption += `📄 *Sale Invoice: #${invoice.invoice_no}*\n`;
          caption += `Bill Amount Paid: *₹${Number(invoice.total_amount || 0).toFixed(2)}*\n\n`;
          caption += `Thank you for your purchase! 🙏\n\n`;
        }
        caption += `— AI Pharmacy OS`;
      }

      // Generate PDF attachment
      let pdfPath: string | undefined = undefined;
      try {
        if (!fs.existsSync(UPLOADS_DIR)) {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        const pdfFilename = `invoice_${invoice.invoice_no.replace(/[^a-zA-Z0-9-]/g, '_')}_${Date.now()}.pdf`;
        const fullPdfPath = path.join(UPLOADS_DIR, pdfFilename);
        await pdfInvoiceService.generateInvoicePdf(invoiceId, fullPdfPath);
        if (fs.existsSync(fullPdfPath)) {
          pdfPath = fullPdfPath;
        }
      } catch (pdfErr) {
        console.warn(`PDF invoice attachment generation note for invoice ${invoice.invoice_no}:`, pdfErr);
      }

      if (!pdfPath) {
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
           VALUES (?, ?, ?, ?, 'failed', 'PDF_GENERATION_FAILED', ?)`,
          [isCredit ? 'credit_sale_invoice' : 'pos_sale_invoice', customerName, cleanPhone, caption, `invoice_${invoiceId}`]
        ).catch(() => {});
        return false;
      }

      // Enqueue message with attached PDF into centralized queue
      let textQueued = false;
      try {
        const queueId = await whatsappQueueWorker.enqueue(
          cleanPhone,
          caption,
          isCredit ? 'pos_credit_invoice' : 'pos_sale_invoice',
          customerName,
          undefined,
          pdfPath
        );
        console.log(`Dispatched WhatsApp notification with attached PDF for invoice ${invoice.invoice_no} to centralized queue (#${queueId})`);
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [isCredit ? 'credit_sale_invoice' : 'pos_sale_invoice', customerName, cleanPhone, caption, 'queued', `invoice_${invoiceId}`]
        );
        textQueued = true;
      } catch (textErr: any) {
        console.error(`Failed to enqueue WhatsApp notification for invoice ${invoice.invoice_no}:`, textErr);
      }

      return textQueued;
    } catch (err) {
      console.error(`Error sending invoice ${invoiceId} via WhatsApp:`, err);
      return false;
    }
  }
}

export const whatsappInvoiceService = new WhatsappInvoiceService();
