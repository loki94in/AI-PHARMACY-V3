import { dbManager } from '../database/connection.js';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';
import { getWhatsAppStatus } from '../whatsappClient.js';
import { eventService } from './eventService.js';
import { getPharmacyOperatingSchedule, getConfiguredPharmacyName, getStorePhone } from './storeSettingsService.js';
import { toLocalSqlDateTime } from '../utils/localTime.js';

let intervalTimer: NodeJS.Timeout | null = null;
let isCycleRunning = false;

export interface CollectionReminderCycleResult {
  status: 'completed' | 'skipped' | 'error';
  reason?: string;
  refillsQueued?: number;
  ordersQueued?: number;
  error?: string;
}

/**
 * Runs a single evaluation cycle for auto-collection reminders.
 * Checks ready medicines in stock whose auto_remind flag is 1,
 * enforces 24h once-daily limit during 10:00 - 18:00 shop operating hours,
 * and enqueues respectful collection reminders over WhatsApp.
 */
export async function runCollectionReminderCycle(force = false): Promise<CollectionReminderCycleResult> {
  if (isCycleRunning) {
    return { status: 'skipped', reason: 'already_running' };
  }
  isCycleRunning = true;

  try {
    const db = await dbManager.getConnection();

    // 1. Master toggle check
    const masterRow = await db.get("SELECT value FROM app_settings WHERE key = 'quick_assist_auto_remind_master'");
    if (masterRow?.value === 'false' && !force) {
      return { status: 'skipped', reason: 'master_disabled' };
    }

    // 2. WhatsApp client readiness check
    const waStatus = await getWhatsAppStatus();
    if (!waStatus?.isReady && !force) {
      return { status: 'skipped', reason: 'wa_not_ready' };
    }

    // 3. Operating hours and store schedule check
    const sched = await getPharmacyOperatingSchedule(db);
    const now = new Date();
    const startRow = await db.get("SELECT value FROM app_settings WHERE key = 'collection_reminder_window_start'");
    const endRow = await db.get("SELECT value FROM app_settings WHERE key = 'collection_reminder_window_end'");
    const startHourMin = startRow?.value || '10:00';
    const endHourMin = endRow?.value || '18:00';
    const currentHourMin = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if ((currentHourMin < startHourMin || currentHourMin > endHourMin) && !force) {
      return { status: 'skipped', reason: `outside_window (${startHourMin}-${endHourMin})` };
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayDayName = dayNames[now.getDay()];
    if ((sched.weeklyOff || '').toLowerCase() === todayDayName.toLowerCase() && !force) {
      return { status: 'skipped', reason: `weekly_off (${todayDayName})` };
    }

    const todayDateStr = toLocalSqlDateTime(now).slice(0, 10);
    if ((sched.closedDates || []).includes(todayDateStr) && !force) {
      return { status: 'skipped', reason: 'holiday_closed' };
    }

    const storeName = (await getConfiguredPharmacyName(db)) || 'Pharmacy';
    const storePhone = await getStorePhone(db);
    const storeLabel = storePhone ? `${storeName} (Ph: ${storePhone})` : storeName;

    let refillsQueued = 0;
    let ordersQueued = 0;

    // 4. Scan ready patient refills with auto_remind = 1 that have not been reminded today
    const readyRefills = await db.all(`
      SELECT pr.id, pr.patient_name, pr.patient_phone, pr.medicine_id, m.name as medicine_name,
             pr.quantity_needed, pr.last_collection_reminder_at, pr.collection_reminder_count,
             COALESCE(pr.language, c.language, 'en') as language
      FROM patient_refills pr
      JOIN medicines m ON pr.medicine_id = m.id
      LEFT JOIN customers c ON (c.phone = pr.patient_phone OR c.name = pr.patient_name)
      WHERE pr.auto_remind = 1
        AND pr.is_ready = 1
        AND pr.is_active = 1
        AND pr.status NOT IN ('completed', 'canceled')
        AND (pr.last_collection_reminder_at IS NULL OR DATE(pr.last_collection_reminder_at) < DATE('now', 'localtime'))
      ORDER BY pr.id ASC
    `);

    // Group refills by patient phone/name
    const refillGroups = new Map<string, {
      patient_name: string;
      patient_phone: string;
      language: string;
      items: Array<{ id: number; medicine_name: string; quantity: number }>;
    }>();

    for (const r of readyRefills) {
      const cleanPhone = (r.patient_phone || '').replace(/\D/g, '');
      const key = cleanPhone.slice(-10) || (r.patient_name || '').trim().toLowerCase();
      if (!key) continue;

      let group = refillGroups.get(key);
      if (!group) {
        group = {
          patient_name: r.patient_name || 'Customer',
          patient_phone: r.patient_phone || '',
          language: (r.language || 'en').toLowerCase(),
          items: []
        };
        refillGroups.set(key, group);
      }
      group.items.push({
        id: r.id,
        medicine_name: r.medicine_name || 'Prescribed Medicine',
        quantity: Number(r.quantity_needed || 1)
      });
    }

    for (const group of refillGroups.values()) {
      if (!group.patient_phone || group.patient_phone.replace(/\D/g, '').length < 10) continue;

      let msg = '';
      if (group.language === 'hi') {
        const medList = group.items.length === 1
          ? `• *${group.items[0].medicine_name}* (मात्रा: ${group.items[0].quantity})`
          : group.items.map(it => `• *${it.medicine_name}* (मात्रा: ${it.quantity})`).join('\n');
        msg = `🔔 *तैयार दवाई संग्रह रिमाइंडर — ${storeName}*\n\n` +
          `नमस्ते ${group.patient_name},\n` +
          `आपकी तैयार की गई दवाई फार्मेसी पर आपके लिए उपलब्ध है:\n\n` +
          `${medList}\n\n` +
          `📍 *दुकान का पता:* ${storeLabel}\n` +
          `🕒 *दुकान का समय:* ${sched.openTime} से ${sched.closeTime}\n\n` +
          `👉 *कृपया अपनी सुविधानुसार दवाई ले जाएं।*`;
      } else if (group.language === 'mr') {
        const medList = group.items.length === 1
          ? `• *${group.items[0].medicine_name}* (प्रमाण: ${group.items[0].quantity})`
          : group.items.map(it => `• *${it.medicine_name}* (प्रमाण: ${it.quantity})`).join('\n');
        msg = `🔔 *तयार औषध संकलन स्मरणपत्र — ${storeName}*\n\n` +
          `नमस्कार ${group.patient_name},\n` +
          `आपली तयार केलेली औषधे फार्मसीमध्ये उपलब्ध आहेत:\n\n` +
          `${medList}\n\n` +
          `📍 *पत्ता:* ${storeLabel}\n` +
          `🕒 *दुकानाची वेळ:* ${sched.openTime} ते ${sched.closeTime}\n\n` +
          `👉 *कृपया आपल्या सोयीनुसार औषध घेऊन जावे.*`;
      } else {
        const medList = group.items.length === 1
          ? `• *${group.items[0].medicine_name}* (Qty: ${group.items[0].quantity})`
          : group.items.map(it => `• *${it.medicine_name}* (Qty: ${it.quantity})`).join('\n');
        msg = `🔔 *READY MEDICINE COLLECTION REMINDER — ${storeName}*\n\n` +
          `Dear ${group.patient_name},\n` +
          `Your packed prescription is waiting and ready for collection at our pharmacy:\n\n` +
          `${medList}\n\n` +
          `📍 *Pickup Location:* ${storeLabel}\n` +
          `🕒 *Store Hours:* ${sched.openTime} to ${sched.closeTime}\n\n` +
          `👉 *Please collect your medicine at your earliest convenience.*`;
      }

      try {
        await whatsappQueueWorker.enqueue(
          group.patient_phone,
          msg,
          'refill_collection',
          group.patient_name,
          undefined,
          undefined,
          undefined,
          { skipDedupe: true } // skip dedupe for recurring collection reminders
        );

        const ids = group.items.map(i => i.id);
        const placeholders = ids.map(() => '?').join(',');
        await db.run(
          `UPDATE patient_refills
           SET last_collection_reminder_at = datetime('now'),
               collection_reminder_count = COALESCE(collection_reminder_count, 0) + 1
           WHERE id IN (${placeholders})`,
          ids
        );

        refillsQueued += ids.length;
      } catch (enqueueErr) {
        console.warn(`[CollectionReminderWorker] Failed to enqueue refill reminder for ${group.patient_name}:`, enqueueErr);
      }
    }

    // 5. Scan ready special orders & online pickup orders with auto_remind = 1 that have not been reminded today
    const readySpecialOrders = await db.all(`
      SELECT so.id, so.requester, so.phone, so.product, so.qty,
             so.last_collection_reminder_at, so.notification_count,
             COALESCE(c.language, 'en') as language
      FROM special_orders so
      LEFT JOIN customers c ON (c.phone = so.phone OR c.name = so.requester)
      WHERE so.auto_remind = 1
        AND so.status IN ('Ready', 'ORDER_READY_FOR_PICKUP')
        AND (so.last_collection_reminder_at IS NULL OR DATE(so.last_collection_reminder_at) < DATE('now', 'localtime'))
      ORDER BY so.id ASC
    `);

    // Group special orders by phone/requester
    const orderGroups = new Map<string, {
      requester: string;
      phone: string;
      language: string;
      items: Array<{ id: number; product: string; qty: number }>;
    }>();

    for (const so of readySpecialOrders) {
      const cleanPhone = (so.phone || '').replace(/\D/g, '');
      const key = cleanPhone.slice(-10) || (so.requester || '').trim().toLowerCase();
      if (!key) continue;

      let group = orderGroups.get(key);
      if (!group) {
        group = {
          requester: so.requester || 'Customer',
          phone: so.phone || '',
          language: (so.language || 'en').toLowerCase(),
          items: []
        };
        orderGroups.set(key, group);
      }
      group.items.push({
        id: so.id,
        product: so.product || 'Medicine',
        qty: Number(so.qty || 1)
      });
    }

    for (const group of orderGroups.values()) {
      if (!group.phone || group.phone.replace(/\D/g, '').length < 10) continue;

      let msg = '';
      if (group.language === 'hi') {
        const medList = group.items.length === 1
          ? `• *${group.items[0].product}* (मात्रा: ${group.items[0].qty})`
          : group.items.map(it => `• *${it.product}* (मात्रा: ${it.qty})`).join('\n');
        msg = `🔔 *दवाई तैयार है — ${storeName}*\n\n` +
          `नमस्ते ${group.requester},\n` +
          `आपकी मंगवाई गई दवाई आ चुकी है और संग्रह के लिए तैयार है:\n\n` +
          `${medList}\n\n` +
          `📍 *दुकान का पता:* ${storeLabel}\n` +
          `🕒 *दुकान का समय:* ${sched.openTime} से ${sched.closeTime}\n\n` +
          `👉 *कृपया अपनी सुविधानुसार दवाई ले जाएं।*`;
      } else if (group.language === 'mr') {
        const medList = group.items.length === 1
          ? `• *${group.items[0].product}* (प्रमाण: ${group.items[0].qty})`
          : group.items.map(it => `• *${it.product}* (प्रमाण: ${it.qty})`).join('\n');
        msg = `🔔 *मागवलेले औषध उपलब्ध आहे — ${storeName}*\n\n` +
          `नमस्कार ${group.requester},\n` +
          `आपण मागवलेले औषध आले असून संकलनासाठी तयार आहे:\n\n` +
          `${medList}\n\n` +
          `📍 *पत्ता:* ${storeLabel}\n` +
          `🕒 *दुकानाची वेळ:* ${sched.openTime} ते ${sched.closeTime}\n\n` +
          `👉 *कृपया आपल्या सोयीनुसार औषध घेऊन जावे.*`;
      } else {
        const medList = group.items.length === 1
          ? `• *${group.items[0].product}* (Qty: ${group.items[0].qty})`
          : group.items.map(it => `• *${it.product}* (Qty: ${it.qty})`).join('\n');
        msg = `🔔 *SPECIAL ORDER READY FOR PICKUP — ${storeName}*\n\n` +
          `Dear ${group.requester},\n` +
          `Your requested medicine has arrived and is ready for collection:\n\n` +
          `${medList}\n\n` +
          `📍 *Pickup Location:* ${storeLabel}\n` +
          `🕒 *Store Hours:* ${sched.openTime} to ${sched.closeTime}\n\n` +
          `👉 *Please collect your medicine at your earliest convenience.*`;
      }

      try {
        await whatsappQueueWorker.enqueue(
          group.phone,
          msg,
          'order_ready',
          group.requester,
          undefined,
          undefined,
          undefined,
          { skipDedupe: true } // skip dedupe
        );

        const ids = group.items.map(i => i.id);
        const placeholders = ids.map(() => '?').join(',');
        await db.run(
          `UPDATE special_orders
           SET last_collection_reminder_at = datetime('now'),
               notification_count = COALESCE(notification_count, 0) + 1
           WHERE id IN (${placeholders})`,
          ids
        );

        ordersQueued += ids.length;
      } catch (enqueueErr) {
        console.warn(`[CollectionReminderWorker] Failed to enqueue special order reminder for ${group.requester}:`, enqueueErr);
      }
    }

    if (refillsQueued > 0 || ordersQueued > 0) {
      eventService.broadcast('refill_updated', { at: Date.now(), autoRemindersSent: refillsQueued });
      eventService.broadcast('special_orders_updated', { at: Date.now(), autoRemindersSent: ordersQueued });
      console.log(`[CollectionReminderWorker] Auto-collection reminder cycle complete: ${refillsQueued} refill item(s) and ${ordersQueued} special order(s) queued.`);
    }

    return {
      status: 'completed',
      refillsQueued,
      ordersQueued
    };
  } catch (err: any) {
    console.error('[CollectionReminderWorker] Error in runCollectionReminderCycle:', err);
    return {
      status: 'error',
      error: err?.message || String(err)
    };
  } finally {
    isCycleRunning = false;
  }
}

/**
 * Starts the periodic auto-collection reminder worker.
 * Runs check every 30 minutes while app server is active.
 */
export function startCollectionReminderWorker(): void {
  if (intervalTimer) return;

  // Run initial cycle check after 15 seconds (to allow WhatsApp initialization)
  setTimeout(() => {
    runCollectionReminderCycle().catch(err => {
      console.error('[CollectionReminderWorker] Initial boot cycle error:', err);
    });
  }, 15000);

  // Periodically check every 30 minutes. Gated on activityTracker.isIdle()
  intervalTimer = setInterval(async () => {
    try {
      const { activityTracker } = await import('../utils/activityTracker.js');
      if (activityTracker.isIdle()) return;
    } catch (_) {}
    runCollectionReminderCycle().catch(err => {
      console.error('[CollectionReminderWorker] Periodic cycle error:', err);
    });
  }, 30 * 60 * 1000);

  console.log('[CollectionReminderWorker] Started auto-collection reminder scheduler (30m interval).');
}

/**
 * Stops the periodic worker if needed.
 */
export function stopCollectionReminderWorker(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
    console.log('[CollectionReminderWorker] Stopped auto-collection reminder scheduler.');
  }
}
