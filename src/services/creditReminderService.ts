import { dbManager } from '../database/connection.js';
import { normalizeWhatsAppPhone } from '../whatsappClient.js';
import { paymentQrService } from './paymentQrService.js';
import { pdfInvoiceService } from './pdfInvoiceService.js';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';
import { getMessage } from '../i18n/getMessage.js';
import { getAppDataDir } from '../config/index.js';
import path from 'path';
import fs from 'fs';

export interface CreditReminderOptions {
  skipDedupe?: boolean;
  customMessage?: string;
  isManual?: boolean;
}

export interface CreditReminderResult {
  success: boolean;
  message?: string;
  queueId?: number | null;
  amount?: number;
  skipped?: boolean;
  reason?: string;
}

export class CreditReminderService {
  /**
   * Build and dispatch an amount-specific UPI QR credit reminder for a customer.
   * Shared between the daily automated overdue scan and manual CRM clicks.
   */
  async buildCreditReminderWithQr(
    customerId: number,
    dbInstance?: any,
    options?: CreditReminderOptions
  ): Promise<CreditReminderResult> {
    const db = dbInstance || (await dbManager.getConnection());

    const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
    if (!customer || !customer.phone) {
      return { success: false, reason: 'Customer or phone number not found' };
    }

    const cleanPhone = normalizeWhatsAppPhone(customer.phone);
    if (!cleanPhone || cleanPhone.length < 10) {
      return { success: false, reason: 'Invalid WhatsApp phone number' };
    }

    const last10 = cleanPhone.slice(-10);

    // 24-hour deduplication safeguard (skipped if manual click with skipDedupe = true)
    if (!options?.skipDedupe) {
      const recentReminder = await db.get(
        `SELECT id, created_at FROM automation_notifications 
         WHERE type IN ('auto_credit_reminder', 'manual_credit_reminder') 
           AND (recipient_phone LIKE ? OR recipient_phone LIKE ?)
           AND created_at > datetime('now', '-24 hours')
         ORDER BY id DESC LIMIT 1`,
        [`%${last10}`, `%${cleanPhone}%`]
      );

      if (recentReminder) {
        console.log(`[CreditReminderService] Skipped reminder for ${cleanPhone} (already notified in last 24h, notification ID #${recentReminder.id}).`);
        return { success: true, skipped: true, reason: 'Already reminded within last 24 hours' };
      }
    }

    const formatDate = (dStr?: string) => {
      if (!dStr) return '';
      try {
        const d = new Date(dStr);
        return isNaN(d.getTime()) ? dStr : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      } catch {
        return dStr || '';
      }
    };

    // Fetch unpaid credit invoices for itemized summary breakdown
    const pendingInvoices = await db.all(
      `SELECT invoice_no, total_amount, date FROM sales_invoices
       WHERE customer_id = ? 
         AND (payment_medium = 'CREDIT' OR payment_status = 'UNPAID' OR payment_status = 'PENDING') 
         AND payment_status != 'PAID'
       ORDER BY date ASC, id ASC`,
      [customerId]
    );

    let billsBreakdownStr = '';
    let computedTotal = 0;
    if (pendingInvoices && pendingInvoices.length > 0) {
      billsBreakdownStr += `📜 *Pending Bills Breakdown (${pendingInvoices.length})*\n`;
      for (const inv of pendingInvoices) {
        const amt = Number(inv.total_amount || 0);
        computedTotal += amt;
        const dFormatted = formatDate(inv.date);
        billsBreakdownStr += `• Bill #${inv.invoice_no} (${dFormatted}): ₹${amt.toFixed(2)}\n`;
      }
      billsBreakdownStr += `\n`;
    }

    const finalOutstanding = customer.credit_balance !== undefined && customer.credit_balance !== null && Number(customer.credit_balance) > 0
      ? Number(customer.credit_balance)
      : computedTotal;

    if (finalOutstanding < 1) {
      return { success: true, skipped: true, reason: 'Zero or negative outstanding balance' };
    }

    const dueDateStr = customer.credit_due_date
      ? formatDate(customer.credit_due_date)
      : 'As agreed';

    const storeSetting = await db.get(
      "SELECT value FROM app_settings WHERE key IN ('shop_name', 'pharmacy_name', 'store_name') AND value IS NOT NULL LIMIT 1"
    );
    const storeName = storeSetting?.value || 'AI Pharmacy';
    const lang = (customer.language === 'hi' || customer.language === 'mr') ? customer.language : 'en';

    let message = options?.customMessage;
    if (!message) {
      message = getMessage(lang, 'whatsapp.creditReminder', {
        name: customer.name || 'Customer',
        billsBreakdown: billsBreakdownStr ? billsBreakdownStr : '',
        dueDate: dueDateStr,
        total: finalOutstanding.toFixed(2),
        storeName: storeName
      });
    }

    // Allocate Rotating Payment QR Code for exact outstanding amount
    const activeQr = await paymentQrService.allocateNextQr();
    const upiUri = paymentQrService.buildUpiUri(
      activeQr.upi_id,
      activeQr.payee_name || storeName,
      finalOutstanding,
      `CREDIT-${customerId}`
    );

    let qrBuffer: Buffer | null = null;
    try {
      qrBuffer = await paymentQrService.generateQrBuffer(upiUri);
    } catch (qrErr) {
      console.warn('[CreditReminderService] QR buffer generation note:', qrErr);
    }

    // Generate Statement PDF
    let pdfPath: string | undefined = undefined;
    try {
      const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const pdfFilename = `credit_statement_cust_${customerId}_${Date.now()}.pdf`;
      const fullPdfPath = path.join(uploadsDir, pdfFilename);
      await pdfInvoiceService.generateCreditStatementPdf(Number(customerId), fullPdfPath);
      pdfPath = fullPdfPath;
    } catch (pdfErr) {
      console.warn(`[CreditReminderService] PDF generation note for customer ${customerId}:`, pdfErr);
    }

    const notificationType = options?.isManual ? 'manual_credit_reminder' : 'auto_credit_reminder';

    // Enqueue message with attached QR Code image and PDF statement
    const queueId = await whatsappQueueWorker.enqueue(
      cleanPhone,
      message,
      'credit_reminder',
      customer.name || 'Customer',
      undefined,
      pdfPath,
      qrBuffer ? {
        mimetype: 'image/png',
        data: qrBuffer.toString('base64'),
        filename: `payment_qr_credit_${customerId}.png`
      } : undefined
    );

    // Record in automation_notifications
    try {
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, needs_confirmation, reference_id)
         VALUES (?, ?, ?, ?, 'queued', 0, ?)`,
        [notificationType, customer.name || 'Customer', cleanPhone, message, `customer_${customerId}`]
      );
    } catch (_) {}

    return {
      success: true,
      queueId,
      amount: finalOutstanding
    };
  }

  /**
   * Scan all overdue customers and queue amount-specific UPI QR reminders.
   * Gated on app_settings: trigger_wa_credit_reminder_enabled != 'false'
   * and credit_auto_reminder_enabled == 'true' (opt-in pilot).
   */
  async checkOverdueAndEnqueue(dbInstance?: any, forceRun: boolean = false): Promise<{
    processed: number;
    queued: number;
    skipped: number;
  }> {
    const db = dbInstance || (await dbManager.getConnection());

    if (!forceRun) {
      const enabledRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_wa_credit_reminder_enabled'");
      if (enabledRow?.value === 'false') {
        console.log('[CreditReminderService] Credit reminder automation is disabled in settings.');
        return { processed: 0, queued: 0, skipped: 0 };
      }

      const autoOptIn = await db.get("SELECT value FROM app_settings WHERE key = 'credit_auto_reminder_enabled'");
      if (autoOptIn?.value !== 'true') {
        console.log('[CreditReminderService] Auto credit reminders are not opted in (credit_auto_reminder_enabled != true).');
        return { processed: 0, queued: 0, skipped: 0 };
      }
    }

    console.log('[CreditReminderService] Scanning overdue credit accounts for automatic reminder dispatch...');

    const overdueCustomers = await db.all(
      `WITH unpaid_invoices AS (
         SELECT customer_id, COUNT(*) as unpaid_count, SUM(total_amount) as unpaid_total
         FROM sales_invoices
         WHERE (payment_medium = 'CREDIT' OR payment_status = 'UNPAID' OR payment_status = 'PENDING')
           AND payment_status != 'PAID'
         GROUP BY customer_id
       )
       SELECT c.id, c.name, c.phone, c.credit_balance, c.credit_due_date,
              COALESCE(ui.unpaid_count, 0) as unpaid_count,
              COALESCE(ui.unpaid_total, 0) as unpaid_total
       FROM customers c
       LEFT JOIN unpaid_invoices ui ON c.id = ui.customer_id
       WHERE c.credit_due_date IS NOT NULL 
         AND date(c.credit_due_date) <= date('now', 'localtime')
         AND (c.credit_balance > 0 OR ui.unpaid_count > 0)
       LIMIT 500`
    );

    let queuedCount = 0;
    let skippedCount = 0;

    for (const cust of overdueCustomers) {
      try {
        const res = await this.buildCreditReminderWithQr(cust.id, db, {
          skipDedupe: false,
          isManual: false
        });

        if (res.skipped) {
          skippedCount++;
        } else if (res.success) {
          queuedCount++;
        }
      } catch (err) {
        console.error(`[CreditReminderService] Failed to process reminder for customer #${cust.id}:`, err);
      }
    }

    console.log(`[CreditReminderService] Overdue credit scan complete. Processed: ${overdueCustomers.length}, Queued: ${queuedCount}, Skipped: ${skippedCount}.`);
    return {
      processed: overdueCustomers.length,
      queued: queuedCount,
      skipped: skippedCount
    };
  }
}

export const creditReminderService = new CreditReminderService();
