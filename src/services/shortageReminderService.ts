import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import { notificationService } from './notificationService.js';

export interface MedicineRequest {
  id?: number;
  medicine_name: string;
  distributor_name?: string;
  quantity: number;
  customer_phone?: string;
  customer_name?: string;
  source: string;
  status: 'pending' | 'inventory_found' | 'notified_admin' | 'cancelled';
  created_at?: string;
  updated_at?: string;
  notified_at?: string;
}

/**
 * Record a requested / queried medicine that was out-of-stock or not found in inventory.
 */
export async function trackMedicineRequest(req: {
  medicine_name: string;
  distributor_name?: string;
  quantity?: number;
  customer_phone?: string;
  customer_name?: string;
  source?: string;
}): Promise<number> {
  const db = await dbManager.getConnection();
  const name = req.medicine_name.trim();
  const qty = req.quantity || 1;
  const source = req.source || 'whatsapp';
//   const _dist = req.distributor_name || 'Standard Distributor';

  // Prevent duplicate open requests for the same medicine & customer/distributor in the last 23 hours
  const existing = await db.get(
    `SELECT id FROM special_orders 
     WHERE LOWER(product) = LOWER(?) AND status = 'Pending'
     AND datetime(date) >= datetime('now', '-23 hours')`,
    [name]
  );

  if (existing) {
    // Update quantity if needed
    await db.run(
      `UPDATE special_orders 
       SET qty = qty + ?
       WHERE id = ?`,
      [qty, existing.id]
    );
    return existing.id;
  }

  const result = await db.run(
    `INSERT INTO special_orders 
     (product, requester, phone, qty, priority, status, source)
     VALUES (?, ?, ?, ?, 'Normal', 'Pending', ?)`,
    [name, req.customer_name || 'Walk-in Customer', String(req.customer_phone || '').replace(/\D/g, ''), qty, source]
  );

  return result.lastID || 0;
}

/**
 * Perform periodic check for shortage medicine requests > 23 hours old.
 * Checks inventory for medicine or composition/brand match.
 * If still absent, generates structured WhatsApp order message and notifies Admin.
 */
export async function checkShortageRequestsAndNotifyAdmin(db?: Database): Promise<{ scanned: number; notified: number }> {
  const connection = db || await dbManager.getConnection();

  // Fetch pending requests created > 23 hours ago
  const pendingRequests = await connection.all(
    `SELECT * FROM special_orders
     WHERE status = 'Pending'
     AND datetime(date) <= datetime('now', '-23 hours')`
  );

  if (!pendingRequests || pendingRequests.length === 0) {
    return { scanned: 0, notified: 0 };
  }

  const shortageEnabledRow = await connection.get("SELECT value FROM app_settings WHERE key = 'trigger_wa_shortage_notice_enabled'");
  const shortageNoticeEnabled = shortageEnabledRow?.value !== 'false';

  let notifiedCount = 0;
  const unavailableItems: any[] = [];

  for (const item of pendingRequests) {
    const medName = item.product || '';
    if (!medName) continue;
    const cleanName = medName.trim().toLowerCase();

    // 1. Check if exact or similar medicine/brand exists in active inventory
    const inventoryMatch = await connection.get(
      `SELECT im.id, m.name as medicine_name, im.quantity
       FROM inventory_master im
       JOIN medicines m ON im.medicine_id = m.id
       WHERE (LOWER(m.name) LIKE ? OR LOWER(m.name) = ?) AND im.quantity > 0`,
      [`%${cleanName}%`, cleanName]
    );

    if (inventoryMatch) {
      // Medicine is now available in inventory! Mark as Fulfilled
      await connection.run(
        `UPDATE special_orders
         SET status = 'Fulfilled', notes = 'Inventory found in stock'
         WHERE id = ?`,
        [item.id]
      );
      continue;
    }

    // 1b. Check if distributor brand name exists as an ALIAS (`medicine_aliases`) for an inventory item
    const aliasMatch = await connection.get(
      `SELECT im.id, m.name as medicine_name, im.quantity
       FROM medicine_aliases ma
       JOIN medicines m ON ma.medicine_id = m.id
       JOIN inventory_master im ON im.medicine_id = m.id
       WHERE (LOWER(ma.alias_name) = ? OR LOWER(ma.alias_name) LIKE ?) AND im.quantity > 0`,
      [cleanName, `%${cleanName}%`]
    );

    if (aliasMatch) {
      // Alias match found in active inventory! Mark as Fulfilled
      await connection.run(
        `UPDATE special_orders
         SET status = 'Fulfilled', notes = 'Alias inventory found in stock'
         WHERE id = ?`,
        [item.id]
      );
      continue;
    }

    // 2. Check if a similar composition/substitute medicine is in stock
    const refMatch = await connection.get(
      `SELECT composition1 FROM medicine_reference WHERE LOWER(name) = ?`,
      [cleanName]
    );

    if (refMatch && refMatch.composition1) {
      const compMatch = await connection.get(
        `SELECT im.id, m.name as medicine_name
         FROM inventory_master im
         JOIN medicines m ON im.medicine_id = m.id
         JOIN medicine_reference mr ON LOWER(m.name) = LOWER(mr.name)
         WHERE LOWER(mr.composition1) = LOWER(?) AND im.quantity > 0`,
        [refMatch.composition1]
      );

      if (compMatch) {
        // Similar composition exists in stock
        await connection.run(
          `UPDATE special_orders
           SET status = 'Fulfilled', notes = 'Composition substitute found in stock'
           WHERE id = ?`,
          [item.id]
        );
        continue;
      }
    }

    // 3. Medicine / similar medicine NOT shown in inventory for > 23 hours!
    unavailableItems.push(item);

    // Mark as Ordered (notified) to avoid duplicate spamming
    await connection.run(
      `UPDATE special_orders
       SET status = 'Ordered', notes = 'Processed in daily shortage check'
       WHERE id = ?`,
      [item.id]
    );
  }

  // If there are unavailable items, send ONE single consolidated WhatsApp summary to admin
  if (unavailableItems.length > 0) {
    const { getPharmacyOwnerPhone } = await import('./storeSettingsService.js');
    const storeOwnerPhone = await getPharmacyOwnerPhone(connection);
    const recipientName = 'Admin / Store Owner';
    const adminPhone = storeOwnerPhone ? storeOwnerPhone.replace(/\D/g, '') : '';

    if (adminPhone && adminPhone.length >= 10 && shortageNoticeEnabled) {
      const formattedPhone = adminPhone.length === 10 ? `91${adminPhone}` : adminPhone;

      const itemLines = unavailableItems.map((item: any, idx: number) => {
        const distName = item.pharmarack_distributor || 'Preferred Distributor';
        const qtyNeeded = item.qty || 1;
        return `${idx + 1}. *${item.product}* × ${qtyNeeded} (Distributor: ${distName})`;
      }).join('\n');

      const consolidatedAdminMessage = `🚨 *ADMIN ORDER REMINDER (>23 Hours Unavailable)*\n\n` +
        `The following ${unavailableItems.length} requested item(s) have not been added to inventory for over 23 hours:\n\n` +
        `${itemLines}\n\n` +
        `👉 *Action Required:* Please add these items to today's distributor purchase orders.`;

      try {
        await notificationService.sendWhatsApp(formattedPhone, consolidatedAdminMessage, undefined, undefined, 'admin_shortage_reminder');

        // Log in action_logs for Activity Alerts
        await connection.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['SHORTAGE_REMINDER_SENT', `Sent consolidated admin shortage reminder for ${unavailableItems.length} item(s) to ${formattedPhone}`]
        );

        // Log in automation_notifications for Live WhatsApp Controller tracking
        const refIds = unavailableItems.map((it: any) => `shortage_${it.id}`).join(',');
        await connection.run(
          `INSERT INTO automation_notifications 
           (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['admin_shortage_reminder', recipientName, formattedPhone, consolidatedAdminMessage, 'sent', refIds]
        );
      } catch (err: any) {
        console.error(`[ShortageReminder] Failed to send consolidated WhatsApp to admin at ${formattedPhone}:`, err);
        const refIds = unavailableItems.map((it: any) => `shortage_${it.id}`).join(',');
        await connection.run(
          `INSERT INTO automation_notifications 
           (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ['admin_shortage_reminder', recipientName, formattedPhone, consolidatedAdminMessage, 'failed', err?.message || 'Send failed', refIds]
        );
      }
    } else {
      console.warn('[ShortageReminder] Pharmacy Owner WhatsApp number not configured or alert disabled in Settings.');
    }

    notifiedCount = unavailableItems.length;
  }

  return { scanned: pendingRequests.length, notified: notifiedCount };
}

