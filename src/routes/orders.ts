import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
// import { fileURLToPath } from 'url';
import { normalizeWhatsAppPhone, ensureWhatsAppReady } from '../whatsappClient.js';
import { getStoreMedicalName, getStoreMedicalNameAndPhone, buildOrderReadyNotificationMessage, buildMultiOrderNotificationMessage, type MultiOrderItemArrival } from '../services/storeSettingsService.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';
import { pdfInvoiceService } from '../services/pdfInvoiceService.js';
import { eventService } from '../services/eventService.js';
import { getAppDataDir } from '../config/index.js';
import { formatCustomerName } from '../utils/nameFormatter.js';
import { resolveStoreId } from '../services/storeContextService.js';
import { returnWindowService } from '../services/returnWindowService.js';
import { orderScheduleService } from '../services/orderScheduleService.js';
import { paymentQrService } from '../services/paymentQrService.js';

// const __filename = fileURLToPath(import.meta.url);



const router = express.Router();

// P1 push event: special-order UI updates with sub-2ms delta streaming
const broadcastOrdersChanged = (delta?: { action: string; orderId: number; patch?: any }) => {
  try {
    if (delta) {
      eventService.broadcast('order_delta', delta);
    }
    eventService.broadcast('order_updated', { at: Date.now(), delta });
  } catch (_) {}
};

let ordersTableInitialized = false;

async function initOrdersTable(db: any) {
  if (ordersTableInitialized) return;
  try {
    const cols = await db.all('PRAGMA table_info(special_orders)');
    const colNames = new Set(cols.map((c: any) => c.name));
    if (!colNames.has('notification_count')) {
      await db.run('ALTER TABLE special_orders ADD COLUMN notification_count INTEGER DEFAULT 0');
    }
    if (!colNames.has('cart_add_error')) {
      await db.run('ALTER TABLE special_orders ADD COLUMN cart_add_error TEXT DEFAULT NULL');
    }
  } catch (_) {}
  ordersTableInitialized = true;
}

// List special requests / orders
router.get('/', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    const storeId = resolveStoreId(req);
    const allStores = req.query.all_stores === 'true';

    let orders;
    try {
      if (allStores) {
        orders = await db.all('SELECT * FROM special_orders ORDER BY created_at DESC, id DESC LIMIT 1000');
      } else {
        orders = await db.all('SELECT * FROM special_orders WHERE store_id = ? ORDER BY created_at DESC, id DESC LIMIT 1000', [storeId]);
      }
    } catch (_) {
      if (allStores) {
        orders = await db.all('SELECT * FROM special_orders ORDER BY id DESC LIMIT 1000');
      } else {
        orders = await db.all('SELECT * FROM special_orders WHERE store_id = ? ORDER BY id DESC LIMIT 1000', [storeId]);
      }
    }
    res.json(orders);
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Log batch request / orders for multiple items in ONE single WhatsApp notification
router.post('/batch', async (req, res) => {
  const { 
    items, 
    requester, 
    phone, 
    priority = 'Normal', 
    status = 'Pending',
    advance_payment = 0,
    sendWhatsApp = false,
    store_id
  } = req.body;

  const targetStoreId = store_id !== undefined ? (parseInt(String(store_id), 10) || 1) : resolveStoreId(req);

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one medicine item is required' });
  }

  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
    const cleanReqName = formatCustomerName(requester);
    const todayStr = new Date().toISOString();
    const insertedOrders: Array<{ id: number; product: string; qty: number }> = [];

    // Calculate fulfilment schedule via OrderScheduleService
    const calculatedSchedule = await orderScheduleService.calculateOrderSchedule(new Date(), targetStoreId);

    await db.run('BEGIN TRANSACTION');
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const medName = (item.product || item.medicine_name || item.name || '').trim();
        if (!medName) continue;
        const itemQty = Number(item.qty) || 1;
        const itemAdv = i === 0 && advance_payment ? Number(advance_payment) : Number(item.advance_payment || 0);

        // notified tracks whether the ARRIVAL notification has been sent (on Mark Ready).
        // It starts as 0 so marking the order Ready will trigger the arrival WhatsApp.
        const initialNotified = 0;
        const initialStatus = item.status || status || 'Pending';

        // Universal Catalog Linkage: resolve canonical medicine_id if not explicitly provided
        let resolvedMedicineId = item.medicine_id ? Number(item.medicine_id) : null;
        if (!resolvedMedicineId && medName) {
          const medRow = await db.get(
            `SELECT id FROM medicines WHERE name = ? COLLATE NOCASE OR canonical_name = ? COLLATE NOCASE LIMIT 1`,
            [medName, medName]
          );
          if (medRow) {
            resolvedMedicineId = medRow.id;
          }
        }

        const result = await db.run(
          `INSERT INTO special_orders (
            store_id, medicine_id, medicine_name, product, requester, phone, qty, priority, status, date, notified,
            pharmarack_distributor, pharmarack_rate, pharmarack_mrp, pharmarack_mapped, pharmarack_scheme, advance_payment, notification_count,
            scheduled_processing_at, estimated_delivery_start, estimated_delivery_end,
            cutoff_at, pharmacy_timezone, schedule_status, schedule_reason, schedule_version,
            schedule_calculated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            targetStoreId,
            resolvedMedicineId,
            medName,
            medName,
            cleanReqName,
            cleanPhone,
            itemQty,
            item.priority || priority,
            initialStatus,
            todayStr,
            initialNotified,
            item.distributor || item.pharmarack_distributor || null,
            item.rate !== undefined ? item.rate : (item.pharmarack_rate !== undefined ? item.pharmarack_rate : null),
            item.mrp !== undefined ? item.mrp : (item.pharmarack_mrp !== undefined ? item.pharmarack_mrp : null),
            item.mapped ? 1 : (item.pharmarack_mapped ? 1 : 0),
            item.scheme || item.pharmarack_scheme || null,
            itemAdv,
            calculatedSchedule.scheduledProcessingAt,
            calculatedSchedule.estimatedDeliveryStart,
            calculatedSchedule.estimatedDeliveryEnd,
            calculatedSchedule.cutoffAt,
            calculatedSchedule.timezone,
            calculatedSchedule.scheduleStatus,
            calculatedSchedule.scheduleReason,
            calculatedSchedule.scheduleVersion,
            calculatedSchedule.calculatedAt
          ]
        );

        insertedOrders.push({
          id: result.lastID || 0,
          product: medName,
          qty: itemQty
        });
      }
      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    // Send ONE SINGLE CONSOLIDATED WHATSAPP MESSAGE for all items in the order IF user explicitly requested sendWhatsApp
    if (Boolean(sendWhatsApp || req.body.sendWhatsApp) && cleanPhone) {
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const medicalName = await getStoreMedicalNameAndPhone(db);
      const advMsg = advance_payment && Number(advance_payment) > 0 ? ` (Advance Paid: ₹${Number(advance_payment).toFixed(2)})` : '';
      
      const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      const lang = req.body.language || custRow?.language || 'en';
      
      let itemsListStr = '';
      if (insertedOrders.length === 1) {
        itemsListStr = `${insertedOrders[0].product}`;
      } else {
        itemsListStr = '\n' + insertedOrders.map((o, idx) => `${idx + 1}. ${o.product}`).join('\n');
      }

      let msg = '';
      if (lang === 'hi') {
        msg = `नमस्ते ${cleanReqName}, ${medicalName} पर आपकी ${itemsListStr}${advMsg} का ऑर्डर बुक कर लिया गया है। दवाई आने पर हम आपको सूचित करेंगे।`;
      } else if (lang === 'mr') {
        msg = `नमस्कार ${cleanReqName}, ${medicalName} येथे आपली ${itemsListStr}${advMsg} ची ऑर्डर बुक करण्यात आली आहे. औषध आल्यावर आम्ही आपल्याला कळवू.`;
      } else {
        msg = `Hi ${cleanReqName}, your order for ${itemsListStr}${advMsg} has been booked at ${medicalName}. We will notify you when it arrives.`;
      }
      
      try {
        await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order_batch', cleanReqName);
        console.log(`Consolidated special order confirmation WhatsApp queued for ${cleanReqName} (${insertedOrders.length} items)`);
        
        for (const o of insertedOrders) {
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['quick_order_batch', cleanReqName, formattedPhone, msg, 'queued', String(o.id)]
          );
        }
      } catch (waErr: any) {
        console.error('Failed to queue special order confirmation WhatsApp:', waErr);
      }
    }

    broadcastOrdersChanged();
    res.json({ success: true, message: `Successfully logged ${insertedOrders.length} special request(s)`, orders: insertedOrders });
  } catch (err: any) {
    console.error('Batch create special orders error:', err);
    res.status(500).json({ error: 'Failed to create special orders: ' + (err.message || 'Unknown error') });
  }
});

// Log single special request / order
router.post('/', async (req, res) => {
  const { 
    requester, 
    phone, 
    product, 
    medicine_name,
    qty = 1, 
    priority = 'Normal', 
    status = 'Pending',
    pharmarack_distributor,
    pharmarack_rate,
    pharmarack_mrp,
    pharmarack_mapped = 0,
    pharmarack_scheme,
    advance_payment,
    store_id,
    customer_order_source = 'in_store',
    prescription_url,
    product_image_url,
    notes,
    pharmarack_product_id,
    pharmarack_product_code,
    pharmarack_store_id,
    pharmarack_product_name
  } = req.body;

  const targetStoreId = store_id !== undefined ? (parseInt(String(store_id), 10) || 1) : resolveStoreId(req);

  const reqProduct = product || medicine_name;
  if (!requester || !reqProduct) {
    return res.status(400).json({ error: 'Requester name and product name are required' });
  }

  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    
    // Auto-sync customer to CRM contacts table if phone is provided
    if (cleanPhone && cleanPhone.length >= 10) {
      try {
        const existingCust = await db.get('SELECT id, name FROM customers WHERE phone = ?', [cleanPhone]);
        if (!existingCust) {
          await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [requester.trim(), cleanPhone]);
        }
      } catch (_) {}
    }

    const todayStr = new Date().toISOString();
    const medName = reqProduct.trim();

    // Calculate fulfilment schedule via OrderScheduleService
    const calculatedSchedule = await orderScheduleService.calculateOrderSchedule(new Date(), targetStoreId);

    // notified tracks whether the ARRIVAL notification has been sent (on Mark Ready).
    // It starts as 0 so marking the order Ready will trigger the arrival WhatsApp.
    const initialNotified = 0;
    const initialStatus = status || 'Pending';
    const result = await db.run(
      `INSERT INTO special_orders (
        store_id, product, requester, phone, qty, priority, status, date, notified,
        pharmarack_distributor, pharmarack_rate, pharmarack_mrp, pharmarack_mapped, pharmarack_scheme, advance_payment,
        customer_order_source, prescription_url, product_image_url, notes, notification_count,
        scheduled_processing_at, estimated_delivery_start, estimated_delivery_end,
        cutoff_at, pharmacy_timezone, schedule_status, schedule_reason, schedule_version,
        schedule_calculated_at, pharmarack_product_id, pharmarack_product_code, pharmarack_store_id, pharmarack_product_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        targetStoreId,
        medName,
        requester.trim(),
        cleanPhone,
        Number(qty) || 1,
        priority || 'Normal',
        initialStatus,
        todayStr,
        initialNotified,
        pharmarack_distributor || null,
        pharmarack_rate !== undefined ? pharmarack_rate : null,
        pharmarack_mrp !== undefined ? pharmarack_mrp : null,
        pharmarack_mapped ? 1 : 0,
        pharmarack_scheme || null,
        advance_payment !== undefined && advance_payment !== null ? Number(advance_payment) : 0.0,
        customer_order_source,
        prescription_url || null,
        product_image_url || null,
        notes || null,
        calculatedSchedule.scheduledProcessingAt,
        calculatedSchedule.estimatedDeliveryStart,
        calculatedSchedule.estimatedDeliveryEnd,
        calculatedSchedule.cutoffAt,
        calculatedSchedule.timezone,
        calculatedSchedule.scheduleStatus,
        calculatedSchedule.scheduleReason,
        calculatedSchedule.scheduleVersion,
        calculatedSchedule.calculatedAt,
        pharmarack_product_id ? Number(pharmarack_product_id) : null,
        pharmarack_product_code || null,
        pharmarack_store_id ? Number(pharmarack_store_id) : null,
        pharmarack_product_name || null
      ]
    );
    
    // Send confirmation message to customer via WhatsApp ONLY IF user explicitly requested it
    if (Boolean(req.body.sendWhatsApp) && phone) {
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const medicalName = await getStoreMedicalNameAndPhone(db);
      const advMsg = advance_payment && Number(advance_payment) > 0 ? ` (Advance Paid: ₹${Number(advance_payment).toFixed(2)})` : '';
      const cleanReqName = formatCustomerName(requester);
      
      const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      const lang = req.body.language || custRow?.language || 'en';

      let msg = '';
      if (lang === 'hi') {
        msg = `नमस्ते ${cleanReqName}, ${medicalName} पर आपकी ${medName}${advMsg} का ऑर्डर बुक कर लिया गया है। दवाई आने पर हम आपको सूचित करेंगे।`;
      } else if (lang === 'mr') {
        msg = `नमस्कार ${cleanReqName}, ${medicalName} येथे आपली ${medName}${advMsg} ची ऑर्डर बुक करण्यात आली आहे. औषध आल्यावर आम्ही आपल्याला कळवू.`;
      } else {
        msg = `Hi ${cleanReqName}, your order for ${medName}${advMsg} has been booked at ${medicalName}. We will notify you when it arrives.`;
      }
      
      try {
        await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order', cleanReqName);
        console.log(`Special order confirmation WhatsApp queued for ${cleanReqName}`);
        
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['quick_order', cleanReqName, formattedPhone, msg, 'queued', String(result.lastID)]
        );
      } catch (waErr: any) {
        console.error('Failed to queue special order confirmation WhatsApp:', waErr);
      }
    }

    // Auto-match distributor if not mapped
    if (!pharmarack_mapped) {
      try {
        const mapping = await db.get(
          `SELECT store_name, rate, mrp FROM pharmarack_catalog_cache 
           WHERE LOWER(item_name) = LOWER(?) LIMIT 1`,
          [medName]
        );
        if (mapping?.store_name) {
          await db.run(
            `UPDATE special_orders 
             SET pharmarack_distributor = ?, pharmarack_rate = ?, pharmarack_mrp = ?, pharmarack_mapped = 1 
             WHERE id = ?`,
            [mapping.store_name, mapping.rate, mapping.mrp, result.lastID]
          );
        }
      } catch (matchErr) {
        console.error('Failed auto-matching distributor for special order:', matchErr);
      }
    }

    // Auto-sync customer to CRM contacts table if phone is provided
    if (cleanPhone && cleanPhone.length >= 10) {
      try {
        const existingCust = await db.get('SELECT id, name FROM customers WHERE phone = ?', [cleanPhone]);
        if (!existingCust) {
          await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [requester.trim(), cleanPhone]);
        }
      } catch (_) {}
    }

    broadcastOrdersChanged();
    res.json({ success: true, message: 'Request logged successfully' });
  } catch (err) {
    console.error('Create order request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Shared helper: queue the localized "order ready / medicine arrived" WhatsApp for a special order.
// Used by notify-arrival (explicit button) and status transitions to 'Ready' (Mark Ready / Resend click).
async function enqueueArrivalWhatsApp(db: any, order: any, options?: { skipDedupe?: boolean; forceResend?: boolean; skipWhatsApp?: boolean }): Promise<boolean> {
  if (options?.skipWhatsApp) return false;
  const cleanPhone = String(order.phone || '').replace(/\D/g, '');
  if (!cleanPhone) return false;

  const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
  const last10 = cleanPhone.slice(-10);
  const sixtyMinutesAgoMs = Date.now() - 60 * 60 * 1000;

  const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
  const lang = custRow?.language || 'en';

  const msg = await buildOrderReadyNotificationMessage(order.requester, order.product, order.qty, db, lang);

  // 60-minute duplicate safeguard: suppress duplicate arrival messages for the SAME medicine/order within 60 minutes
  // unless forceResend or skipDedupe is set. Does NOT suppress different medicines for the same customer.
  if (!options?.forceResend && !options?.skipDedupe) {
    const recentQueue = await db.get(
      `SELECT id, created_at FROM whatsapp_send_queue
       WHERE (number LIKE ? OR number LIKE ?)
         AND type = 'special_order'
         AND message = ?
         AND status NOT IN ('cancelled', 'failed_perm')
         AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
      [`%${last10}%`, `%${formattedPhone}%`, msg, sixtyMinutesAgoMs]
    );

    if (recentQueue) {
      console.log(`[Arrival Safeguard] Suppressed duplicate arrival notification for ${cleanPhone} (same medicine already queued within 60m, queue ID: ${recentQueue.id}).`);
      return false;
    }
  }

  let pdfPath: string | undefined = undefined;
  try {
    const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const pdfFilename = `special_order_slip_${order.id}_${Date.now()}.pdf`;
    const fullPdfPath = path.join(uploadsDir, pdfFilename);
    await pdfInvoiceService.generateSpecialOrderSlipPdf(Number(order.id), fullPdfPath);
    pdfPath = fullPdfPath;
  } catch (pdfErr) {
    console.warn(`[Orders] Special order PDF slip generation note for #${order.id}:`, pdfErr);
  }

  await whatsappQueueWorker.enqueue(
    formattedPhone,
    msg,
    'special_order',
    order.requester || 'Customer',
    undefined,
    pdfPath,
    undefined,
    { skipDedupe: options?.skipDedupe }
  );

  // Pre-warm / wake WhatsApp if sleeping so it is ready immediately
  void ensureWhatsAppReady(30_000).catch(() => {});

  await db.run(
    `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['special_order_arrived', order.requester || 'Customer', formattedPhone, msg, 'queued', String(order.id)]
  ).catch(() => {});

  return true;
}

// Check if an arrival message was queued for this customer in the last 60 minutes
router.get('/check-arrival-notified', async (req, res) => {
  try {
    const rawPhone = String(req.query.phone || '').replace(/\D/g, '');
    if (!rawPhone || rawPhone.length < 7) {
      return res.json({ recentlyNotified: false });
    }

    const last10 = rawPhone.slice(-10);
    const formattedPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
    const sixtyMinutesAgoMs = Date.now() - 60 * 60 * 1000;

    const db = await dbManager.getConnection();
    const recent = await db.get(
      `SELECT id, created_at, status FROM whatsapp_send_queue
       WHERE (number LIKE ? OR number LIKE ?)
         AND type = 'special_order'
         AND status NOT IN ('cancelled', 'failed_perm')
         AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
      [`%${last10}%`, `%${formattedPhone}%`, sixtyMinutesAgoMs]
    );

    if (recent) {
      const minutesAgo = Math.max(1, Math.round((Date.now() - Number(recent.created_at)) / 60000));
      return res.json({
        recentlyNotified: true,
        minutesAgo,
        queueId: recent.id,
        status: recent.status
      });
    }

    return res.json({ recentlyNotified: false });
  } catch (err: any) {
    console.error('Check arrival notified error:', err);
    res.json({ recentlyNotified: false });
  }
});

// Trigger WhatsApp Arrival / Status Notification for a special order
router.post('/:id/notify-arrival', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (!order.phone) {
      return res.status(400).json({ error: 'Order has no associated phone number' });
    }

    const isForce = req.body?.force_resend === true;
    const isResend = Number(order.notified) === 1 || Number(order.notification_count) > 0;
    const queued = await enqueueArrivalWhatsApp(db, order, { skipDedupe: isResend, forceResend: isForce });
    
    // Update order status to 'Ready', mark notified, increment notification_count, and arm auto_remind
    let newCount = Number(order.notification_count || 0);
    if (queued) {
      newCount += 1;
      await db.run('UPDATE special_orders SET status = ?, notified = 1, notification_count = ?, auto_remind = 1, last_collection_reminder_at = datetime(\'now\') WHERE id = ?', ['Ready', newCount, id]);
    }

    broadcastOrdersChanged();
    res.json({
      success: true,
      whatsapp_queued: queued,
      notification_count: newCount,
      message: queued ? 'Arrival notification queued successfully via WhatsApp' : 'Arrival message was already queued in the last 60 minutes (or no phone stored)'
    });
  } catch (err: any) {
    console.error('Notify arrival error:', err);
    res.status(500).json({ error: 'Failed to queue WhatsApp message: ' + (err.message || 'Unknown error') });
  }
});

// Trigger consolidated WhatsApp Arrival / Status Notification for multiple special orders of the same customer
router.post('/batch-notify-arrival', async (req, res) => {
  const { order_ids, items, custom_message, lang: reqLang, force_resend } = req.body;
  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ error: 'order_ids array is required' });
  }

  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const placeholders = order_ids.map(() => '?').join(',');
    const orders = await db.all(`SELECT * FROM special_orders WHERE id IN (${placeholders})`, order_ids);
    if (orders.length === 0) {
      return res.status(404).json({ error: 'No matching orders found' });
    }

    const firstPhone = String(orders[0].phone || '').replace(/\D/g, '');
    if (!firstPhone) {
      return res.status(400).json({ error: 'Customer phone number is missing' });
    }

    const formattedPhone = firstPhone.length === 10 ? `91${firstPhone}` : firstPhone;
    const last10 = firstPhone.slice(-10);
    const sixtyMinutesAgoMs = Date.now() - 60 * 60 * 1000;

    // 60-minute anti-spam duplicate guard: check if arrival message was already queued to this customer in the last 60 minutes
    if (!force_resend) {
      const recentQueue = await db.get(
        `SELECT id, created_at, status FROM whatsapp_send_queue
         WHERE (number LIKE ? OR number LIKE ?)
           AND type = 'special_order'
           AND status NOT IN ('cancelled', 'failed_perm')
           AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
        [`%${last10}%`, `%${formattedPhone}%`, sixtyMinutesAgoMs]
      );

      if (recentQueue) {
        const minutesAgo = Math.max(1, Math.round((Date.now() - Number(recentQueue.created_at)) / 60000));
        return res.status(409).json({
          error: `An arrival notification was already queued for this customer ${minutesAgo} minute(s) ago.`,
          code: 'RECENTLY_NOTIFIED',
          already_queued: true,
          minutes_ago: minutesAgo,
          recent_queue_id: recentQueue.id
        });
      }
    }

    const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [firstPhone]);
    const lang = reqLang || orders[0].language || custRow?.language || 'en';
    const requesterName = orders[0].requester || 'Customer';

    // Map item statuses from req.body.items or default to 'arrived'
    const itemMap = new Map<number, { status: 'arrived' | 'delayed'; delayReason?: string; expectedDate?: string }>();
    if (Array.isArray(items)) {
      for (const it of items) {
        if (it && it.order_id) {
          itemMap.set(Number(it.order_id), {
            status: it.status === 'delayed' ? 'delayed' : 'arrived',
            delayReason: it.delay_reason,
            expectedDate: it.expected_date
          });
        }
      }
    }

    const multiOrderItems: MultiOrderItemArrival[] = [];
    const arrivedOrderIds: number[] = [];

    for (const ord of orders) {
      const itInfo = itemMap.get(Number(ord.id)) || { status: 'arrived' };
      multiOrderItems.push({
        productName: ord.product,
        qty: ord.qty || 1,
        status: itInfo.status,
        delayReason: itInfo.delayReason,
        expectedDate: itInfo.expectedDate
      });

      if (itInfo.status === 'arrived') {
        arrivedOrderIds.push(Number(ord.id));
      }
    }

    // Compose message or use custom preview
    const msg = custom_message && String(custom_message).trim().length > 0
      ? String(custom_message).trim()
      : await buildMultiOrderNotificationMessage(requesterName, multiOrderItems, db, lang);

    // Queue exactly ONE WhatsApp message
    await whatsappQueueWorker.enqueue(
      formattedPhone,
      msg,
      'special_order',
      requesterName,
      undefined,
      undefined,
      undefined,
      { skipDedupe: true }
    );

    // Pre-warm / wake WhatsApp if sleeping so it is ready immediately
    void ensureWhatsAppReady(30_000).catch(() => {});

    // Update orders in SQLite
    for (const ord of orders) {
      const itInfo = itemMap.get(Number(ord.id)) || { status: 'arrived' };
      const newCount = Number(ord.notification_count || 0) + 1;
      if (itInfo.status === 'arrived') {
        await db.run(
          `UPDATE special_orders SET status = 'Ready', notified = 1, notification_count = ?, auto_remind = 1, last_collection_reminder_at = datetime('now') WHERE id = ?`,
          [newCount, ord.id]
        );
      } else {
        const delayNote = itInfo.delayReason ? `Delayed: ${itInfo.delayReason}` : (ord.notes || '');
        await db.run(
          `UPDATE special_orders SET notes = ?, notification_count = ? WHERE id = ?`,
          [delayNote, newCount, ord.id]
        );
      }
    }

    await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['special_order_multi_arrived', requesterName, formattedPhone, msg, 'queued', order_ids.join(',')]
    ).catch(() => {});

    broadcastOrdersChanged();
    res.json({
      success: true,
      whatsapp_queued: true,
      arrived_count: arrivedOrderIds.length,
      total_count: orders.length,
      message: `Consolidated notification queued for ${requesterName} (${arrivedOrderIds.length} arrived, ${orders.length - arrivedOrderIds.length} delayed)`
    });
  } catch (err: any) {
    console.error('Batch notify arrival error:', err);
    res.status(500).json({ error: 'Failed to queue consolidated notification: ' + (err.message || 'Unknown error') });
  }
});

// Resend booking WhatsApp notification
router.post('/:id/resend-booking', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (!order.phone) {
      return res.status(400).json({ error: 'Order has no associated phone number' });
    }

    const cleanPhone = order.phone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    
    const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
    const lang = order.language || custRow?.language || 'en';
    const medicalName = await getStoreMedicalNameAndPhone(db);
    const cleanReqName = formatCustomerName(order.requester);
    const advMsg = order.advance_payment && Number(order.advance_payment) > 0 ? ` (Advance Paid: ₹${Number(order.advance_payment).toFixed(2)})` : '';
    
    let msg = '';
    if (lang === 'hi') {
      msg = `नमस्ते ${cleanReqName}, ${medicalName} पर आपकी ${order.product}${order.advance_payment && Number(order.advance_payment) > 0 ? ` (अग्रिम राशि: ₹${Number(order.advance_payment).toFixed(2)})` : ''} का ऑर्डर बुक कर लिया गया है। दवाई आने पर हम आपको सूचित करेंगे।`;
    } else if (lang === 'mr') {
      msg = `नमस्कार ${cleanReqName}, ${medicalName} येथे आपली ${order.product}${order.advance_payment && Number(order.advance_payment) > 0 ? ` (अगाऊ रक्कम: ₹${Number(order.advance_payment).toFixed(2)})` : ''} ची ऑर्डर बुक करण्यात आली आहे. औषध आल्यावर आम्ही आपल्याला कळवू.`;
    } else {
      msg = `Hi ${cleanReqName}, your order for ${order.product}${advMsg} has been booked at ${medicalName}. We will notify you when it arrives.`;
    }

    await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order', order.requester || 'Customer', undefined, undefined, undefined, { skipDedupe: true });

    await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['quick_order_resend', order.requester || 'Customer', formattedPhone, msg, 'queued', String(id)]
    );

    res.json({ success: true, message: 'Booking confirmation WhatsApp queued successfully' });
  } catch (err: any) {
    console.error('Resend booking notification error:', err);
    res.status(500).json({ error: 'Failed to queue WhatsApp message: ' + (err.message || 'Unknown error') });
  }
});

// Fetch ₹50 Payment QR details for Special Order
router.get('/:id/payment-qr', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid order ID' });

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const configs = await paymentQrService.getQrConfigs();
    const assignedId = order.payment_qr_id || 'QR_1';
    const config = configs.find(c => c.id === assignedId && c.is_active) || configs.find(c => c.is_active) || configs[0];
    const amount = Number(order.advance_payment || order.total_amount || 50);
    const soCode = `SO-${order.id}`;
    const upiUri = paymentQrService.buildUpiUri(config.upi_id, config.payee_name, amount, soCode);

    return res.json({
      success: true,
      order_id: order.id,
      so_code: soCode,
      customer_name: order.requester || 'Customer',
      customer_phone: order.phone || '',
      medicine_name: order.product || order.medicine_name || 'Medicine',
      amount,
      upi_id: config.upi_id,
      payee_name: config.payee_name,
      upi_uri: upiUri,
      payment_status: order.payment_status || 'UNPAID'
    });
  } catch (err: any) {
    console.error('[Orders] Get payment QR error:', err);
    res.status(500).json({ error: 'Failed to generate payment QR: ' + err.message });
  }
});

// Send ₹50 Payment QR directly to customer WhatsApp
router.post('/:id/send-payment-qr', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid order ID' });

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const cleanPhone = String(order.phone || '').replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Order has no valid customer phone number' });
    }

    const activeQr = await paymentQrService.allocateNextQr();
    const amount = Number(order.advance_payment || order.total_amount || 50);
    const soCode = `SO-${order.id}`;
    const medicineName = order.product || order.medicine_name || 'Medicine';
    const upiUri = paymentQrService.buildUpiUri(activeQr.upi_id, activeQr.payee_name, amount, soCode);
    const fullQrPath = await paymentQrService.generatePaymentCard({
      upiUri,
      orderNumber: soCode,
      medicineName,
      amount,
      payeeName: activeQr.payee_name,
      upiId: activeQr.upi_id,
      filename: `payment_card_${soCode}.png`
    });

    await db.run(
      `UPDATE special_orders SET payment_qr_id = ?, payment_status = 'AWAITING_PAYMENT', advance_payment = ? WHERE id = ?`,
      [activeQr.id, amount, id]
    );

    const custQrMsg =
      `✅ *Medicine Request Confirmed*\n\n` +
      `🆔 *Special Order*: ${soCode}\n` +
      `💊 *Medicine*: ${medicineName}\n` +
      `📦 *Quantity*: ${order.qty || 1}\n\n` +
      `🔐 *Booking Advance Amount*: ₹${amount.toFixed(2)}\n\n` +
      `Please pay the ₹${amount.toFixed(2)} booking amount using the QR card attached above.\n\n` +
      `🏦 *UPI ID*: ${activeQr.upi_id.trim()}\n` +
      `👤 *Payee*: ${activeQr.payee_name}\n\n` +
      `👉 *Or tap to pay directly on this phone*:\n${upiUri}\n\n` +
      `📸 After payment, please send the payment screenshot in this chat.`;

    const queueId = await whatsappQueueWorker.enqueue(
      cleanPhone,
      custQrMsg,
      'customer_payment_qr',
      order.requester || 'Customer',
      undefined,
      fullQrPath
    );

    broadcastOrdersChanged();

    return res.json({
      success: true,
      queue_id: queueId,
      message: `₹${amount.toFixed(2)} payment QR code dispatched to customer on WhatsApp!`
    });
  } catch (err: any) {
    console.error('[Orders] Send payment QR error:', err);
    res.status(500).json({ error: 'Failed to send payment QR: ' + err.message });
  }
});

// Fetch evaluated distributor options and current sourcing status for a special order
router.get('/:id/distributor-options', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid order ID' });

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { generateStoreSpecialOrderCode } = await import('../services/whatsappIntentService.js');
    const soCode = await generateStoreSpecialOrderCode(db, order.store_id || 1, id).catch(() => `SO-TMSA-${id}`);

    // Check wa_owner_pending_requests
    const { waAdminEscalationService } = await import('../services/waAdminEscalationService.js');
    await waAdminEscalationService.ensureOwnerPendingRequestsTable?.(db);
    const reqRow = await db.get(
      `SELECT * FROM wa_owner_pending_requests WHERE req_code = ? OR req_code LIKE ? ORDER BY id DESC LIMIT 1`,
      [soCode, `%${id}`]
    );

    let options: any[] = [];
    if (reqRow && reqRow.options_json) {
      try {
        const parsed = JSON.parse(reqRow.options_json);
        options = Array.isArray(parsed) ? parsed : (parsed.options || parsed.allOptions || []);
      } catch (_) {}
    }

    return res.json({
      orderId: id,
      soCode,
      medicineName: order.medicine_name || order.product,
      quantity: order.qty || 1,
      currentDistributor: order.distributor_name || order.pharmarack_distributor || null,
      currentRate: order.pharmarack_rate || null,
      currentMrp: order.pharmarack_mrp || null,
      paymentStatus: order.payment_status || 'UNPAID',
      status: order.status || 'Pending',
      ownerRequestStatus: reqRow?.status || null,
      options
    });
  } catch (err: any) {
    console.error('[Orders] Get distributor options error:', err);
    res.status(500).json({ error: 'Failed to fetch distributor options: ' + err.message });
  }
});

// Confirm or update distributor from web app, optionally dispatching customer payment QR
router.post('/:id/confirm-distributor', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid order ID' });

    const {
      distributor,
      rate,
      mrp,
      productId,
      productCode,
      storeId,
      productName,
      sendPaymentQr = true
    } = req.body;

    if (!distributor) {
      return res.status(400).json({ error: 'Distributor name is required' });
    }

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const distName = String(distributor).trim();
    const distRate = Number(rate || 0);
    const distMrp = Number(mrp || order.pharmarack_mrp || 0);
    const prodId = productId ? Number(productId) : (order.pharmarack_product_id || null);
    const prodCode = productCode ? String(productCode) : (order.pharmarack_product_code || null);
    const stId = storeId ? Number(storeId) : (order.pharmarack_store_id || null);
    const prodName = productName || order.pharmarack_product_name || order.medicine_name || order.product;

    const { generateStoreSpecialOrderCode } = await import('../services/whatsappIntentService.js');
    const soCode = await generateStoreSpecialOrderCode(db, order.store_id || 1, id).catch(() => `SO-TMSA-${id}`);

    // Update special_orders record
    await db.run(
      `UPDATE special_orders SET
         distributor_name = ?,
         pharmarack_distributor = ?,
         pharmarack_rate = ?,
         pharmarack_mrp = ?,
         pharmarack_product_id = ?,
         pharmarack_product_code = ?,
         pharmarack_store_id = ?,
         pharmarack_product_name = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [distName, distName, distRate, distMrp, prodId, prodCode, stId, prodName, id]
    );

    // Mark owner pending request as fulfilled
    await db.run(
      `UPDATE wa_owner_pending_requests SET status = 'fulfilled' WHERE req_code = ? OR req_code LIKE ?`,
      [soCode, `%${id}`]
    ).catch(() => {});

    const isPaymentConfirmed = ['PAYMENT_CONFIRMED', 'VERIFIED', 'CONFIRMED'].includes(String(order.payment_status || '').toUpperCase());
    const oldDistName = String(order.pharmarack_distributor || order.distributor_name || '').trim();
    const oldStoreId = order.pharmarack_store_id ? Number(order.pharmarack_store_id) : null;
    const oldProdCode = order.pharmarack_product_code ? String(order.pharmarack_product_code) : null;
    const oldProdName = order.pharmarack_product_name || order.medicine_name || order.product;
    const distChanged = (oldDistName && oldDistName.toLowerCase() !== distName.toLowerCase()) ||
                        (oldStoreId && stId && oldStoreId !== stId);

    // If distributor changed, automatically evict item from old distributor's cart and add to new distributor's cart
    if (distChanged || isPaymentConfirmed) {
      try {
        const { adjustSpecialOrderInLiveCart, addItemsToPharmarackCart } = await import('./pharmarack.js');
        if (oldDistName && distChanged) {
          await Promise.race([
            adjustSpecialOrderInLiveCart({
              product: oldProdName,
              qty: order.qty || 1,
              distributor: oldDistName,
              productCode: oldProdCode,
              storeId: oldStoreId,
              exactOnly: true
            }),
            new Promise(r => setTimeout(r, 1500))
          ]);
        }
        if (stId && distName) {
          await addItemsToPharmarackCart([{
            productName: prodName,
            product: prodName,
            productId: prodId,
            productCode: prodCode || '',
            storeId: stId,
            storeName: distName,
            qty: order.qty || 1,
            rate: distRate,
            mrp: distMrp,
            packaging: '1 strip',
            mapped: true
          }]).catch(err => console.warn('[Orders] Error migrating item to new distributor cart:', err));
        }
      } catch (cartMigrateErr) {
        console.warn('[Orders] Could not auto-migrate cart on distributor change:', cartMigrateErr);
      }

      await db.run(
        `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
         VALUES (?, 'distributor_switched', ?, 'Staff Pharmacist', CURRENT_TIMESTAMP)`,
        [id, `Distributor updated from "${oldDistName || 'None'}" to "${distName}". Live cart synced.`]
      ).catch(() => {});
    }

    let qrSent = false;
    let queueId: number | string | null = null;

    // Only dispatch QR and set AWAITING_PAYMENT if payment is NOT already confirmed
    if (sendPaymentQr && !isPaymentConfirmed) {
      const cleanPhone = String(order.phone || '').replace(/\D/g, '');
      const custPhoneLast10 = cleanPhone.slice(-10);

      // Allocate rotating UPI QR config
      const activeQr = await paymentQrService.allocateNextQr();
      const amount = 50;
      const medicineTitle = prodName || order.medicine_name || order.product || 'Medicine';
      const upiUri = paymentQrService.buildUpiUri(activeQr.upi_id, activeQr.payee_name, amount, soCode);
      const fullQrPath = await paymentQrService.generatePaymentCard({
        upiUri,
        orderNumber: soCode,
        medicineName: medicineTitle,
        amount,
        payeeName: activeQr.payee_name,
        upiId: activeQr.upi_id,
        filename: `payment_card_${soCode}.png`
      });

      await db.run(
        `UPDATE special_orders SET
           payment_qr_id = ?,
           payment_status = 'AWAITING_PAYMENT',
           advance_payment = ?,
           total_amount = ?
         WHERE id = ?`,
        [activeQr.id, amount, amount, id]
      );

      // Update customer conversation state
      if (custPhoneLast10) {
        await db.run(
          `UPDATE wa_pending_clarifications
           SET step = 'awaiting_payment', special_order_id = ?, so_code = ?, created_at = CURRENT_TIMESTAMP
           WHERE phone LIKE ? OR phone LIKE ?`,
          [id, soCode, `%${custPhoneLast10}`, `%${custPhoneLast10}%`]
        ).catch(() => {});
      }

      // Enqueue message to customer with QR card and UPI pay link
      const mrpLine = distMrp > 0 ? `\n🏷️ *MRP*: ₹${distMrp.toFixed(2)}` : '';
      const custQrMsg =
        `✅ *Medicine Request Confirmed*\n\n` +
        `🆔 *Special Order*: ${soCode}\n` +
        `💊 *Medicine*: ${medicineTitle}\n` +
        `📦 *Quantity*: ${order.qty || 1}${mrpLine}\n\n` +
        `🔐 *Booking Advance Amount*: ₹${amount.toFixed(2)}\n\n` +
        `Please pay the ₹${amount.toFixed(2)} booking amount using the QR card attached above.\n\n` +
        `🏦 *UPI ID*: ${activeQr.upi_id.trim()}\n` +
        `👤 *Payee*: ${activeQr.payee_name}\n\n` +
        `👉 *Or tap to pay directly on this phone*:\n${upiUri}\n\n` +
        `📸 After payment, please send the payment screenshot in this chat.`;

      let custTarget = cleanPhone;
      if (custPhoneLast10) {
        const activeChat = await db.get(
          `SELECT id FROM whatsapp_chats 
           WHERE (resolved_number LIKE ? OR id LIKE ?) 
           ORDER BY timestamp DESC, (CASE WHEN id LIKE '%@lid' THEN 1 ELSE 2 END) ASC LIMIT 1`,
          [`%${custPhoneLast10}%`, `%${custPhoneLast10}%`]
        ).catch(() => null);
        if (activeChat?.id) {
          custTarget = activeChat.id;
        }
      }

      if (custTarget) {
        queueId = await whatsappQueueWorker.enqueue(
          custTarget,
          custQrMsg,
          'customer_payment_qr',
          order.requester || 'Customer',
          undefined,
          fullQrPath
        ).catch((err: any) => {
          console.warn('[Orders] QR image enqueue failed, falling back to text:', err?.message || err);
          return whatsappQueueWorker.enqueue(
            custTarget,
            custQrMsg + `\n\n🔗 *Pay via UPI link*:\n${upiUri}`,
            'customer_payment_qr',
            order.requester || 'Customer'
          ).catch(() => null);
        });
        qrSent = true;
      }
    }

    broadcastOrdersChanged();

    return res.json({
      success: true,
      orderId: id,
      distributor: distName,
      rate: distRate,
      mrp: distMrp,
      qrSent,
      queueId,
      message: qrSent
        ? `Distributor ${distName} confirmed and ₹50 payment QR dispatched to customer on WhatsApp!`
        : (isPaymentConfirmed
            ? `Distributor ${distName} updated for paid order #${id} (Cart migrated to ${distName}).`
            : `Distributor ${distName} assigned to order #${id}.`)
    });
  } catch (err: any) {
    console.error('[Orders] Confirm distributor error:', err);
    res.status(500).json({ error: 'Failed to confirm distributor: ' + err.message });
  }
});

// Mark special order advance payment as paid
router.post('/:id/mark-advance-paid', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid order ID' });

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await db.run(
      `UPDATE special_orders SET payment_status = 'PAYMENT_CONFIRMED', advance_payment = CASE WHEN advance_payment > 0 THEN advance_payment ELSE 50 END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    // Auto-add item to Pharmarack Live Cart
    try {
      const { addItemsToPharmarackCart } = await import('./pharmarack.js');
      void addItemsToPharmarackCart([{
        productName: order.pharmarack_product_name || order.medicine_name || order.product,
        product: order.pharmarack_product_name || order.medicine_name || order.product,
        productId: order.pharmarack_product_id || order.medicine_id || 0,
        productCode: order.pharmarack_product_code || '',
        storeId: order.pharmarack_store_id || 0,
        storeName: order.pharmarack_distributor || 'Standard Distributor',
        qty: order.qty > 0 ? order.qty : 1,
        rate: order.pharmarack_rate || 0,
        mrp: order.pharmarack_mrp || 0,
        packaging: '1 strip',
        mapped: order.pharmarack_mapped === 1
      }]).catch((err: any) => console.warn('[Orders] Live cart add error on mark-advance-paid:', err?.message || err));
    } catch (_) {}

    // Resolve store order code and send customer WhatsApp receipt
    const { generateStoreSpecialOrderCode } = await import('../services/whatsappIntentService.js');
    const soCode = await generateStoreSpecialOrderCode(db, order.store_id || 1, id).catch(() => `SO-TMSA-${id}`);
    const storeName = (await getStoreMedicalName(db, order.store_id || 1)) || 'AI Pharmacy';
    const customerName = formatCustomerName(order.customer_name || order.requester || 'Customer');
    const medicineName = order.medicine_name || order.product || 'Medicine';
    const amountPaid = Number(order.advance_payment || order.screenshot_amount || order.total_amount || 50).toFixed(2);
    const cleanCustPhone = String(order.phone || '').replace(/\D/g, '').slice(-10);

    // Mark owner pending request fulfilled & customer clarification completed
    await db.run(
      `UPDATE wa_owner_pending_requests SET status = 'fulfilled' WHERE req_code = ? OR req_code LIKE ?`,
      [soCode, `%${id}`]
    ).catch(() => {});
    await db.run(
      `UPDATE wa_pending_clarifications SET step = 'completed' WHERE special_order_id = ? OR so_code = ?`,
      [id, soCode]
    ).catch(() => {});

    const custFinalMsg =
      `🎉 Hello *${customerName}*, your medicine request is confirmed!\n\n` +
      `🆔 Special Order ID: ${soCode}\n\n` +
      `💊 ${medicineName}\n` +
      `📦 Quantity: ${order.qty || 1}\n\n` +
      `💰 Booking Amount Paid: ₹${amountPaid}\n\n` +
      `🛒 Your medicine has been added to our Live Cart for procurement. We will notify you as soon as it arrives!\n\n` +
      `Thank you!\n— ${storeName}`;

    if (cleanCustPhone) {
      try {
        await whatsappQueueWorker.enqueue(
          cleanCustPhone,
          custFinalMsg,
          'customer_order_confirmed',
          customerName
        );
        console.log(`[Orders] Payment confirmation WhatsApp enqueued for ${customerName} (${cleanCustPhone}) [${soCode}]`);
      } catch (waErr) {
        console.warn('[Orders] Failed to enqueue customer payment confirmation WhatsApp:', waErr);
      }

      try {
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, needs_confirmation, reference_id)
           VALUES (?, ?, ?, ?, 'sent', 0, ?)`,
          ['whatsapp_order', customerName, cleanCustPhone, custFinalMsg, String(id)]
        );
      } catch (notifErr) {
        console.warn('[Orders] Failed to log automation_notification:', notifErr);
      }
    }

    broadcastOrdersChanged();

    return res.json({
      success: true,
      message: 'Advance payment marked as CONFIRMED'
    });
  } catch (err: any) {
    console.error('[Orders] Mark advance paid error:', err);
    res.status(500).json({ error: 'Failed to mark advance paid: ' + err.message });
  }
});

// Route to fetch uncollected orders (not collected for 2-3 days) - Read-only query for UI review
router.get('/uncollected-alerts', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    // Fetch orders ready or pending collection that are 2 days or older (2-3 days ago) and not collected
    const uncollected = await db.all(
      `SELECT * FROM special_orders 
       WHERE status IN ('Pending', 'Ready', 'Ordered', 'Pending Collection') 
       AND datetime(date) <= datetime('now', '-2 days')`
    );

    res.json(uncollected || []);
  } catch (err) {
    console.error('Fetch uncollected alerts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper to cancel and remove any pending unsent WhatsApp queue items and notifications for an order
async function cancelPendingWhatsAppForOrder(
  db: any,
  order: { phone?: string; requester?: string; product?: string; id: number | string }
): Promise<void> {
  const cleanPhone = order.phone ? order.phone.replace(/\D/g, '') : '';
  const last10 = cleanPhone.slice(-10);
  const reqName = (order.requester || '').trim();
  const prodName = (order.product || '').trim();

  try {
    const matchConditions: string[] = [];
    const matchArgs: any[] = [];

    if (last10 && last10.length >= 7) {
      matchConditions.push('number LIKE ?');
      matchArgs.push(`%${last10}%`);
    }
    if (reqName) {
      matchConditions.push('target_name = ?');
      matchArgs.push(reqName);
    }
    if (prodName) {
      matchConditions.push('message LIKE ?');
      matchArgs.push(`%${prodName}%`);
    }

    if (matchConditions.length > 0) {
      await db.run(
        `DELETE FROM whatsapp_send_queue 
         WHERE status IN ('pending', 'failed_offline') 
           AND type IN ('special_order', 'special_order_batch', 'special_order_arrived', 'special_order_fulfilled', 'admin_shortage_reminder', 'whatsapp_notification')
           AND (${matchConditions.join(' OR ')})`,
        matchArgs
      );
    }
  } catch (cancelErr) {
    console.warn('[Orders] Could not delete pending WhatsApp queue items for order:', cancelErr);
  }

  try {
    await db.run(
      `DELETE FROM automation_notifications 
       WHERE reference_id IN (?, ?)
          OR (type = 'admin_shortage_reminder' AND message LIKE ?)
          OR (type IN ('special_order_arrived', 'quick_order', 'special_order', 'quick_order_resend', 'quick_order_batch') AND reference_id = ?)`,
      [String(order.id), `shortage_${order.id}`, prodName ? `%${prodName}%` : '', String(order.id)]
    );
  } catch (_) {}
}

// Update order status/details
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    status, priority, qty, product, requester, phone,
    pharmarack_distributor, pharmarack_rate, pharmarack_mrp, pharmarack_mapped,
    advance_payment, cart_add_error, resend, sendPaymentQr, skipWhatsApp, sendWhatsApp,
    pharmarack_product_id, pharmarack_product_code, pharmarack_store_id, pharmarack_product_name
  } = req.body;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const existing = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!existing) {
      return res.status(404).json({ error: 'Order not found' });
    }

    let newStatus = status !== undefined ? status : existing.status;
    if (newStatus === 'Completed' || newStatus === 'completed') {
      newStatus = 'Fulfilled';
    }

    const newPriority = priority !== undefined ? priority : existing.priority;
    const newQty = qty !== undefined ? qty : existing.qty;
    const newProduct = product !== undefined ? product : existing.product;
    const newRequester = requester !== undefined ? requester : existing.requester;
    // Same digit-clean rule as the POST routes: chat-id suffixes / formatting must never
    // reach special_orders.phone. Missing key keeps the stored value; empty stays empty.
    const newPhone = phone !== undefined ? String(phone).replace(/\D/g, '') : existing.phone;
    const newDistributor = pharmarack_distributor !== undefined ? pharmarack_distributor : existing.pharmarack_distributor;
    const newRate = pharmarack_rate !== undefined ? pharmarack_rate : existing.pharmarack_rate;
    const newMrp = pharmarack_mrp !== undefined ? pharmarack_mrp : existing.pharmarack_mrp;
    const newMapped = pharmarack_mapped !== undefined ? (pharmarack_mapped ? 1 : 0) : existing.pharmarack_mapped;
    const newAdvancePayment = advance_payment !== undefined ? advance_payment : existing.advance_payment;
    const newCartAddError = cart_add_error !== undefined ? cart_add_error : existing.cart_add_error;
    const newProductId = pharmarack_product_id !== undefined ? (pharmarack_product_id ? Number(pharmarack_product_id) : null) : existing.pharmarack_product_id;
    const newProductCode = pharmarack_product_code !== undefined ? (pharmarack_product_code || null) : existing.pharmarack_product_code;
    const newStoreId = pharmarack_store_id !== undefined ? (pharmarack_store_id ? Number(pharmarack_store_id) : null) : existing.pharmarack_store_id;
    const newProductName = pharmarack_product_name !== undefined ? (pharmarack_product_name || null) : existing.pharmarack_product_name;

    // Manual-only messaging contract: a status transition to 'Ready' (or manual resend with resend===true)
    // dispatches the arrival WhatsApp and increments notification_count unless skipWhatsApp is explicitly requested.
    let whatsappQueued = false;
    const isResend = Boolean(resend);
    const shouldSkipWa = skipWhatsApp === true || sendWhatsApp === false;
    if (newStatus === 'Ready' && !shouldSkipWa && (Number(existing.notified) !== 1 || isResend)) {
      try {
        whatsappQueued = await enqueueArrivalWhatsApp(
          db,
          { ...existing, phone: newPhone, requester: newRequester, product: newProduct, qty: newQty },
          { skipDedupe: isResend || Number(existing.notified) === 1, skipWhatsApp: shouldSkipWa }
        );
      } catch (waErr: any) {
        console.error('Failed to queue arrival WhatsApp on order update:', waErr?.message || waErr);
      }
    }

    let newNotified = existing.notified;
    if (newStatus === 'Fulfilled' || whatsappQueued) {
      newNotified = 1;
    }
    const newCount = whatsappQueued ? (Number(existing.notification_count || 0) + 1) : Number(existing.notification_count || 0);
    const newAutoRemind = (newStatus === 'Fulfilled' || newStatus === 'Cancelled') ? 0 : (newStatus === 'Ready' ? 1 : (existing.auto_remind ?? 0));
    const lastRemindAt = (newStatus === 'Ready' || whatsappQueued) ? new Date().toISOString() : existing.last_collection_reminder_at;

    await db.run(
      `UPDATE special_orders
       SET status = ?, priority = ?, qty = ?, product = ?, requester = ?, phone = ?,
           pharmarack_distributor = ?, pharmarack_rate = ?, pharmarack_mrp = ?, pharmarack_mapped = ?,
           advance_payment = ?, cart_add_error = ?, notified = ?, notification_count = ?,
           pharmarack_product_id = ?, pharmarack_product_code = ?, pharmarack_store_id = ?, pharmarack_product_name = ?,
           auto_remind = ?, last_collection_reminder_at = ?
       WHERE id = ?`,
      [newStatus, newPriority, newQty, newProduct, newRequester, newPhone, newDistributor, newRate, newMrp, newMapped, newAdvancePayment, newCartAddError, newNotified, newCount, newProductId, newProductCode, newStoreId, newProductName, newAutoRemind, lastRemindAt, id]
    );

    // Auto-send payment QR when distributor is newly assigned via the CRM UI
    // Condition: distributor was not set before AND is now set (first-time assignment)
    // OR caller explicitly requests it via sendPaymentQr=true
    let paymentQrSent = false;
    const distributorNewlyAssigned = !existing.pharmarack_distributor && newDistributor;
    const shouldSendQr = Boolean(distributorNewlyAssigned || sendPaymentQr);
    const cleanPhoneForQr = String(newPhone || existing.phone || '').replace(/\D/g, '');
    if (shouldSendQr && cleanPhoneForQr.length >= 10) {
      try {
        const advanceAmount = Number(newAdvancePayment || existing.advance_payment || 50);
        const qrAmount = advanceAmount > 0 ? advanceAmount : 50;
        const soCode = `SO-${id}`;
        const medicineName = newProduct || existing.product || 'Medicine';
        const activeQr = await paymentQrService.allocateNextQr();
        const upiUri = paymentQrService.buildUpiUri(activeQr.upi_id, activeQr.payee_name, qrAmount, soCode);
        const fullQrPath = await paymentQrService.generatePaymentCard({
          upiUri,
          orderNumber: soCode,
          medicineName,
          amount: qrAmount,
          payeeName: activeQr.payee_name,
          upiId: activeQr.upi_id,
          filename: `payment_card_${soCode}.png`
        });

        await db.run(
          `UPDATE special_orders SET payment_qr_id = ?, payment_status = 'AWAITING_PAYMENT', advance_payment = ? WHERE id = ?`,
          [activeQr.id, qrAmount, id]
        );

        const formattedQrPhone = cleanPhoneForQr.length === 10 ? `91${cleanPhoneForQr}` : cleanPhoneForQr;
        const custQrMsg =
          `✅ *Medicine & Supplier Confirmed*\n\n` +
          `🆔 *Special Order*: ${soCode}\n` +
          `💊 *Medicine*: ${medicineName}\n` +
          `📦 *Quantity*: ${newQty || existing.qty || 1}\n` +
          `🏢 *Supplier*: ${newDistributor}\n\n` +
          `🔐 *Booking Advance Amount*: ₹${qrAmount.toFixed(2)}\n\n` +
          `Please pay the ₹${qrAmount.toFixed(2)} booking amount using the QR card attached above.\n\n` +
          `🏦 *UPI ID*: ${activeQr.upi_id.trim()}\n` +
          `👤 *Payee*: ${activeQr.payee_name}\n\n` +
          `👉 *Or tap to pay directly on this phone*:\n${upiUri}\n\n` +
          `📸 After payment, please send the payment screenshot in this chat.`;

        await whatsappQueueWorker.enqueue(
          formattedQrPhone,
          custQrMsg,
          'customer_payment_qr',
          newRequester || existing.requester || 'Customer',
          undefined,
          fullQrPath
        );

        paymentQrSent = true;
        console.log(`[Orders] Auto-sent payment QR to ${formattedQrPhone} for ${soCode} after distributor assigned: ${newDistributor}`);
      } catch (qrErr: any) {
        console.error('[Orders] Failed to auto-send payment QR on distributor assignment:', qrErr?.message || qrErr);
      }
    }

    if (newStatus === 'Cancelled') {
      await cancelPendingWhatsAppForOrder(db, {
        id,
        phone: newPhone || existing.phone,
        requester: newRequester || existing.requester,
        product: newProduct || existing.product
      });
    } else if (newStatus === 'Fulfilled') {
      await db.run(
        `UPDATE automation_notifications 
         SET lifecycle_status = 'sent', status = 'sent_manually' 
         WHERE (type IN ('special_order_arrived', 'quick_order', 'special_order', 'quick_order_resend', 'quick_order_batch') OR reference_id = ?)
           AND reference_id = ?`,
        [String(id), String(id)]
      ).catch(() => {});
    }

    // 2-Way Sync: If phone or requester updated, cascade changes to pending/failed WhatsApp queue rows & customers table
    if (newPhone && (newPhone !== existing.phone || newRequester !== existing.requester)) {
      const cleanNewPhone = normalizeWhatsAppPhone(newPhone);
      const oldDigits = (existing.phone || '').replace(/\D/g, '');
      const last8Old = oldDigits.length >= 7 ? oldDigits.slice(-8) : oldDigits;

      if (cleanNewPhone) {
        // Update whatsapp_send_queue for this customer/order
        await db.run(
          `UPDATE whatsapp_send_queue
           SET number = ?, target_name = ?, status = 'pending', retry_count = 0, error_message = NULL
           WHERE (
             (target_name IS NOT NULL AND target_name = ?)
             OR (? != '' AND number LIKE ?)
             OR message LIKE ?
           )
           AND status IN ('pending', 'failed_offline', 'failed_perm', 'review_required')`,
          [cleanNewPhone, newRequester, existing.requester, last8Old, `%${last8Old}%`, `%${existing.product}%`]
        ).catch(() => {});

        // Also update automation_notifications
        await db.run(
          `UPDATE automation_notifications
           SET recipient_phone = ?, recipient_name = ?, status = 'queued', error_message = NULL
           WHERE (
             reference_id = ?
             OR (recipient_name IS NOT NULL AND recipient_name = ?)
             OR (? != '' AND recipient_phone LIKE ?)
           )
           AND status IN ('queued', 'failed', 'error')`,
          [cleanNewPhone, newRequester, String(id), existing.requester, last8Old, `%${last8Old}%`]
        ).catch(() => {});

        // Sync to customers table
        await db.run(
          `UPDATE customers 
           SET phone = ?, name = ?
           WHERE phone = ? OR name = ?`,
          [newPhone, newRequester, existing.phone, existing.requester]
        ).catch(() => {});

        try {
          whatsappQueueWorker.triggerProcessing();
          whatsappQueueWorker.broadcastQueueState(true);
          eventService.broadcast('customers_changed', { timestamp: Date.now() });
        } catch (_) {}
      }
    }

    let cartAdjustment: any = null;
    if (newStatus === 'Cancelled') {
      try {
        const { adjustSpecialOrderInLiveCart } = await import('./pharmarack.js');
        cartAdjustment = await Promise.race([
          adjustSpecialOrderInLiveCart({
            product: newProduct || existing.product,
            qty: newQty || existing.qty,
            distributor: newDistributor || existing.pharmarack_distributor,
            productCode: newProductCode || existing.pharmarack_product_code,
            storeId: newStoreId || existing.pharmarack_store_id
          }),
          new Promise(r => setTimeout(() => r(null), 1500))
        ]);
      } catch (cartErr) {
        console.warn('[Orders] Could not auto-adjust live cart on order cancel:', cartErr);
      }
    }

    broadcastOrdersChanged();
    res.json({ success: true, message: 'Order updated successfully', whatsapp_queued: whatsappQueued, notification_count: newCount, cartAdjustment, payment_qr_sent: paymentQrSent });
  } catch (err) {
    console.error('Update order error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update order status specifically (supports POST /:id/status and PUT /:id/status)
const handleStatusUpdate = async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  let { status, resend } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  if (status === 'Completed' || status === 'completed') {
    status = 'Fulfilled';
  }

  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const existing = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!existing) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Manual-only messaging contract: the arrival WhatsApp is dispatched inside this
    // user-clicked request. Idempotent via notified===0 or explicit resend===true unless skipWhatsApp requested.
    let whatsappQueued = false;
    const isResend = Boolean(resend);
    const shouldSkipWa = req.body?.skipWhatsApp === true || req.body?.sendWhatsApp === false;
    if (status === 'Ready' && !shouldSkipWa && (Number(existing.notified) !== 1 || isResend)) {
      try {
        whatsappQueued = await enqueueArrivalWhatsApp(
          db,
          existing,
          { skipDedupe: isResend || Number(existing.notified) === 1, skipWhatsApp: shouldSkipWa }
        );
      } catch (waErr: any) {
        console.error('Failed to queue arrival WhatsApp on status Ready:', waErr?.message || waErr);
      }
    }

    const newNotified = (status === 'Fulfilled' || whatsappQueued) ? 1 : existing.notified;
    const newCount = whatsappQueued ? (Number(existing.notification_count || 0) + 1) : Number(existing.notification_count || 0);
    const newAutoRemind = (status === 'Fulfilled' || status === 'Cancelled') ? 0 : (status === 'Ready' ? 1 : (existing.auto_remind ?? 0));
    const lastRemindAt = (status === 'Ready' || whatsappQueued) ? new Date().toISOString() : existing.last_collection_reminder_at;
    await db.run(
      'UPDATE special_orders SET status = ?, notified = ?, notification_count = ?, auto_remind = ?, last_collection_reminder_at = ? WHERE id = ?',
      [status, newNotified, newCount, newAutoRemind, lastRemindAt, id]
    );

    if (status === 'Cancelled') {
      await cancelPendingWhatsAppForOrder(db, existing);
    } else if (status === 'Fulfilled') {
      await db.run(
        `UPDATE automation_notifications 
         SET lifecycle_status = 'sent', status = 'sent_manually' 
         WHERE (type IN ('special_order_arrived', 'quick_order', 'special_order', 'quick_order_resend', 'quick_order_batch') OR reference_id = ?)
           AND reference_id = ?`,
        [String(id), String(id)]
      ).catch(() => {});
    }

    let cartAdjustment: any = null;
    if (status === 'Cancelled') {
      try {
        const { adjustSpecialOrderInLiveCart } = await import('./pharmarack.js');
        cartAdjustment = await Promise.race([
          adjustSpecialOrderInLiveCart({
            product: existing.product,
            qty: existing.qty,
            distributor: existing.pharmarack_distributor,
            productCode: existing.pharmarack_product_code,
            storeId: existing.pharmarack_store_id
          }),
          new Promise(r => setTimeout(() => r(null), 1500))
        ]);
      } catch (cartErr) {
        console.warn('[Orders] Could not auto-adjust live cart on order status Cancelled:', cartErr);
      }
    }

    broadcastOrdersChanged({ action: 'update_status', orderId: Number(id), patch: { status, auto_remind: newAutoRemind } });
    res.json({ success: true, message: `Order status updated to ${status}`, whatsapp_queued: whatsappQueued, notification_count: newCount, cartAdjustment, auto_remind: newAutoRemind });
  } catch (err: any) {
    console.error('Update order status error:', err);
    res.status(500).json({ error: 'Internal server error: ' + (err?.message || '') });
  }
};

router.post('/:id/status', handleStatusUpdate);
router.put('/:id/status', handleStatusUpdate);

// Toggle auto-remind mode for a special order
router.post('/:id/auto-remind', async (req, res) => {
  const { id } = req.params;
  const { auto_remind } = req.body;
  try {
    const db = await dbManager.getConnection();
    const val = auto_remind === 1 || auto_remind === true ? 1 : 0;
    await db.run('UPDATE special_orders SET auto_remind = ? WHERE id = ?', [val, id]);
    broadcastOrdersChanged({ action: 'auto_remind', orderId: Number(id), patch: { auto_remind: val } });
    res.json({ success: true, id: Number(id), auto_remind: val });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Restore a cancelled order
router.post('/:id/restore', async (req, res) => {
  const { id } = req.params;
  const { restored_by = 'Staff Pharmacist', notes = '' } = req.body;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const existing = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!existing) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (existing.status !== 'Cancelled') {
      return res.status(400).json({ error: 'Order is not cancelled' });
    }

    await db.run('BEGIN TRANSACTION');
    try {
      await db.run(
        `UPDATE special_orders
         SET status = 'Pending',
             pharmacy_verification_status = 'PENDING',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [id]
      );

      await db.run(
        `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
         VALUES (?, 'order_restored', ?, ?, CURRENT_TIMESTAMP)`,
        [id, `Order restored to Pending by ${restored_by}. ${notes ? `Note: ${notes}` : ''}`.trim(), restored_by]
      ).catch(() => {});

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    broadcastOrdersChanged({ action: 'restore', orderId: Number(id), patch: { status: 'Pending', pharmacy_verification_status: 'PENDING' } });
    res.json({ success: true, message: 'Order restored to Pending successfully' });
  } catch (err: any) {
    console.error('Restore order error:', err);
    res.status(500).json({ error: 'Internal server error: ' + (err?.message || '') });
  }
});

// Fetch Order Line Items
router.get('/:id/items', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const items = await db.all(
      `SELECT id, order_id, medicine_id, product_name, requested_qty, confirmed_qty, mrp, sell_price, subtotal, item_status
       FROM online_order_items
       WHERE order_id = ?
       ORDER BY id ASC`,
      [id]
    );

    if (items && items.length > 0) {
      return res.json({ success: true, orderId: Number(id), items });
    }

    // Fallback single item from special_orders row
    const fallbackItem = {
      id: 0,
      order_id: order.id,
      medicine_id: order.medicine_id || null,
      product_name: order.product || order.medicine_name || 'Medicine',
      requested_qty: order.qty || 1,
      confirmed_qty: order.qty || 1,
      mrp: order.pharmarack_mrp || 0,
      sell_price: order.pharmarack_rate || order.advance_payment || order.pharmarack_mrp || 0,
      subtotal: (order.qty || 1) * (order.pharmarack_rate || order.advance_payment || order.pharmarack_mrp || 0),
      item_status: 'PENDING'
    };

    return res.json({ success: true, orderId: Number(id), items: [fallbackItem] });
  } catch (err: any) {
    console.error('Get order items error:', err);
    res.status(500).json({ error: 'Failed to fetch order items' });
  }
});

// Modify Order Line Items (Edit, Add, Remove)
router.put('/:id/items', async (req, res) => {
  const { id } = req.params;
  const { items, removed_item_ids, notes, send_whatsapp, advance_payment } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one medicine item is required' });
  }

  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await db.run('BEGIN TRANSACTION');
    try {
      // 1. Remove deleted items
      if (Array.isArray(removed_item_ids) && removed_item_ids.length > 0) {
        for (const remId of removed_item_ids) {
          const numId = Number(remId);
          if (numId > 0) {
            await db.run('DELETE FROM online_order_items WHERE order_id = ? AND id = ?', [id, numId]);
          }
        }
      }

      // 2. Insert or update items
      for (const it of items) {
        const prodName = String(it.product_name || it.product || it.name || '').trim();
        if (!prodName) continue;
        const qty = Math.max(1, parseInt(String(it.requested_qty || it.qty || 1), 10) || 1);
        const mrp = Number(it.mrp || 0);
        const sellPrice = Number(it.sell_price !== undefined ? it.sell_price : (it.rate !== undefined ? it.rate : mrp));
        const subtotal = qty * sellPrice;
        const itemId = Number(it.id || 0);
        const medId = it.medicine_id ? Number(it.medicine_id) : null;

        if (itemId > 0) {
          const existingItem = await db.get('SELECT id FROM online_order_items WHERE id = ? AND order_id = ?', [itemId, id]);
          if (existingItem) {
            await db.run(
              `UPDATE online_order_items
               SET product_name = ?, product_name_snapshot = ?, requested_qty = ?, mrp = ?, sell_price = ?, subtotal = ?
               WHERE id = ? AND order_id = ?`,
              [prodName, prodName, qty, mrp, sellPrice, subtotal, itemId, id]
            );
          } else {
            await db.run(
              `INSERT INTO online_order_items
               (order_id, medicine_id, product_name, product_name_snapshot, requested_qty, mrp, sell_price, subtotal, item_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
              [id, medId, prodName, prodName, qty, mrp, sellPrice, subtotal]
            );
          }
        } else {
          await db.run(
            `INSERT INTO online_order_items
             (order_id, medicine_id, product_name, product_name_snapshot, requested_qty, mrp, sell_price, subtotal, item_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [id, medId, prodName, prodName, qty, mrp, sellPrice, subtotal]
          );
        }
      }

      // 3. Query all updated items
      const currentItems = await db.all('SELECT * FROM online_order_items WHERE order_id = ? ORDER BY id ASC', [id]);
      if (currentItems.length === 0) {
        throw new Error('Order must contain at least one item');
      }

      const totalAmount = currentItems.reduce((acc: number, it: any) => acc + (Number(it.subtotal) || 0), 0);
      const totalQty = currentItems.reduce((acc: number, it: any) => acc + (Number(it.requested_qty) || 1), 0);
      const summaryProduct = currentItems.length === 1
        ? currentItems[0].product_name
        : `${currentItems[0].product_name} (+${currentItems.length - 1} more)`;

      const newNotes = notes !== undefined ? notes : order.notes;
      const newAdvance = advance_payment !== undefined && advance_payment !== null ? Number(advance_payment) : order.advance_payment;

      // 4. Update special_orders header
      await db.run(
        `UPDATE special_orders
         SET product = ?, medicine_name = ?, qty = ?, total_amount = ?, advance_payment = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [summaryProduct, currentItems[0].product_name, totalQty, totalAmount, newAdvance, newNotes, id]
      );

      // 5. Audit trail
      await db.run(
        `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
         VALUES (?, 'order_modified', ?, 'Staff Pharmacist', CURRENT_TIMESTAMP)`,
        [id, `Order modified: ${currentItems.length} items total (₹${totalAmount.toFixed(2)})`]
      ).catch(() => {});

      await db.run('COMMIT');

      // 6. Human-in-the-Loop WhatsApp notification
      if (Boolean(send_whatsapp) && order.phone) {
        const cleanPhone = String(order.phone).replace(/\D/g, '');
        if (cleanPhone.length >= 10) {
          const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
          const { generateStoreSpecialOrderCode } = await import('../services/whatsappIntentService.js');
          const soCode = await generateStoreSpecialOrderCode(db, order.store_id || 1, Number(id)).catch(() => `SO-TMSA-${id}`);
          const storeName = (await getStoreMedicalName(db, order.store_id || 1)) || 'AI Pharmacy';
          const custName = formatCustomerName(order.requester || 'Customer');

          const itemsText = currentItems.map((it: any, idx: number) => {
            const itemPrice = Number(it.subtotal || 0).toFixed(2);
            return `${idx + 1}. *${it.product_name}* × ${it.requested_qty} (₹${itemPrice})`;
          }).join('\n');

          const waMsg =
            `📝 Hello *${custName}*,\n\n` +
            `Your order *${soCode}* has been updated:\n\n` +
            `${itemsText}\n\n` +
            `💰 *Updated Total*: ₹${totalAmount.toFixed(2)}\n\n` +
            `We are preparing your order. Thank you!\n— ${storeName}`;

          void whatsappQueueWorker.enqueue(
            formattedPhone,
            waMsg,
            'order_modified',
            custName
          ).catch((waErr: any) => console.warn('[Orders] Failed to enqueue WhatsApp on modify:', waErr));
        }
      }

      broadcastOrdersChanged({ action: 'update_items', orderId: Number(id), patch: { total_amount: totalAmount, qty: totalQty, product: summaryProduct } });

      res.json({
        success: true,
        message: 'Order items updated successfully',
        order_id: Number(id),
        items: currentItems,
        total_amount: totalAmount,
        qty: totalQty
      });
    } catch (txErr: any) {
      await db.run('ROLLBACK');
      throw txErr;
    }
  } catch (err: any) {
    console.error('Modify order items error:', err);
    res.status(500).json({ error: 'Failed to modify order items: ' + (err?.message || 'Unknown error') });
  }
});

// Delete an order
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const existing = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!existing) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const result = await db.run('DELETE FROM special_orders WHERE id = ?', id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Cancel and remove any pending unsent WhatsApp queue items & notifications for this deleted order
    await cancelPendingWhatsAppForOrder(db, existing);
    
    // Auto-adjust or remove from Pharmarack Live Cart
    let cartAdjustment: any = null;
    try {
      const { adjustSpecialOrderInLiveCart } = await import('./pharmarack.js');
      cartAdjustment = await Promise.race([
        adjustSpecialOrderInLiveCart({
          product: existing.product,
          qty: existing.qty,
          distributor: existing.pharmarack_distributor,
          productCode: existing.pharmarack_product_code,
          storeId: existing.pharmarack_store_id
        }),
        new Promise(r => setTimeout(() => r(null), 1500))
      ]);
    } catch (cartErr) {
      console.warn('[Orders] Could not auto-adjust live cart on order delete:', cartErr);
    }

    broadcastOrdersChanged({ action: 'delete', orderId: Number(id) });
    res.json({ success: true, message: 'Order deleted successfully', cartAdjustment });
  } catch (err) {
    console.error('Delete order error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Convert special order to recurring refill
router.post('/convert-to-refill', async (req, res) => {
  const { orderId, refillIntervalDays } = req.body;
  if (!orderId || !refillIntervalDays) {
    return res.status(400).json({ error: 'orderId and refillIntervalDays are required' });
  }
  try {
    const { orderFulfillmentService } = await import('../services/orderFulfillmentService.js');
    const result = await orderFulfillmentService.convertToRecurringRefill(
      Number(orderId),
      Number(refillIntervalDays)
    );
    if (result.success) {
      broadcastOrdersChanged();
      try { eventService.broadcast('refill_updated', { at: Date.now(), source: 'convert-to-refill' }); } catch (_) {}
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: any) {
    console.error('Failed to convert order to refill:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Mark special order as Fulfilled / Delivered (manual trigger for WhatsApp receipt if sendWhatsApp is true)
router.post('/:id/fulfill', async (req, res) => {
  const { id } = req.params;
  const { invoiceNo, grandTotal, sendWhatsApp } = req.body;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await db.run("UPDATE special_orders SET status = 'Fulfilled', notified = 1 WHERE id = ?", id);

    // Clean up all staged notifications and arrival alerts for this special order
    await db.run(
      `UPDATE automation_notifications 
       SET lifecycle_status = 'sent', status = 'sent_manually' 
       WHERE (type IN ('special_order_arrived', 'quick_order', 'special_order', 'quick_order_resend', 'quick_order_batch') OR reference_id = ?)
         AND reference_id = ?`,
      [String(id), String(id)]
    ).catch(() => {});

    if (Boolean(sendWhatsApp) && order.phone) {
      const cleanPhone = order.phone.replace(/\D/g, '');
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const medicalName = await getStoreMedicalNameAndPhone(db);

      const invText = invoiceNo ? ` (Invoice: ${invoiceNo})` : '';
      const totalText = grandTotal ? ` Total Amount: ₹${Number(grandTotal).toFixed(2)}.` : '';
      const msg = `Hi ${order.requester || 'Customer'}, your special order for ${order.product} (Qty: ${order.qty}) has been successfully dispensed and delivered at ${medicalName}.${invText}${totalText} Thank you for visiting us!`;

      await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order_fulfilled', order.requester || 'Customer');
    }

    broadcastOrdersChanged();
    res.json({ success: true, message: 'Special order marked as Fulfilled' });
  } catch (err: any) {
    console.error('Fulfill order error:', err);
    res.status(500).json({ error: 'Failed to fulfill order: ' + (err.message || 'Unknown error') });
  }
});

// POST /api/orders/:id/mark-delivered — Mark special order as delivered and start 14-day return window
router.post('/:id/mark-delivered', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const returnStatus = await returnWindowService.markDelivered(orderId);
    broadcastOrdersChanged();
    res.json({ success: true, message: 'Order marked as delivered', return_status: returnStatus });
  } catch (err: any) {
    console.error('Mark order delivered error:', err);
    res.status(500).json({ error: 'Failed to mark order delivered: ' + (err.message || 'Unknown error') });
  }
});

// POST /api/orders/:id/return-override — Human override to approve return after 14-day expiration
router.post('/:id/return-override', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { override_by = 'Pharmacist', reason = 'Customer accommodation' } = req.body;
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const returnStatus = await returnWindowService.applyReturnOverride(orderId, { overrideBy: override_by, reason });
    broadcastOrdersChanged();
    res.json({ success: true, message: 'Return override applied successfully', return_status: returnStatus });
  } catch (err: any) {
    console.error('Return override error:', err);
    res.status(500).json({ error: 'Failed to apply return override: ' + (err.message || 'Unknown error') });
  }
});

// GET /api/orders/:id/return-status — Get 14-day return status for order
router.get('/:id/return-status', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const statusInfo = returnWindowService.evaluateOrderReturnStatus(order);
    res.json(statusInfo);
  } catch (err: any) {
    console.error('Get return status error:', err);
    res.status(500).json({ error: 'Failed to evaluate return status' });
  }
});

// POST /api/orders/:id/delivery-override — Human staff override for estimated delivery window
router.post('/:id/delivery-override', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const {
      estimated_delivery_start,
      estimated_delivery_end,
      reason = 'Manual customer accommodation',
      override_by = 'Staff'
    } = req.body;

    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });
    if (!estimated_delivery_start || !estimated_delivery_end) {
      return res.status(400).json({ error: 'estimated_delivery_start and estimated_delivery_end are required' });
    }

    const updated = await orderScheduleService.overrideOrderSchedule(orderId, {
      estimatedDeliveryStart: estimated_delivery_start,
      estimatedDeliveryEnd: estimated_delivery_end,
      reason,
      overrideBy: override_by
    });

    if (!updated) {
      return res.status(404).json({ error: 'Order not found' });
    }

    broadcastOrdersChanged();
    res.json({ success: true, message: 'Delivery schedule overridden successfully', order: updated });
  } catch (err: any) {
    console.error('Delivery override error:', err);
    res.status(500).json({ error: 'Failed to override delivery schedule: ' + (err.message || 'Unknown error') });
  }
});

// GET /api/orders/incomplete-24h-audit — Audit incomplete orders (>24h SLA) with calendar awareness
router.get('/incomplete-24h-audit', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const storeId = resolveStoreId(req);
    const audit = await orderScheduleService.evaluateIncompleteOrders24hSLA({
      dbInstance: db,
      storeId,
      cutoffHours: 24
    });
    res.json({ success: true, audit });
  } catch (err: any) {
    console.error('Incomplete 24h orders audit error:', err);
    res.status(500).json({ error: 'Failed to evaluate incomplete orders SLA: ' + (err.message || 'Unknown error') });
  }
});

// POST /api/orders/incomplete-24h-action — Human-in-the-loop action handler (push to cart, delay notice, snooze)
router.post('/incomplete-24h-action', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { action, orderIds, customerPhones, template, nextWorkingDate, hours } = req.body;

    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }

    if (action === 'push_to_cart') {
      const ids: number[] = Array.isArray(orderIds) ? orderIds : [];
      let updatedCount = 0;
      for (const id of ids) {
        await db.run("UPDATE special_orders SET status = 'Waiting', updated_at = datetime('now') WHERE id = ?", [id]);
        updatedCount++;
      }
      broadcastOrdersChanged();
      return res.json({ success: true, message: `Pushed ${updatedCount} items to order queue.` });
    }

    if (action === 'send_delay_notices') {
      const phones: string[] = Array.isArray(customerPhones) ? customerPhones : [];
      const msgTemplate: string = template || 'Dear Customer, your order was held due to wholesale market holiday. It will be delivered on {{next_working_date}}.';
      const resumeDateStr: string = nextWorkingDate || 'tomorrow';
      let sentCount = 0;

      for (const rawPhone of phones) {
        if (!rawPhone || rawPhone.trim().length < 5) continue;
        const normalized = normalizeWhatsAppPhone(rawPhone);
        if (!normalized) continue;

        const rendered = msgTemplate.replace(/\{\{next_working_date\}\}/gi, resumeDateStr);
        await whatsappQueueWorker.enqueue(
          normalized,
          rendered,
          'customer_order_update',
          'Customer',
          undefined,
          undefined,
          undefined,
          { skipDedupe: true }
        );
        sentCount++;
      }
      return res.json({ success: true, message: `Queued delay notices for ${sentCount} customer(s).` });
    }

    if (action === 'snooze_sla') {
      const ids: string[] = Array.isArray(orderIds) ? orderIds.map(String) : [];
      const snoozeDurationHours = Number(hours) || 24;
      const snoozeUntil = Date.now() + (snoozeDurationHours * 3600 * 1000);

      const existingRow = await db.get("SELECT value FROM app_settings WHERE key = 'snoozed_24h_order_ids'").catch(() => null);
      let snoozedMap: Record<string, number> = {};
      try {
        if (existingRow?.value) snoozedMap = JSON.parse(existingRow.value);
      } catch (_) {}

      for (const id of ids) {
        snoozedMap[id] = snoozeUntil;
      }

      await db.run(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('snoozed_24h_order_ids', ?)",
        [JSON.stringify(snoozedMap)]
      );

      broadcastOrdersChanged();
      return res.json({ success: true, message: `Snoozed ${ids.length} order(s) for ${snoozeDurationHours} hours.` });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    console.error('Incomplete 24h action error:', err);
    res.status(500).json({ error: 'Failed to process action: ' + (err.message || 'Unknown error') });
  }
});

export default router;
