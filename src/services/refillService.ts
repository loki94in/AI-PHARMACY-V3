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

//   const _dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
//   const _weeklyOffLower = (operatingSchedule.weeklyOff || 'monday').toLowerCase();

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
/**
 * Compiles the Daily Operational Briefing message according to the selected or configured template.
 * Supported templates:
 * - 'detailed' (DEFAULT, Template 4): Itemized medicines with quantities and stock badges
 * - 'compact' (Template 1): Grouped by patient without long medicine names
 * - 'checklist' (Template 2): Action checklist format with [ ] checkboxes
 * - 'executive' (Template 3): Ultra-short KPI metrics summary
 */
export async function buildDailyOperationalBriefing(
  db: Database,
  requestedTemplate?: string,
  options?: { forceMilestone?: boolean }
): Promise<{ template: string; messageText: string }> {
  let templateKey: string = requestedTemplate || '';
  if (!templateKey) {
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'daily_briefing_template'").catch(() => null);
    templateKey = (row?.value as string) || 'detailed';
  }
  if (!['detailed', 'compact', 'checklist', 'executive'].includes(templateKey)) {
    templateKey = 'detailed';
  }

  const { getPharmacyOperatingSchedule, getConfiguredPharmacyName } = await import('./storeSettingsService.js');
  const storeName = await getConfiguredPharmacyName(db) || 'Pharmacy';
  const operatingSchedule = await getPharmacyOperatingSchedule(db);

  const todayStr = new Date().toISOString().split('T')[0];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayDayName = dayNames[new Date().getDay()];
  const isWeeklyOff = (operatingSchedule.weeklyOff || '').toLowerCase() === todayDayName.toLowerCase();
  const isHoliday = (operatingSchedule.closedDates || []).includes(todayStr);

  let statusLine = '🟢 Open as usual';
  if (isHoliday) {
    statusLine = '🔴 Holiday / Closed today';
  } else if (isWeeklyOff) {
    statusLine = `🟡 Weekly Off (${todayDayName})`;
  }

  // Refill summary (7 days)
  const refillRows = await db.all(`
    SELECT pr.patient_name,
           MIN(DATE(pr.next_refill_date)) as earliest_due,
           COUNT(pr.id) as med_count,
           SUM(CASE WHEN (pr.is_ready = 1 OR COALESCE(inv.total_qty, 0) >= COALESCE(pr.quantity_needed, 1)) THEN 1 ELSE 0 END) as in_stock_count,
           SUM(CASE WHEN (pr.is_ready = 0 AND COALESCE(inv.total_qty, 0) < COALESCE(pr.quantity_needed, 1)) THEN 1 ELSE 0 END) as out_of_stock_count
    FROM patient_refills pr
    LEFT JOIN (
      SELECT medicine_id, SUM(quantity) + COALESCE(SUM(loose_quantity), 0) as total_qty
      FROM inventory_master
      GROUP BY medicine_id
    ) inv ON inv.medicine_id = pr.medicine_id
    WHERE pr.is_active = 1
      AND pr.status IN ('pending', 'notified', 'staged')
      AND DATE(pr.next_refill_date) <= DATE('now', 'localtime', '+7 days')
    GROUP BY pr.patient_name
    ORDER BY earliest_due ASC, pr.patient_name ASC
    LIMIT 15
  `).catch(() => []);

  // Detailed refill items (with medicine names & quantities) — no aggregate collapse so all medicines appear
  const refillDetailRows = await db.all(`
    SELECT pr.patient_name, m.name as medicine_name, pr.quantity_needed,
           DATE(pr.next_refill_date) as due_date,
           CASE WHEN (pr.is_ready = 1 OR COALESCE(inv.total_qty, 0) >= COALESCE(pr.quantity_needed, 1)) THEN 1 ELSE 0 END as in_stock
    FROM patient_refills pr
    JOIN medicines m ON pr.medicine_id = m.id
    LEFT JOIN (
      SELECT medicine_id, SUM(quantity) + COALESCE(SUM(loose_quantity), 0) as total_qty
      FROM inventory_master
      GROUP BY medicine_id
    ) inv ON inv.medicine_id = pr.medicine_id
    WHERE pr.is_active = 1
      AND pr.status IN ('pending', 'notified', 'staged')
      AND DATE(pr.next_refill_date) <= DATE('now', 'localtime', '+7 days')
    ORDER BY DATE(pr.next_refill_date) ASC, pr.patient_name ASC
    LIMIT 50
  `).catch(() => []);

  // Pending call tasks
  const pendingCallTasks = await db.get(
    "SELECT COUNT(*) as count FROM patient_call_tasks WHERE status IN ('pending', 'rescheduled')"
  ).catch(() => ({ count: 0 }));
  const callCount = Number(pendingCallTasks?.count || 0);

  // Active special, website, and online orders
  const activeOrders = await db.all(
    `SELECT requester, product, qty, status, customer_order_source
     FROM special_orders
     WHERE status IN ('Confirmed', 'Pending', 'Ready', 'In-Transit', 'Dispatched')
       AND DATE(date) >= DATE('now', 'localtime', '-7 days')
     ORDER BY date DESC, id DESC LIMIT 15`
  ).catch(() => []);

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

  const dueMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatDate = (ymd: string) => {
    if (!ymd) return 'Due soon';
    const parts = ymd.split('-');
    if (parts.length === 3) {
      return `${parts[2]} ${dueMonthNames[parseInt(parts[1], 10) - 1] || parts[1]}`;
    }
    return ymd;
  };

  let ordersBlock = '• No pending orders';
  if (activeOrders.length > 0) {
    ordersBlock = activeOrders.map((o: any, i: number) => {
      const rawSrc = (o.customer_order_source || '').toLowerCase();
      let srcBadge = 'Special Order';
      if (rawSrc === 'website') srcBadge = 'Website Order';
      else if (rawSrc === 'whatsapp') srcBadge = 'WhatsApp Order';
      else if (rawSrc === 'online' || rawSrc === 'portal') srcBadge = 'Online Order';
      else if (rawSrc) srcBadge = `${o.customer_order_source} Order`;

      return `${i + 1}. *${o.requester || 'Customer'}* [${srcBadge}]: ${o.product} × ${o.qty} (${o.status})`;
    }).join('\n');
  }

  // 24-Hour Incomplete Order Calendar-Aware SLA Audit
  let incomplete24hAudit: any = { overdue: [], marketPaused: [], stats: { totalOverdueCount: 0, totalPausedCount: 0, totalOverdueMedicines: 0, totalPausedMedicines: 0 } };
  try {
    const { orderScheduleService } = await import('./orderScheduleService.js');
    incomplete24hAudit = await orderScheduleService.evaluateIncompleteOrders24hSLA({ dbInstance: db, cutoffHours: 24 });
  } catch (err) {
    console.warn('[RefillService] Failed to evaluate 24h incomplete orders SLA:', err);
  }

  let slaBlock = '';
  const slaLines: string[] = [];
  if (incomplete24hAudit.overdue.length > 0) {
    const overdueDetails = incomplete24hAudit.overdue.slice(0, 5).map((c: any, idx: number) => {
      const medStr = c.medicines.map((m: any) => `${m.name} × ${m.qty}`).join(', ');
      return `  ${idx + 1}. *${c.name}*: ${medStr} (${c.elapsedHours}h ago • 🚨 Action Needed)`;
    }).join('\n');
    const extraOverdue = incomplete24hAudit.overdue.length > 5 ? `\n  ...and ${incomplete24hAudit.overdue.length - 5} more overdue` : '';
    slaLines.push(`🚨 *OVERDUE (>24h SLA BREACH — ${incomplete24hAudit.overdue.length} Orders)*:\n${overdueDetails}${extraOverdue}`);
  }
  if (incomplete24hAudit.marketPaused.length > 0) {
    const pausedDetails = incomplete24hAudit.marketPaused.slice(0, 5).map((c: any, _idx: number) => {
      const medStr = c.medicines.map((m: any) => `${m.name} × ${m.qty}`).join(', ');
      const resumeStr = c.resumedWorkingDate ? ` • Resumes: ${c.resumedWorkingDate}` : '';
      return `  • *${c.name}*: ${medStr} (${c.pauseReason || 'Market closure'}${resumeStr})`;
    }).join('\n');
    const extraPaused = incomplete24hAudit.marketPaused.length > 5 ? `\n  ...and ${incomplete24hAudit.marketPaused.length - 5} more paused` : '';
    slaLines.push(`⏸️ *MARKET CLOSURE / PAUSE HELD (${incomplete24hAudit.marketPaused.length} Orders)*:\n${pausedDetails}${extraPaused}`);
  }
  if (slaLines.length > 0) {
    slaBlock = `\n\n⏱️ *24-HOUR FULFILLMENT WATCH*:\n` + slaLines.join('\n\n');
  }

  // Daily operational tasks to ensure no work is missed
  const outOfStockRefills = refillDetailRows.filter((r: any) => !r.in_stock);
  const dailyTasks: string[] = [];
  if (incomplete24hAudit.overdue.length > 0) {
    dailyTasks.push(`🚨 *Expedite ${incomplete24hAudit.overdue.length} Overdue Order(s)*: Breached 24h SLA — push to Pharmarack or contact distributor`);
  }
  if (outOfStockRefills.length > 0) {
    const holdPatients = Array.from(new Set(outOfStockRefills.map((r: any) => r.patient_name)));
    dailyTasks.push(`⚠️ *Urgent Stock Reorder Needed*: Stock required for ${holdPatients.join(', ')}`);
  }
  if (callCount > 0) {
    dailyTasks.push(`📞 *Patient Follow-up Calls*: ${callCount} pending call(s) on CRM Call Board`);
  }
  if (stagedRows.length > 0) {
    dailyTasks.push(`🔔 *Staged Customer Reminders*: ${stagedRows.length} reminder(s) pending in CRM (${autoStagedCount} Auto, ${manualStagedCount} Manual)`);
  }

  let dailyTasksBlock = '';
  if (dailyTasks.length > 0) {
    dailyTasksBlock = `\n\n⚡ *TODAY'S OPERATIONAL TASKS*:\n` + dailyTasks.map((t, idx) => `${idx + 1}. ${t}`).join('\n');
  }

  // Date-Driven Auto-Add: Periodic Expiry Audit & Overdue Credit on milestone dates (1st, 15-18th, month-end, or trigger_expiry_scan_days)
  const now = new Date();
  const todayDayOfMonth = now.getDate();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  // Read configured expiry scan days from settings (defaults to '1,16')
  const scanDaysRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_expiry_scan_days'").catch(() => null);
  const configuredScanDays = (scanDaysRow?.value || '1,16')
    .split(',')
    .map((s: string) => parseInt(s.trim(), 10))
    .filter((n: number) => !isNaN(n));

  const isMilestoneDate = Boolean(options?.forceMilestone) ||
                          todayDayOfMonth === 1 ||
                          (todayDayOfMonth >= 15 && todayDayOfMonth <= 18) ||
                          todayDayOfMonth === lastDayOfMonth ||
                          configuredScanDays.includes(todayDayOfMonth);

  let expCount = 0;
  let overdueCreditCount = 0;
  let overdueCreditTotal = 0;
  let milestoneBlock = '';

  if (isMilestoneDate) {
    const currentMonth = todayStr.slice(0, 7);
    const expRow = await db.get(
      `SELECT COUNT(*) as count FROM inventory_master WHERE quantity > 0 AND (expiry_date = ? OR expiry_date LIKE ?)`,
      [currentMonth, `${currentMonth}%`]
    ).catch(() => ({ count: 0 }));
    expCount = Number(expRow?.count || 0);

    const creditRow = await db.get(
      `SELECT COUNT(*) as cust_count, COALESCE(SUM(credit_balance), 0) as total_balance
       FROM customers
       WHERE credit_due_date IS NOT NULL
         AND date(credit_due_date) <= date('now', 'localtime')
         AND credit_balance > 0`
    ).catch(() => ({ cust_count: 0, total_balance: 0 }));
    overdueCreditCount = Number(creditRow?.cust_count || 0);
    overdueCreditTotal = Number(creditRow?.total_balance || 0);

    const milestoneLabel = todayDayOfMonth === 1
      ? 'Monthly Start Audit'
      : (todayDayOfMonth === lastDayOfMonth ? 'Month-End Audit' : 'Mid-Month Review');

    const auditItems: string[] = [];
    if (expCount > 0) {
      auditItems.push(`⚠️ *EXPIRY AUDIT (${milestoneLabel})*:\n• ${expCount} batch(es) expiring this month (${todayStr.slice(5, 7)}/${todayStr.slice(0, 4)}) — check for supplier return`);
    }
    if (overdueCreditCount > 0) {
      auditItems.push(`💰 *OVERDUE CREDIT AUDIT*:\n• ₹${overdueCreditTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })} overdue across ${overdueCreditCount} customer(s)`);
    }

    if (auditItems.length > 0) {
      milestoneBlock = '\n\n' + auditItems.join('\n\n');
    }
  }

  let messageText = '';

  if (templateKey === 'detailed') {
    // TEMPLATE 4 (DEFAULT): Itemized detailed list with medicine names
    const patientGroups = new Map<string, any[]>();
    for (const row of refillDetailRows) {
      const list = patientGroups.get(row.patient_name) || [];
      list.push(row);
      patientGroups.set(row.patient_name, list);
    }

    let t4Details = '• No refills due in next 7 days';
    if (patientGroups.size > 0) {
      let pIdx = 1;
      const pBlocks: string[] = [];
      for (const [pName, meds] of patientGroups.entries()) {
        const dueStr = meds[0]?.due_date ? formatDate(meds[0].due_date) : '';
        const medLines = meds.map(m => `   - ${m.medicine_name} × ${m.quantity_needed || 1} (${m.in_stock ? '✅ Stock' : '⏳ Hold'})`).join('\n');
        pBlocks.push(`${pIdx++}. *${pName}* (Due ${dueStr}):\n${medLines}`);
      }
      t4Details = pBlocks.join('\n');
    }

    messageText = `☀️ *DAILY OPERATIONAL BRIEFING* — ${storeName}
📅 *Date*: ${todayStr} (${todayDayName})
🏪 *Store Status*: ${statusLine}

📋 *REFILL PRESCRIPTIONS (Next 7 Days)*:
${t4Details}

📦 *TODAY'S SPECIAL & ONLINE ORDERS*:
${ordersBlock}${slaBlock}${dailyTasksBlock}${milestoneBlock}`;

  } else if (templateKey === 'compact') {
    // TEMPLATE 1: Compact worklist (no medicine names)
    let t1Refills = '• No refills due in next 7 days';
    if (refillRows.length > 0) {
      t1Refills = refillRows.map((r: any, i: number) => {
        const stockStatus = r.out_of_stock_count === 0 ? '✅ In Stock' : (r.in_stock_count === 0 ? '⏳ Hold for Stock' : '⚠️ Partial Stock');
        const medUnit = Number(r.med_count) === 1 ? '1 med' : `${r.med_count} meds`;
        return `${i + 1}. *${r.patient_name}* (Due ${formatDate(r.earliest_due)}) — ${medUnit} (${stockStatus})`;
      }).join('\n');
    }

    messageText = `☀️ *DAILY OPERATIONAL BRIEFING* — ${storeName}
📅 *Date*: ${todayStr} (${todayDayName})
🏪 *Store Status*: ${statusLine}

📋 *1. REFILLS WORKLIST (Next 7 Days)*:
${t1Refills}

📦 *2. SPECIAL & ONLINE ORDERS*:
${ordersBlock}${slaBlock}${dailyTasksBlock}${milestoneBlock}`;

  } else if (templateKey === 'checklist') {
    // TEMPLATE 2: Action checklist [ ]
    const t2Items: string[] = [];
    if (incomplete24hAudit.overdue.length > 0) {
      t2Items.push(`[ ] *24H OVERDUE ESCALATION*: Expedite ${incomplete24hAudit.overdue.length} order(s) breaching 24h SLA (${incomplete24hAudit.stats.totalOverdueMedicines} meds)`);
    }
    if (incomplete24hAudit.marketPaused.length > 0) {
      t2Items.push(`[ ] *MONITOR PAUSED ORDERS*: ${incomplete24hAudit.marketPaused.length} order(s) held for next open market day`);
    }
    const holdRefills = refillRows.filter((r: any) => r.out_of_stock_count > 0);
    if (holdRefills.length > 0) {
      t2Items.push(`[ ] *URGENT REORDER*: ${holdRefills.map((r: any) => r.patient_name).join(', ')} (Stock Needed)`);
    }
    const inStockRefills = refillRows.filter((r: any) => r.out_of_stock_count === 0);
    if (inStockRefills.length > 0) {
      t2Items.push(`[ ] *PACK REFILLS*: ${inStockRefills.map((r: any) => `${r.patient_name} (${formatDate(r.earliest_due)})`).join(', ')}`);
    }
    if (activeOrders.length > 0) {
      t2Items.push(`[ ] *ORDERS FULFILLMENT*: Process ${activeOrders.length} special/online order(s)`);
    }
    if (callCount > 0) {
      t2Items.push(`[ ] *CALL REMINDERS*: Complete ${callCount} pending calls on Call Board`);
    }
    if (isMilestoneDate && expCount > 0) {
      t2Items.push(`[ ] *EXPIRY PACKING*: Check & return ${expCount} batches expiring this month`);
    }
    if (isMilestoneDate && overdueCreditCount > 0) {
      t2Items.push(`[ ] *CREDIT FOLLOW-UP*: Follow up ₹${overdueCreditTotal.toFixed(0)} overdue credit across ${overdueCreditCount} customer(s)`);
    }
    if (stagedRows.length > 0) {
      t2Items.push(`[ ] *APPROVE NOTIFICATIONS*: Review ${stagedRows.length} staged reminder(s) in CRM`);
    }
    if (t2Items.length === 0) {
      t2Items.push(`[ ] All morning operational queues are clear!`);
    }

    messageText = `☀️ *MORNING ACTION CHECKLIST* — ${storeName}
📅 *Date*: ${todayStr} (${todayDayName}) | ${statusLine}

⚡ *TODAY'S OPERATIONAL TO-DO LIST*:
${t2Items.map((item, idx) => `${idx + 1}. ${item}`).join('\n\n')}`;

  } else {
    // TEMPLATE 3: Executive summary
    const totalRefillsDue = refillRows.reduce((acc: number, r: any) => acc + (r.med_count || 1), 0);
    let milestoneMetrics = '';
    if (isMilestoneDate) {
      milestoneMetrics = `\n• ⚠️ Expiring Batches: *${expCount}*\n• 💰 Overdue Credit: *₹${overdueCreditTotal.toFixed(0)}* (${overdueCreditCount} cust)`;
    }

    messageText = `☀️ *DAILY EXECUTIVE SUMMARY* — ${storeName}
📅 *Date*: ${todayStr} (${todayDayName}) | ${statusLine}

📊 *Morning KPI Dashboard*:
• 📋 Refills Due (7d): *${totalRefillsDue} meds* (${refillRows.length} patient(s))
• 📦 Active Orders: *${activeOrders.length}*
• ⏱️ 24h SLA Overdue: *${incomplete24hAudit.stats.totalOverdueCount}* (${incomplete24hAudit.stats.totalOverdueMedicines} meds)
• ⏸️ Market-Paused Held: *${incomplete24hAudit.stats.totalPausedCount}*
• 📞 Pending Calls: *${callCount}*
• 🔔 Staged Reminders: *${stagedRows.length}*${milestoneMetrics}`;
  }

  return { template: templateKey, messageText };
}

/**
 * Sends a morning operational briefing strictly to the Store Owner's WhatsApp.
 * Summarizes today's refills, special orders, and whether today has pause/holiday rules.
 * Does NOT send any automated messages to patients.
 */
export async function sendMorningScheduleBriefingToAdmin(
  db: Database,
  templateKey?: string,
  options?: { forceMilestone?: boolean }
): Promise<{ success: boolean; message?: string }> {
  try {
    const { waAdminEscalationService } = await import('./waAdminEscalationService.js');
    const adminWhatsapp = await waAdminEscalationService.resolveAdminWhatsappNumber(db);
    if (!adminWhatsapp) {
      console.log('[RefillService] No store owner WhatsApp configured for morning schedule briefing.');
      return { success: false, message: 'No store owner WhatsApp configured in Settings.' };
    }

    const { template, messageText } = await buildDailyOperationalBriefing(db, templateKey, options);

    const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
    await whatsappQueueWorker.enqueue(adminWhatsapp, messageText, 'admin_morning_briefing', 'Admin / Store Owner', undefined, undefined, undefined, { skipDedupe: true });
    console.log(`[RefillService] Morning operational task briefing (${template}) sent to owner ${adminWhatsapp}.`);
    return { success: true, message: `Briefing sent successfully using ${template} template.` };
  } catch (err: any) {
    console.error('[RefillService] Failed to send morning schedule briefing to admin:', err);
    return { success: false, message: err?.message || 'Failed to send briefing' };
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

