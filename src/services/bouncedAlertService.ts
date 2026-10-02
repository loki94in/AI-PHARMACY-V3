import { dbManager } from '../database/connection.js';
import { emailService, isNonMedicineNoise, cleanMedicineName } from './emailService.js';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';
import { normalizeInvoiceNo, tokensMatchFuzzy } from '../utils/reconciliationMatcher.js';
import fs from 'fs';

export class BouncedAlertService {
  /**
   * Run the bounced products check for order emails received in the last 30 hours,
   * compare them with actual check-ins, and send a summary to the Admin / Store Owner.
   */
  async checkAndSendBouncedProductsAlert(): Promise<boolean> {
    let db;
    let recipientPhone = '';
    const recipientName = 'Admin / Store Owner';
    try {
      db = await dbManager.getConnection();
      
      // 1. Check if automation is enabled
      const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
      if (!autoRow || autoRow.value !== 'true') {
        console.log('[BouncedAlert] Automation is disabled. Skipping alert check.');
        return false;
      }

      // 1b. Check the bounced products alert automation toggle (default-on)
      const bouncedEnabledRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_wa_bounced_products_alert_enabled'");
      if (bouncedEnabledRow?.value === 'false') {
        console.log('[BouncedAlert] Bounced products alert automation disabled. Skipping alert check.');
        return false;
      }

      // 2. Fetch recipient phone (Admin / Store Owner numbers ONLY)
      const { getPharmacyOwnerPhone } = await import('./storeSettingsService.js');
      recipientPhone = await getPharmacyOwnerPhone(db);

      if (!recipientPhone) {
        console.warn('[BouncedAlert] WhatsApp recipient number not configured in Store Settings (owner_whatsapp_number / shop_phone). Skipping notification.');
        return false;
      }

      // 3. Fetch order emails from the last 30 hours that are not marked as saved/reconciled
      const orderEmails = await db.all(`
        SELECT uid, from_addr, subject, body, date, distributor_name, medicine_names
        FROM emails
        WHERE is_order = 1 
          AND (is_saved IS NULL OR is_saved = 0)
          AND date >= datetime('now', '-30 hours')
        ORDER BY date DESC
      `);

      if (!orderEmails || orderEmails.length === 0) {
        console.log('[BouncedAlert] No unreconciled order emails found in the last 30 hours.');
        return false;
      }

      // Load medicine aliases and OCR corrections for alias-aware reconciliation
      const aliasRows = await db.all(
        `SELECT LOWER(ma.alias_name) as alias_name, LOWER(m.name) as real_name 
         FROM medicine_aliases ma 
         JOIN medicines m ON ma.medicine_id = m.id`
      ).catch(() => []);
      const aliasMap = new Map<string, string>();
      for (const a of aliasRows) {
        if (a.alias_name && a.real_name) aliasMap.set(a.alias_name, a.real_name);
      }

      const ocrRows = await db.all(`SELECT LOWER(ocr) as raw_text, LOWER(correct) as corrected_text FROM ocr_corrections`).catch(() => []);
      for (const o of ocrRows) {
        if (o.raw_text && o.corrected_text) aliasMap.set(o.raw_text, o.corrected_text);
      }

      // Fetch permanently ignored words
      const piwRows = await db.all(`SELECT word FROM permanently_ignored_words`).catch(() => []);
      const ignoredSet = new Set(piwRows.map((r: any) => String(r.word || '').trim().toLowerCase()));

      // Pre-fetch candidate purchases from the last 4 days
      const candidatePurchases = await db.all(
        `SELECT p.id, p.invoice_no, p.app_invoice_no, p.distributor_id, d.name as dist_name
         FROM purchases p
         LEFT JOIN distributors d ON p.distributor_id = d.id
         WHERE p.date >= datetime('now', '-4 days')
         ORDER BY p.id DESC LIMIT 200`
      );

      const distributorBounces: Record<string, Array<{ name: string; ordered: number; received: number }>> = {};
      const pendingDeliveries: Array<{ distributor: string; invoiceNo: string; itemCount: number }> = [];

      for (const email of orderEmails) {
        const orderInfo = await emailService.extractOrderInfo(email);
        const invoiceNo = orderInfo.invoiceNumber;
        const distName = (orderInfo.distributorName && orderInfo.distributorName !== 'Unknown Distributor' ? orderInfo.distributorName : '') || (email.distributor_name && email.distributor_name !== 'Unknown Distributor' ? email.distributor_name : '') || 'Unassigned';

        if (!invoiceNo || invoiceNo === 'N/A') {
          continue; // Cannot reconcile without invoice number
        }

        // Fetch expected items and quantities from attachments or email text
        const expectedItems: Array<{ name: string; quantity: number }> = [];
        const attachments = await db.all(
          'SELECT filename, local_path FROM email_attachments WHERE uid = ?',
          [email.uid]
        );

        let attachmentParsed = false;
        for (const att of attachments) {
          if (att.local_path && fs.existsSync(att.local_path)) {
            try {
              const resParse = await emailService.parseAndImportAttachment(att.local_path, false);
              if (resParse && resParse.success && resParse.items && resParse.items.length > 0) {
                for (const item of resParse.items) {
                  const cleaned = cleanMedicineName(item.name);
                  if (cleaned && !isNonMedicineNoise(cleaned) && !ignoredSet.has(cleaned.toLowerCase())) {
                    expectedItems.push({
                      name: cleaned,
                      quantity: Number(item.quantity) || 0
                    });
                  }
                }
                attachmentParsed = true;
              }
            } catch (e) {
              console.warn(`[BouncedAlert] Failed to parse attachment ${att.filename}:`, e);
            }
          }
        }

        // Fall back to extracted text info if no attachments parsed successfully
        if (!attachmentParsed && orderInfo.medicines && orderInfo.medicines.length > 0) {
          for (const med of orderInfo.medicines) {
            const cleaned = cleanMedicineName(med.name);
            if (cleaned && !isNonMedicineNoise(cleaned) && !ignoredSet.has(cleaned.toLowerCase())) {
              expectedItems.push({
                name: cleaned,
                quantity: parseInt(med.quantity, 10) || 1
              });
            }
          }
        }

        if (expectedItems.length === 0) {
          continue; // No items to compare
        }

        // Match against purchases using canonical invoice normalization
        const canonInvoice = normalizeInvoiceNo(invoiceNo);
        const matchedPurchase = candidatePurchases.find((p: any) => {
          const pCanon1 = normalizeInvoiceNo(p.invoice_no);
          const pCanon2 = normalizeInvoiceNo(p.app_invoice_no);
          return canonInvoice && (canonInvoice === pCanon1 || canonInvoice === pCanon2);
        });

        if (!matchedPurchase) {
          // Bill has not checked into the pharmacy yet (still in transit or awaiting counter intake).
          // Track as pending delivery rather than falsely reporting 100% bounced.
          pendingDeliveries.push({
            distributor: distName,
            invoiceNo: invoiceNo,
            itemCount: expectedItems.length
          });
          continue;
        }

        // Invoice is checked in. Fetch actual received items and check for genuine bounced/short items.
        const receivedItems = await db.all(`
          SELECT m.name as medicine_name, pi.quantity, pi.free_qty
          FROM purchase_items pi
          JOIN medicines m ON pi.medicine_id = m.id
          WHERE pi.purchase_id = ?
        `, [matchedPurchase.id]);

        const receivedList = receivedItems.map((item: any) => ({
          name: item.medicine_name,
          quantity: (Number(item.quantity) || 0) + (Number(item.free_qty) || 0)
        }));

        // Compare expected vs received with canonical token-fuzzy and alias matching
        for (const expected of expectedItems) {
          let matchedReceivedQty = 0;
          let matchedAny = false;

          for (const rec of receivedList) {
            if (tokensMatchFuzzy(expected.name, rec.name, aliasMap)) {
              matchedReceivedQty += rec.quantity;
              matchedAny = true;
            }
          }

          if (!matchedAny || matchedReceivedQty < expected.quantity) {
            if (!distributorBounces[distName]) {
              distributorBounces[distName] = [];
            }
            distributorBounces[distName].push({
              name: expected.name,
              ordered: expected.quantity,
              received: matchedReceivedQty
            });
          }
        }
      }

      // 4. Generate alert message if any bounced products or pending deliveries detected
      const distEntries = Object.entries(distributorBounces);
      if (distEntries.length === 0 && pendingDeliveries.length === 0) {
        console.log('[BouncedAlert] All items reconciled or pending deliveries within schedule. No alert needed.');
        return false;
      }

      let message = `⚠️ *Bounced / Short Supply Alert* (Yesterday's Orders)\n\n`;

      if (distEntries.length > 0) {
        for (const [distName, bounces] of distEntries) {
          message += `*Distributor: ${distName}*\n`;
          for (const b of bounces) {
            const diff = b.ordered - b.received;
            if (b.received === 0) {
              message += `• ${b.name}: Ordered ${b.ordered}, Received 0 (BOUNCED) ❌\n`;
            } else {
              message += `• ${b.name}: Ordered ${b.ordered}, Received ${b.received} (Short by ${diff}) ⚠️\n`;
            }
          }
          message += `\n`;
        }
      }

      if (pendingDeliveries.length > 0) {
        message += `📦 *Pending Deliveries (Awaiting Check-in):*\n`;
        for (const pd of pendingDeliveries) {
          message += `• ${pd.distributor} — Inv #${pd.invoiceNo} (${pd.itemCount} items)\n`;
        }
        message += `\n`;
      }

      message += `— AI Pharmacy OS`;

      // 5. Dispatch via centralized WhatsApp queue
      await whatsappQueueWorker.enqueue(recipientPhone, message, 'bounced_products_alert', recipientName);
      console.log(`[BouncedAlert] Successfully enqueued morning notification for ${recipientPhone}`);

      // Log action
      await db.run(
        'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
        ['BOUNCED_PRODUCTS_NOTIFICATION_SENT', `Sent morning bounced products report to ${recipientName} (${recipientPhone})`]
      );

      // Log in automation notifications
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status)
         VALUES (?, ?, ?, ?, ?)`,
        ['whatsapp', recipientName, recipientPhone, message, 'sent']
      );

      return true;
    } catch (err: any) {
      console.error('[BouncedAlert] Failed to run bounced products check:', err);
      // Log failure in database if possible
      try {
        if (db) {
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['whatsapp', recipientName, recipientPhone || 'Unknown', 'Bounced check failed', 'failed', err.message]
          );
        }
      } catch (logErr) {}
      return false;
    }
  }
}

export const bouncedAlertService = new BouncedAlertService();
