import { Database } from 'sqlite';
import { telegramBotService } from '../telegramBot.js';
import { getConfiguredPharmacyName, getStorePhone } from './storeSettingsService.js';
import { effectiveNoticeDays, advanceToNextOpenDay } from '../utils/pharmacyCalendar.js';
import { refillOrderReconciler } from './refillOrderReconciler.js';
import { scoreOrderNameMatch, ARRIVAL_MATCH_THRESHOLD } from '../utils/orderNameMatcher.js';

export async function checkAllRefills(db: Database): Promise<void> {
  // Clean up paused refills (is_active = 0) so they don't remain marked ready or held
  try {
    await db.run(`UPDATE patient_refills SET is_ready = 0, hold_for_stock = 0 WHERE is_active = 0`);
    await db.run(
      `UPDATE automation_notifications SET lifecycle_status = 'skipped' 
       WHERE type = 'refill_collection' AND lifecycle_status = 'staged' AND reference_id IN (
         SELECT CAST(id AS TEXT) FROM patient_refills WHERE is_active = 0
       )`
    );

    // Paused-not-missed: if paused refill is within 7 days, ensure it is surfaced in special_orders with shifted open day
    const pausedUpcoming = await db.all(
      `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
       JOIN medicines m ON pr.medicine_id = m.id
       WHERE pr.is_active = 0 AND pr.next_refill_date IS NOT NULL
         AND date(pr.next_refill_date) <= date('now', '+7 days')`
    ).catch(() => []);

    for (const pRefill of pausedUpcoming) {
      try {
        const openDay = await advanceToNextOpenDay(new Date(pRefill.next_refill_date), {
          storeId: pRefill.store_id || 1,
          dbInstance: db
        });
        await refillOrderReconciler.upsertForPhone({
          phone: pRefill.patient_phone,
          customer_name: pRefill.patient_name,
          items: [{
            medicine_name: pRefill.medicine_name,
            qty: Number(pRefill.quantity_needed || 3)
          }],
          source: 'refill',
          source_refill_id: pRefill.id,
          store_id: pRefill.store_id || 1,
          priority: 'Normal',
          notes: `Paused at patient request, auto-shifted to ${openDay.ymd}`,
          dbInstance: db
        });
      } catch (_) {}
    }
  } catch (cleanErr) {
    console.warn('[RefillService] Cleanup of paused refills warning:', cleanErr);
  }

  // Query active refills that are due
  const activeRefills = await db.all(
    `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
     JOIN medicines m ON pr.medicine_id = m.id
     WHERE pr.status = 'pending' AND pr.is_active = 1`
  );

  let noticeDays = 3;
  let operatingSchedule = { openTime: '09:00', closeTime: '22:00', weeklyOff: 'Monday', closedDates: [] as string[] };
  try {
    const setting = await db.get("SELECT value FROM app_settings WHERE key = 'refill_notice_days'");
    if (setting && setting.value) {
      noticeDays = parseInt(setting.value, 10) || 3;
    }
    const { getPharmacyOperatingSchedule } = await import('./storeSettingsService.js');
    operatingSchedule = await getPharmacyOperatingSchedule(db);
  } catch (err) {
    console.error('Failed to load refill notice settings:', err);
  }

  const outOfStockRefills: any[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weeklyOffLower = (operatingSchedule.weeklyOff || 'monday').toLowerCase();

  for (const refill of activeRefills) {
    const nextDate = new Date(refill.next_refill_date);
    nextDate.setHours(0, 0, 0, 0);
    const diffTime = nextDate.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    const dateYmd = refill.next_refill_date ? refill.next_refill_date.slice(0, 10) : '';
    const effNotice = await effectiveNoticeDays(noticeDays, dateYmd, refill.store_id || 1, db);

    // Check if within the notice lead time
    const highlightTrigger = diffDays <= effNotice;
    const orderTrigger = diffDays <= effNotice;

    if (!orderTrigger && !highlightTrigger) {
      continue;
    }

    // Check stock availability (full strips + loose units)
    const stockRow = await db.get(
      'SELECT (SUM(quantity) + COALESCE(SUM(loose_quantity), 0)) as total_qty FROM inventory_master WHERE medicine_id = ?',
      [refill.medicine_id]
    );
    const qty = stockRow ? (stockRow.total_qty || 0) : 0;

    const hasStock = qty > 0 || refill.stock_verified_override === 1;

    if (hasStock) {
      // Stock is present or override is active!
      if (highlightTrigger) {
        let quickBillId = refill.quick_bill_id;
        if (!quickBillId) {
          quickBillId = await createQuickBillForRefill(db, refill);
          await db.run(
            `UPDATE patient_refills 
             SET is_ready = 1, hold_for_stock = 0, quick_bill_id = ?
             WHERE id = ?`,
            [quickBillId, refill.id]
          );
        } else {
          await db.run(
            `UPDATE patient_refills 
             SET is_ready = 1, hold_for_stock = 0
             WHERE id = ?`,
            [refill.id]
          );
        }
      }
    } else {
      // Stock is missing and override is not active!
      if (orderTrigger) {
        if (refill.ordering_triggered === 0) {
          const orderQty = Number(refill.quantity_needed || refill.quantity || 3);
          await refillOrderReconciler.upsertForPhone({
            phone: refill.patient_phone,
            customer_name: refill.patient_name,
            items: [{
              medicine_name: refill.medicine_name,
              qty: orderQty
            }],
            source: 'refill',
            source_refill_id: refill.id,
            store_id: refill.store_id || 1,
            priority: 'High',
            dbInstance: db
          });

          await db.run(
            `UPDATE patient_refills 
             SET hold_for_stock = 1, is_ready = 0, ordering_triggered = 1 
             WHERE id = ?`,
            [refill.id]
          );

          outOfStockRefills.push(refill);

          // Silent API post to add to Pharmarack cart if session is active
          try {
            const tokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token'");
            if (tokenRow?.value) {
              const port = process.env.PORT || 3000;
              fetch(`http://localhost:${port}/api/pharmarack/cart/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  items: [{
                    name: refill.medicine_name,
                    qty: Number(refill.quantity_needed || refill.quantity || 3)
                  }]
                })
              }).catch(e => console.error('Failed to auto-add to Pharmarack cart:', e));
            }
          } catch (e) {
            console.error('Fetch post error:', e);
          }
        }
      }
    }
  }

  if (outOfStockRefills.length > 0) {
    let reportMessage = `📋 PENDING REFILLS OF THE WEEK (OUT OF STOCK):\n\n`;
    outOfStockRefills.forEach((refill, index) => {
      reportMessage += `${index + 1}. Patient: ${refill.patient_name} (${refill.patient_phone})\n   Medication: ${refill.medicine_name}\n   Next Refill Due: ${refill.next_refill_date}\n\n`;
    });
    reportMessage += `Please purchase/add stock for these medicines so they can be marked ready for manual customer notification.`;

    try {
      await telegramBotService.sendDefaultNotification(reportMessage);
    } catch (err) {
      console.error('Failed to send daily out-of-stock refills report to Telegram:', err);
    }
  }
}

export async function createQuickBillForRefill(db: any, refill: any): Promise<number> {
  const invoice_no = `H-REF-${Date.now()}`;
  const temp_label = `Refill - ${refill.patient_name}`;
  
  const invRow = await db.get(
    `SELECT im.id as inventory_id, im.batch_no, im.expiry_date, im.mrp, im.unit_price, COALESCE(im.unit_price, im.mrp, m.mrp, 0) as price, COALESCE(m.pack_size, 1) as pack_size
     FROM inventory_master im
     JOIN medicines m ON im.medicine_id = m.id
     WHERE im.medicine_id = ? AND (im.quantity > 0 OR im.loose_quantity > 0)
     ORDER BY im.expiry_date ASC LIMIT 1`,
    [refill.medicine_id]
  );

  const unit_price = invRow ? Number(invRow.price || invRow.mrp || 0) : 0;
  const refillQty = Number(refill.quantity || 1);

  const cartItems = [{
    id: invRow ? invRow.inventory_id : refill.medicine_id,
    inventory_id: invRow ? invRow.inventory_id : undefined,
    medicine_id: refill.medicine_id,
    medicine_name: refill.medicine_name,
    batch: invRow ? (invRow.batch_no || '') : '',
    expiry: invRow ? (invRow.expiry_date || '') : '',
    mrp: invRow ? (invRow.mrp || unit_price) : unit_price,
    qty: refillQty,
    quantity: refillQty,
    unit_price: unit_price,
    pack_size: invRow ? (invRow.pack_size || 1) : 1,
    discount_per: 0
  }];
  
  const cart_data = JSON.stringify(cartItems);

  const billResult = await db.run(
    `INSERT INTO held_bills (invoice_no, temp_label, patient_name, patient_phone, remarks, cart_data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [invoice_no, temp_label, refill.patient_name, refill.patient_phone, 'AUTO_REFILL_BILL', cart_data]
  );

  await syncStagedRefillNotificationForPatient(db, refill.patient_name, refill.patient_phone);

  return billResult.lastID;
}

export async function syncStagedRefillNotificationForPatient(db: any, patientName: string, patientPhone: string): Promise<void> {
  const configuredName = await getConfiguredPharmacyName(db);
  if (!configuredName || (!patientName && !patientPhone)) return;
  const storePhone = await getStorePhone(db);
  const storeLabel = storePhone ? `${configuredName} (Ph: ${storePhone})` : configuredName;

  // Find all active, ready patient refills for this patient that have not been notified/completed and due within upcoming 7 calendar days
  const readyRefills = await db.all(
    `SELECT pr.id, m.name as medicine_name 
     FROM patient_refills pr
     JOIN medicines m ON pr.medicine_id = m.id
     WHERE (pr.patient_phone = ? OR pr.patient_name = ?)
       AND pr.is_active = 1
       AND pr.status NOT IN ('completed', 'canceled', 'notified')
       AND (pr.is_ready = 1 OR pr.hold_for_stock = 0)
       AND (pr.next_refill_date IS NULL OR pr.next_refill_date <= date('now', '+7 days'))
     ORDER BY pr.id ASC`,
    [patientPhone, patientName]
  );

  if (!readyRefills || readyRefills.length === 0) {
    // If no ready refills remain, remove any stale staged notification for this patient
    await db.run(
      `DELETE FROM automation_notifications 
       WHERE type = 'refill_collection' AND status = 'staged' AND (recipient_phone = ? OR recipient_name = ?)`,
      [patientPhone, patientName]
    );
    return;
  }

  // Deduplicate medicine names
  const medNames = Array.from(new Set(readyRefills.map((r: any) => r.medicine_name).filter(Boolean))) as string[];
  const refillIds = readyRefills.map((r: any) => r.id);

  let formattedMeds = '';
  if (medNames.length === 1) {
    formattedMeds = medNames[0];
  } else if (medNames.length === 2) {
    formattedMeds = `${medNames[0]} and ${medNames[1]}`;
  } else {
    formattedMeds = `${medNames.slice(0, -1).join(', ')}, and ${medNames[medNames.length - 1]}`;
  }

  const noun = medNames.length > 1 ? 'refills' : 'refill';
  const medNoun = medNames.length > 1 ? 'medicines' : 'medicine';
  const msg = `Hi ${patientName}, your ${noun} for ${formattedMeds} ${medNames.length > 1 ? 'are' : 'is'} in stock and ready. You may collect your ${medNoun} anytime from ${storeLabel}.`;
  const referenceIdStr = refillIds.join(',');

  // Check if a staged notification already exists for this patient
  const existing = await db.get(
    `SELECT id FROM automation_notifications 
     WHERE type = 'refill_collection' AND status = 'staged' AND (recipient_phone = ? OR recipient_name = ?)
     ORDER BY id ASC LIMIT 1`,
    [patientPhone, patientName]
  );

  if (existing) {
    await db.run(
      `UPDATE automation_notifications 
       SET message = ?, reference_id = ?, recipient_name = ?, recipient_phone = ?, needs_confirmation = 1
       WHERE id = ?`,
      [msg, referenceIdStr, patientName, patientPhone, existing.id]
    );
    // Remove any duplicate staged rows for this patient
    await db.run(
      `DELETE FROM automation_notifications 
       WHERE type = 'refill_collection' AND status = 'staged' AND (recipient_phone = ? OR recipient_name = ?) AND id != ?`,
      [patientPhone, patientName, existing.id]
    );
  } else {
    await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, needs_confirmation, reference_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['refill_collection', patientName, patientPhone, msg, 'staged', 1, referenceIdStr]
    );
  }
}

export async function triggerPendingRefillsForMedicine(db: Database, medicineId: number): Promise<void> {
  const stockRow = await db.get(
    'SELECT SUM(quantity) as total_qty FROM inventory_master WHERE medicine_id = ?',
    [medicineId]
  );
  const qty = stockRow ? (stockRow.total_qty || 0) : 0;

  if (qty <= 0) return;

  const pendingRefills = await db.all(
    `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
     JOIN medicines m ON pr.medicine_id = m.id
     WHERE pr.medicine_id = ? AND pr.status = 'pending' AND (pr.hold_for_stock = 1 OR pr.is_ready = 0) AND pr.is_active = 1`,
    [medicineId]
  );

  const affectedPatients = new Set<string>();

  for (const refill of pendingRefills) {
    let quickBillId = refill.quick_bill_id;
    if (!quickBillId) {
      quickBillId = await createQuickBillForRefill(db, refill);
    }
    await db.run(
      "UPDATE patient_refills SET is_ready = 1, hold_for_stock = 0, quick_bill_id = ? WHERE id = ?",
      [quickBillId, refill.id]
    );
    affectedPatients.add(`${refill.patient_name || ''}|||${refill.patient_phone || ''}`);
  }

  for (const p of affectedPatients) {
    const [name, phone] = p.split('|||');
    await syncStagedRefillNotificationForPatient(db, name, phone);
  }
}

export async function triggerPendingSpecialOrdersForMedicineName(db: Database, medicineName: string): Promise<void> {
  if (!medicineName) return;
  const pendingOrders = await db.all(
    `SELECT * FROM special_orders WHERE status IN ('Pending', 'Ordered')`
  );

  for (const order of pendingOrders) {
    const match = scoreOrderNameMatch(medicineName.trim(), order.product || order.medicine_name || '');
    if (match.score >= ARRIVAL_MATCH_THRESHOLD) {
      // Stage order as 'Ready' (in stock), keeping notified = 0 so user can manually send WhatsApp from the UI
      await db.run("UPDATE special_orders SET status = 'Ready', notified = 0 WHERE id = ?", [order.id]);
    }
  }
}

/**
 * Precisely cleans up staged refill_collection notifications for specific refill ID(s).
 * - If a staged notification's reference_id only contains the targeted ID(s), updates status to targetStatus ('sent_manually' | 'cancelled').
 * - If a staged notification contains sibling refill IDs, strips out the targeted ID(s) and leaves the notification staged.
 */
export async function cleanupStagedRefillNotifications(
  db: any,
  refillIds: number | number[] | string | string[],
  targetStatus: 'sent_manually' | 'cancelled' = 'sent_manually'
): Promise<void> {
  const idsToRemove = (Array.isArray(refillIds) ? refillIds : [refillIds]).map(id => String(id).trim()).filter(Boolean);
  if (idsToRemove.length === 0) return;

  try {
    const stagedNotifications = await db.all(
      `SELECT id, reference_id, recipient_phone, recipient_name 
       FROM automation_notifications 
       WHERE type = 'refill_collection' AND status = 'staged'`
    );

    for (const notif of stagedNotifications) {
      if (!notif.reference_id) continue;
      const existingRefIds = String(notif.reference_id).split(',').map(s => s.trim()).filter(Boolean);
      const hasMatch = existingRefIds.some(id => idsToRemove.includes(id));
      if (!hasMatch) continue;

      const remainingRefIds = existingRefIds.filter(id => !idsToRemove.includes(id));

      if (remainingRefIds.length === 0) {
        const lifecycle = targetStatus === 'cancelled' ? 'cancelled' : 'sent';
        await db.run(
          `UPDATE automation_notifications 
           SET status = ?, lifecycle_status = ? 
           WHERE id = ?`,
          [targetStatus, lifecycle, notif.id]
        );
      } else {
        await db.run(
          `UPDATE automation_notifications 
           SET reference_id = ? 
           WHERE id = ?`,
          [remainingRefIds.join(','), notif.id]
        );
      }
    }
  } catch (cleanErr) {
    console.warn('[Refills] Cleanup of staged notifications warning:', cleanErr);
  }
}

/**
 * Sends a morning operational briefing strictly to the Store Owner's WhatsApp.
 * Summarizes today's refills, special orders, and whether today has pause/holiday rules.
 * Does NOT send any automated messages to patients.
 */
export async function sendMorningScheduleBriefingToAdmin(db: Database): Promise<void> {
  try {
    const { waAdminEscalationService } = await import('./waAdminEscalationService.js');
    const adminWhatsapp = await waAdminEscalationService.resolveAdminWhatsappNumber(db);
    if (!adminWhatsapp) {
      console.log('[RefillService] No store owner WhatsApp configured for morning schedule briefing.');
      return;
    }

    const { getPharmacyOperatingSchedule, getConfiguredPharmacyName } = await import('./storeSettingsService.js');
    const storeName = await getConfiguredPharmacyName(db);
    const operatingSchedule = await getPharmacyOperatingSchedule(db);

    const todayStr = new Date().toISOString().split('T')[0];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayDayName = dayNames[new Date().getDay()];
    const isWeeklyOff = (operatingSchedule.weeklyOff || '').toLowerCase() === todayDayName.toLowerCase();
    const isHoliday = (operatingSchedule.closedDates || []).includes(todayStr);

    let statusLine = '🟢 Open as usual';
    if (isHoliday) {
      statusLine = '🔴 Holiday / Closed today (Orders shifted to next open day)';
    } else if (isWeeklyOff) {
      statusLine = `🟡 Weekly Off (${todayDayName}) (Orders shifted to next open day)`;
    }

    // Due refills today
    const dueRefills = await db.all(
      `SELECT pr.patient_name, m.name as medicine_name, pr.quantity_needed, pr.is_ready, pr.hold_for_stock
       FROM patient_refills pr
       JOIN medicines m ON pr.medicine_id = m.id
       WHERE pr.status = 'pending' AND pr.is_active = 1 AND DATE(pr.next_refill_date) <= DATE('now')
       ORDER BY pr.patient_name ASC LIMIT 20`
    );

    // Active special orders today
    const specialOrders = await db.all(
      `SELECT requester, product, qty, status, pharmarack_distributor
       FROM special_orders
       WHERE (status = 'Confirmed' OR status = 'Pending' OR status = 'Ready') AND DATE(date) >= DATE('now', '-2 days')
       ORDER BY date DESC LIMIT 20`
    );

    let refillsBlock = '• No pending refills for today';
    if (dueRefills.length > 0) {
      refillsBlock = dueRefills.slice(0, 8).map((r, i) => {
        const stockBadge = r.is_ready ? '✅ In Stock' : (r.hold_for_stock ? '⏳ Hold for Stock' : '⚠️ Checking');
        return `${i + 1}. *${r.patient_name}*: ${r.medicine_name} (${stockBadge})`;
      }).join('\n');
      if (dueRefills.length > 8) {
        refillsBlock += `\n...and ${dueRefills.length - 8} more in Refills page`;
      }
    }

    let ordersBlock = '• No pending special orders';
    if (specialOrders.length > 0) {
      ordersBlock = specialOrders.slice(0, 8).map((o, i) => {
        const dist = o.pharmarack_distributor ? ` → ${o.pharmarack_distributor}` : '';
        return `${i + 1}. *${o.requester || 'Customer'}*: ${o.product} × ${o.qty} [${o.status}]${dist}`;
      }).join('\n');
      if (specialOrders.length > 8) {
        ordersBlock += `\n...and ${specialOrders.length - 8} more in Orders page`;
      }
    }

    // Staged reminders breakdown
    const stagedRows = await db.all(`
      SELECT an.id, COALESCE(pr.reminder_mode, c.reminder_mode, 'manual') as reminder_mode
      FROM automation_notifications an
      LEFT JOIN patient_refills pr ON pr.id = CAST(an.reference_id AS INTEGER)
      LEFT JOIN customers c ON (c.phone = an.recipient_phone OR c.name = an.recipient_name)
      WHERE an.type IN ('refill_collection', 'refill_reminder') AND an.status = 'staged'
    `).catch(() => []);
    const autoStagedCount = stagedRows.filter((r: any) => r.reminder_mode === 'auto').length;
    const manualStagedCount = stagedRows.filter((r: any) => r.reminder_mode !== 'auto').length;
    const stagedSummaryLine = stagedRows.length > 0
      ? `🔔 *Staged Reminders for Review*: ${stagedRows.length} total (${autoStagedCount} Auto, ${manualStagedCount} Manual Review)`
      : `🔔 *Staged Reminders*: None pending review`;

    const messageText = `☀️ *Morning Schedule & Refill Briefing* — ${storeName}
📅 *Date*: ${todayStr} (${todayDayName})
🏪 *Store Status*: ${statusLine}

📋 *Refills Due*:
${refillsBlock}

📦 *WhatsApp & Special Orders*:
${ordersBlock}

${stagedSummaryLine}

🔒 *Customer Communication*: Reminders remain STAGED in CRM / Quick Assist. Pharmacist approval required before dispatch.`;

    const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
    await whatsappQueueWorker.enqueue(adminWhatsapp, messageText, 'admin_morning_briefing', 'Admin / Store Owner');
    console.log(`[RefillService] Morning schedule briefing sent to owner ${adminWhatsapp}.`);
  } catch (err) {
    console.error('[RefillService] Failed to send morning schedule briefing to admin:', err);
  }
}

/**
 * Notifies the pharmacy admin WhatsApp with a briefing when new patient reminders are staged.
 */
export async function notifyAdminStagedReminders(db: Database): Promise<void> {
  try {
    const alertSetting = await db.get("SELECT value FROM app_settings WHERE key = 'reminder_admin_preview_enabled'");
    if (alertSetting?.value === 'false') return;

    const { waAdminEscalationService } = await import('./waAdminEscalationService.js');
    const adminWhatsapp = await waAdminEscalationService.resolveAdminWhatsappNumber(db);
    if (!adminWhatsapp) return;

    const stagedRows = await db.all(`
      SELECT an.*,
             COALESCE(pr.reminder_mode, c.reminder_mode, 'manual') as patient_reminder_mode
      FROM automation_notifications an
      LEFT JOIN patient_refills pr ON pr.id = CAST(an.reference_id AS INTEGER)
      LEFT JOIN customers c ON (c.phone = an.recipient_phone OR c.name = an.recipient_name)
      WHERE an.type IN ('refill_collection', 'refill_reminder') AND an.status = 'staged'
    `);

    if (stagedRows.length === 0) return;

    const autoCount = stagedRows.filter((r: any) => r.patient_reminder_mode === 'auto').length;
    const manualCount = stagedRows.filter((r: any) => r.patient_reminder_mode === 'manual').length;
    const storeName = await getConfiguredPharmacyName(db) || 'Pharmacy';

    const msg = `🔔 *Refill Reminder Alert* — ${storeName}\n\n` +
      `${stagedRows.length} patient reminder(s) are staged and waiting for review:\n` +
      `• ${autoCount} set to Auto 🤖\n` +
      `• ${manualCount} set to Manual 👆\n\n` +
      `Review & dispatch in CRM → Refills or Quick Assist.`;

    const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
    await whatsappQueueWorker.enqueue(adminWhatsapp, msg, 'admin_morning_briefing', 'Admin / Store Owner');
  } catch (err) {
    console.error('[RefillService] Failed to notify admin of staged reminders:', err);
  }
}

