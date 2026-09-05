import express from 'express';
import fs from 'fs';
import path from 'path';
import { getAppDataDir } from '../config/index.js';
import { dbManager } from '../database/connection.js';
import { returnWindowService } from '../services/returnWindowService.js';
import { eventService } from '../services/eventService.js';
import { formatCustomerName } from '../utils/nameFormatter.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';
import { getStoreMedicalName, getStorePhone } from '../services/storeSettingsService.js';
import { paymentQrService } from '../services/paymentQrService.js';
import { formatProductCode, normalizeProductName, getThreeWordPrefix } from '../utils/productNormalizer.js';
import { orderScheduleService } from '../services/orderScheduleService.js';

const router = express.Router();

const broadcastOrdersChanged = () => {
  try {
    eventService.broadcast('order_updated', { at: Date.now(), source: 'website' });
  } catch (_) {}
};

// ─── Medicine Search (spec §11: highest valid MRP from live batches) ──────────
// ─── Medicine Search (spec §11, §7, §8: 3-word normalized prefix + token match) ──
// GET /api/website/medicines/search
// Customer-facing safe medicine search — never leaks distributor names, cost prices, or internal mappings.
router.get('/medicines/search', async (req, res) => {
  try {
    const query = ((req.query.query as string) || '').trim();
    const storeId = parseInt((req.query.store_id as string) || '1', 10) || 1;
    const limit = Math.min(parseInt((req.query.limit as string) || '20', 10) || 20, 50);

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const db = await dbManager.getConnection();
    const normalizedQuery = normalizeProductName(query);
    const prefix = getThreeWordPrefix(query);

    // Pass 1: 3-word prefix or normalized name match (index scan)
    const medicines: any[] = await db.all(
      `SELECT m.id, m.name, m.canonical_name, m.normalized_name, m.product_code, m.generic_name, m.strength, m.packaging, m.manufacturer, m.category,
              ci.image_path as image_url
       FROM medicines m
       LEFT JOIN catalog_images ci ON ci.medicine_id = m.id AND ci.is_active = 1 AND ci.is_primary = 1
       WHERE ((m.normalized_name IS NOT NULL AND m.normalized_name LIKE ?) OR m.name LIKE ?)
         AND (m.status IS NULL OR m.status = 'ACTIVE')
       ORDER BY m.name ASC
       LIMIT ?`,
      [`${prefix || normalizedQuery}%`, `${query}%`, limit]
    ).catch(() => []);

    // Pass 2: Middle-word token containment if Pass 1 returned too few results
    if (medicines.length < 5 && query.length >= 2) {
      const existingIds = new Set(medicines.map((m: any) => m.id));
      const fallbackRows: any[] = await db.all(
        `SELECT m.id, m.name, m.canonical_name, m.normalized_name, m.product_code, m.generic_name, m.strength, m.packaging, m.manufacturer, m.category,
                ci.image_path as image_url
         FROM medicines m
         LEFT JOIN catalog_images ci ON ci.medicine_id = m.id AND ci.is_active = 1 AND ci.is_primary = 1
         WHERE ((m.normalized_name IS NOT NULL AND m.normalized_name LIKE ?) OR m.name LIKE ?)
           AND (m.status IS NULL OR m.status = 'ACTIVE')
         ORDER BY m.name ASC
         LIMIT ?`,
        [`%${normalizedQuery}%`, `%${query}%`, limit]
      ).catch(() => []);

      for (const f of fallbackRows) {
        if (!existingIds.has(f.id)) {
          medicines.push(f);
          existingIds.add(f.id);
        }
      }
    }

    const safeResults = [];

    for (const med of medicines) {
      // Highest valid MRP from non-expired, in-stock batches for this store (spec §11)
      const batchRow = await db.get(
        `SELECT MAX(mrp) as max_mrp, MAX(sell_price) as max_sell_price, SUM(quantity) as total_qty
         FROM inventory_master
         WHERE medicine_id = ? AND store_id = ? AND is_active = 1
           AND quantity > 0
           AND (expiry_date IS NULL OR date(expiry_date) > date('now'))`,
        [med.id, storeId]
      ).catch(() => null);

      const highestMrp = batchRow?.max_mrp || 0;
      const highestSellPrice = batchRow?.max_sell_price || highestMrp;
      const totalStock = batchRow?.total_qty || 0;

      safeResults.push({
        id: med.id,
        product_id: med.product_code || formatProductCode(med.id),
        name: med.name,
        canonical_name: med.canonical_name || med.name,
        generic_name: med.generic_name || '',
        strength: med.strength || '',
        packaging: med.packaging || '',
        manufacturer: med.manufacturer || '',
        category: med.category || '',
        mrp: highestMrp,
        price: highestSellPrice,
        image_url: med.image_url || null,
        is_available: totalStock > 0,
        availability_status: totalStock > 0 ? 'Available' : 'Sold Out'
      });
    }

    res.json({
      query,
      store_id: storeId,
      count: safeResults.length,
      medicines: safeResults
    });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Medicine search error:', err);
    res.status(500).json({ error: 'Failed to search medicines' });
  }
});

// ─── Create Online Order (spec §15, §18) ─────────────────────────────────────
// POST /api/website/orders
// Creates the order, inserts online_order_items rows, and tranasactionally reserves stock.
// ─── Create Online Order (spec §15, §18, §12, §13) ───────────────────────────
// POST /api/website/orders
// Creates the order, assigns alternating UPI QR, inserts snapshots into online_order_items, and reserves stock.
router.post('/orders', async (req, res) => {
  const {
    customer_name,
    customer_phone,
    customer_address,
    items,
    store_id = 1,
    prescription_url,
    product_image_url,
    notes,
    payment_method = 'COUNTER_PICKUP',
    delivery_mode = 'pickup',
    order_type: explicitOrderType
  } = req.body;

  if (!customer_name || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Customer name and at least one item are required' });
  }

  try {
    const db = await dbManager.getConnection();
    const cleanPhone = customer_phone ? String(customer_phone).replace(/\D/g, '') : '';
    const cleanName = formatCustomerName(customer_name);
    const targetStoreId = parseInt(String(store_id), 10) || 1;
    const todayStr = new Date().toISOString();
    const orderType = (explicitOrderType || (delivery_mode === 'delivery' ? 'DELIVERY' : 'PICKUP')).toUpperCase();

    // Calculate total order amount
    const totalOrderAmount = items.reduce(
      (sum: number, it: any) => sum + ((Number(it.qty) || 1) * (Number(it.price || it.mrp) || 0)),
      0
    );

    // 3-QR Code Allocation (§13): Strict alternating rotation if UPI
    let allocatedQr = null;
    if (payment_method === 'UPI') {
      allocatedQr = await paymentQrService.allocateNextQr();
    }

    // Ensure customer exists
    let customerId: number | null = null;
    if (cleanPhone && cleanPhone.length >= 10) {
      try {
        const existingCust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
        if (existingCust) {
          customerId = existingCust.id;
        } else {
          const custRes = await db.run(
            'INSERT INTO customers (name, phone, address, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
            [cleanName, cleanPhone, customer_address || '']
          );
          customerId = custRes.lastID as number;
        }
      } catch (_) {}
    }

    const schedule = await orderScheduleService.calculateOrderSchedule({
      storeId: targetStoreId,
      orderCreatedAt: todayStr,
      orderType: orderType,
      dbInstance: db
    });

    const createdOrders: Array<{ id: number; product: string; qty: number; payment_qr_id?: string | null }> = [];

    await db.run('BEGIN TRANSACTION');
    try {
      for (const item of items) {
        const prodName = (item.product || item.product_name || item.name || '').trim();
        if (!prodName) continue;
        const qty = Number(item.qty) || 1;
        const medicineId: number | null = item.medicine_id ? Number(item.medicine_id) : null;

        // Get current highest MRP for this medicine if we have an id
        let mrp = Number(item.price || item.mrp || 0);
        if (medicineId && !mrp) {
          const batchRow = await db.get(
            `SELECT MAX(mrp) as max_mrp FROM inventory_master
             WHERE medicine_id = ? AND store_id = ? AND is_active = 1 AND quantity > 0
               AND (expiry_date IS NULL OR date(expiry_date) > date('now'))`,
            [medicineId, targetStoreId]
          ).catch(() => null);
          mrp = batchRow?.max_mrp || 0;
        }

        const itemSubtotal = qty * mrp;

        // Check stock availability and reservation race condition (spec §18)
        if (medicineId) {
          const availRow = await db.get(
            `SELECT SUM(im.quantity) - COALESCE(
               (SELECT SUM(r.reserved_qty) FROM inventory_reservations r
                JOIN inventory_master i ON i.id = r.inventory_id
                WHERE i.medicine_id = ? AND i.store_id = ? AND r.status = 'ACTIVE'), 0
             ) as available_qty
             FROM inventory_master im
             WHERE im.medicine_id = ? AND im.store_id = ? AND im.is_active = 1
               AND im.quantity > 0
               AND (im.expiry_date IS NULL OR date(im.expiry_date) > date('now'))`,
            [medicineId, targetStoreId, medicineId, targetStoreId]
          ).catch(() => null);

          const availQty = availRow?.available_qty || 0;
          if (availQty < qty) {
            await db.run('ROLLBACK');
            return res.status(409).json({
              error: `Insufficient stock for "${prodName}". Available: ${Math.max(0, availQty)}, Requested: ${qty}`,
              product: prodName,
              available_qty: Math.max(0, availQty)
            });
          }
        }

        const initialPaymentStatus = payment_method === 'UPI' ? 'UNPAID' : 'UNPAID';
        const initialVerificationStatus = 'PENDING';

        const result = await db.run(
          `INSERT INTO special_orders (
            store_id, customer_id, product, requester, phone, qty, priority, status, date, notified,
            advance_payment, notes, customer_order_source, prescription_url, product_image_url,
            delivery_status, return_status, payment_status, pharmacy_verification_status,
            payment_qr_id, order_type, total_amount,
            scheduled_processing_at, estimated_delivery_start, estimated_delivery_end,
            cutoff_at, pharmacy_timezone, schedule_status, schedule_reason, schedule_version, schedule_calculated_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'Normal', 'Pending', ?, 0, 0, ?, 'website', ?, ?, 'pending', 'none', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            targetStoreId,
            customerId,
            prodName,
            cleanName,
            cleanPhone,
            qty,
            todayStr,
            notes ? `[Website Order] ${notes}` : '[Website Order]',
            prescription_url || null,
            product_image_url || null,
            initialPaymentStatus,
            initialVerificationStatus,
            allocatedQr?.id || null,
            orderType,
            totalOrderAmount,
            schedule.scheduled_processing_at,
            schedule.estimated_delivery_start,
            schedule.estimated_delivery_end,
            schedule.cutoff_at,
            schedule.pharmacy_timezone,
            schedule.schedule_status,
            schedule.schedule_reason,
            schedule.schedule_version,
            schedule.schedule_calculated_at
          ]
        );

        const orderId = Number(result.lastID);
        createdOrders.push({ id: orderId, product: prodName, qty, payment_qr_id: allocatedQr?.id || null });

        // Insert online_order_items row with permanent snapshot data (§5, §6)
        const itemRes = await db.run(
          `INSERT INTO online_order_items (
            order_id, medicine_id, product_name, product_name_snapshot,
            requested_qty, mrp, price_snapshot, subtotal, item_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
          [orderId, medicineId, prodName, prodName, qty, mrp, mrp, itemSubtotal]
        );
        const orderItemId = Number(itemRes.lastID);

        // Transactional stock reservation (spec §18) — reserve from the best batch
        if (medicineId) {
          const bestBatch = await db.get(
            `SELECT id, quantity FROM inventory_master
             WHERE medicine_id = ? AND store_id = ? AND is_active = 1 AND quantity > 0
               AND (expiry_date IS NULL OR date(expiry_date) > date('now'))
             ORDER BY mrp DESC, expiry_date ASC
             LIMIT 1`,
            [medicineId, targetStoreId]
          ).catch(() => null);

          if (bestBatch) {
            await db.run(
              `INSERT INTO inventory_reservations (inventory_id, order_id, order_item_id, reserved_qty, status)
               VALUES (?, ?, ?, ?, 'ACTIVE')`,
              [bestBatch.id, orderId, orderItemId, qty]
            );
          }
        }

        // Record order tracking event
        await db.run(
          `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
           VALUES (?, 'website_order_created', ?, 'customer', CURRENT_TIMESTAMP)`,
          [orderId, `Order placed online (${orderType}) for Store #${targetStoreId}. Items: ${prodName} (Qty: ${qty}) - Estimated: ${schedule.formatted_window}`]
        );
      }

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    // Send WhatsApp order confirmation with exact same selected QR (§14)
    if (cleanPhone && cleanPhone.length >= 10) {
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const medicalName = await getStoreMedicalName(db);
      const itemsSummary = createdOrders.map((o, idx) => `${idx + 1}. ${o.product} (x${o.qty})`).join('\n');
      const orderIdsStr = createdOrders.map(o => `#${o.id}`).join(', ');

      let confirmMsg = `Hello ${cleanName}, thank you for your order (${orderIdsStr}) at ${medicalName}!\n\nOrder Items:\n${itemsSummary}\nTotal Amount: ₹${totalOrderAmount.toFixed(2)}\n\n🚚 *Estimated Delivery:* ${schedule.formatted_window}${schedule.schedule_reason ? `\nℹ️ *Note:* ${schedule.schedule_reason}` : ''}`;

      if (allocatedQr) {
        const upiUri = paymentQrService.buildUpiUri(allocatedQr.upi_id, allocatedQr.payee_name, totalOrderAmount, createdOrders[0]?.id || 1);
        confirmMsg += `\n\n💳 Payment Instructions (${allocatedQr.label}):\nUPI ID: ${allocatedQr.upi_id}\nPayee: ${allocatedQr.payee_name}\nUPI Pay Link:\n${upiUri}\n\n*Important:* After paying via UPI, click "I HAVE PAID" on the website to notify the pharmacy to prepare your order.`;
      } else {
        confirmMsg += `\n\n🏢 Fulfillment: In-Store Pickup\nPlease collect and pay at our pharmacy counter.`;
      }

      try {
        await whatsappQueueWorker.enqueue(formattedPhone, confirmMsg, 'website_order_confirmation', cleanName);
      } catch (_) {}
    }

    broadcastOrdersChanged();

    const primaryOrderId = createdOrders[0]?.id;
    const paymentQrResponse = allocatedQr
      ? {
          qr_id: allocatedQr.id,
          label: allocatedQr.label,
          payee_name: allocatedQr.payee_name,
          upi_id: allocatedQr.upi_id,
          qr_image_url: allocatedQr.qr_image_url || '',
          amount: totalOrderAmount,
          upi_uri: paymentQrService.buildUpiUri(
            allocatedQr.upi_id,
            allocatedQr.payee_name,
            totalOrderAmount,
            primaryOrderId || 1
          )
        }
      : null;

    res.status(201).json({
      success: true,
      message: 'Website order placed successfully',
      store_id: targetStoreId,
      order_type: orderType,
      orders: createdOrders,
      order_id: primaryOrderId,
      total_amount: totalOrderAmount,
      payment_method,
      payment_qr: paymentQrResponse,
      customer: { name: cleanName, phone: cleanPhone },
      timing: {
        sameDay: schedule.is_same_day,
        scheduledProcessingAt: schedule.scheduled_processing_at,
        estimatedDeliveryStart: schedule.estimated_delivery_start,
        estimatedDeliveryEnd: schedule.estimated_delivery_end,
        cutoffAt: schedule.cutoff_at,
        timezone: schedule.pharmacy_timezone,
        status: schedule.schedule_status,
        reason: schedule.schedule_reason,
        formattedWindow: schedule.formatted_window
      },
      returnPolicy: {
        eligible: true,
        windowDays: 15
      }
    });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Order placement error:', err);
    res.status(500).json({ error: 'Failed to place order: ' + (err.message || 'Unknown error') });
  }
});

// ─── Customer Reports "I HAVE PAID" (§12) ────────────────────────────────────
// POST /api/website/orders/:orderId/mark-paid
router.post('/orders/:orderId/mark-paid', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await db.run(
      `UPDATE special_orders
       SET payment_status = 'PENDING_VERIFICATION',
           pharmacy_verification_status = 'PENDING',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [orderId]
    );

    await db.run(
      `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
       VALUES (?, 'customer_marked_paid', 'Customer reported payment completed. Awaiting pharmacy verification.', 'customer', CURRENT_TIMESTAMP)`,
      [orderId]
    );

    // Automatically send WhatsApp message requesting payment screenshot
    if (order.phone) {
      try {
        const storeName = (await getStoreMedicalName(db, order.store_id)) || 'AI Pharmacy';
        const customerName = formatCustomerName(order.customer_name || order.requester || 'Customer');
        const formattedAmount = Number(order.total_amount || 0).toFixed(2);
        const screenshotMsg =
          `🙏 Namaste ${customerName}!\n\n` +
          `We have received your payment report for Order #${orderId} (₹${formattedAmount}).\n\n` +
          `📸 *Please reply directly to this WhatsApp message with a screenshot of your payment receipt / UPI confirmation.*\n\n` +
          `Our pharmacy team will manually verify the payment details and process your order.\n\n` +
          `Thank you!\n— ${storeName}`;

        await whatsappQueueWorker.enqueue(
          order.phone,
          screenshotMsg,
          'payment_screenshot_request',
          customerName
        );
      } catch (waErr) {
        console.warn('[WebsiteOrdersRoute] Could not enqueue payment screenshot request:', waErr);
      }
    }

    broadcastOrdersChanged();

    res.json({
      success: true,
      message: 'Payment reported successfully. Pharmacy verification is in progress.',
      order_id: orderId,
      payment_status: 'PENDING_VERIFICATION'
    });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Mark paid error:', err);
    res.status(500).json({ error: 'Failed to mark order paid' });
  }
});

// ─── Fetch Order Payment QR Details (§13, §14) ───────────────────────────────
// GET /api/website/orders/:orderId/payment-qr
router.get('/orders/:orderId/payment-qr', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const details = await paymentQrService.getOrderQrDetails(orderId);
    if (!details) return res.status(404).json({ error: 'Order or QR configuration not found' });

    res.json({ success: true, ...details });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Payment QR fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch payment QR' });
  }
});

// ─── Confirm Payment & Mark Ready for Pickup (§12, §6) ────────────────────────
// PATCH /api/website/orders/:orderId/payment
// Pharmacy marks payment as CONFIRMED — transitions status to ORDER_READY_FOR_PICKUP.
router.patch('/orders/:orderId/payment', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const { payment_reference = '', confirmed_by = 'Pharmacist', payment_method = 'MANUAL' } = req.body;

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.payment_status === 'CONFIRMED' || order.payment_status === 'PAYMENT_CONFIRMED') {
      return res.status(409).json({ error: 'Payment already confirmed for this order' });
    }

    const nextOrderStatus = order.order_type === 'DELIVERY' ? 'Ready' : 'ORDER_READY_FOR_PICKUP';

    await db.run(
      `UPDATE special_orders
       SET payment_status = 'PAYMENT_CONFIRMED',
           pharmacy_verification_status = 'CONFIRMED',
           status = ?,
           payment_reference = ?,
           payment_confirmed_at = CURRENT_TIMESTAMP,
           payment_confirmed_by = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextOrderStatus, payment_reference || `${payment_method}-${Date.now()}`, confirmed_by, orderId]
    );

    await db.run(
      `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
       VALUES (?, 'payment_confirmed', ?, ?, CURRENT_TIMESTAMP)`,
      [orderId, `Payment confirmed via ${payment_method}. Ref: ${payment_reference || 'N/A'}. Ready for pickup.`, confirmed_by]
    );

    broadcastOrdersChanged();

    res.json({
      success: true,
      message: `Payment confirmed. Order #${orderId} is now ${nextOrderStatus}.`,
      order_id: orderId,
      status: nextOrderStatus,
      payment_status: 'PAYMENT_CONFIRMED'
    });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Payment confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// ─── Live Cart Queue (spec §3) ────────────────────────────────────────────────
// GET /api/website/live-cart
// Returns all paid, unverified orders with their items — the pharmacy's fulfilment workspace.
router.get('/live-cart', async (req, res) => {
  try {
    const storeId = parseInt((req.query.store_id as string) || '1', 10) || 1;
    const db = await dbManager.getConnection();

    const orders = await db.all(
      `SELECT so.*
       FROM special_orders so
       WHERE so.store_id = ?
         AND so.payment_status = 'CONFIRMED'
         AND so.pharmacy_verification_status != 'DONE'
       ORDER BY so.payment_confirmed_at ASC, so.date DESC`,
      [storeId]
    );

    // Attach items and batch options for each order
    const enriched = await Promise.all(orders.map(async (order: any) => {
      const items = await db.all(
        `SELECT oi.*,
                m.name as medicine_name, m.generic_name, m.strength, m.packaging, m.manufacturer,
                am.name as actual_medicine_name,
                im.batch_no as actual_batch_no, im.mrp as actual_mrp, im.expiry_date as actual_expiry
         FROM online_order_items oi
         LEFT JOIN medicines m ON m.id = oi.medicine_id
         LEFT JOIN medicines am ON am.id = oi.actual_medicine_id
         LEFT JOIN inventory_master im ON im.id = oi.actual_batch_id
         WHERE oi.order_id = ?
         ORDER BY oi.id ASC`,
        [order.id]
      ).catch(() => []);

      // Attach available batch options for each item (so pharmacy can pick)
      const itemsWithBatches = await Promise.all(items.map(async (item: any) => {
        const batches = await db.all(
          `SELECT id, batch_no, expiry_date, mrp, sell_price,
                  (quantity - COALESCE(
                    (SELECT SUM(r.reserved_qty) FROM inventory_reservations r
                     WHERE r.inventory_id = inventory_master.id AND r.status = 'ACTIVE'), 0
                  )) as available_qty
           FROM inventory_master
           WHERE medicine_id = ? AND store_id = ? AND is_active = 1
             AND quantity > 0
             AND (expiry_date IS NULL OR date(expiry_date) > date('now'))
           ORDER BY mrp DESC, expiry_date ASC`,
          [item.medicine_id || item.actual_medicine_id, storeId]
        ).catch(() => []);
        return { ...item, available_batches: batches };
      }));

      return { ...order, items: itemsWithBatches };
    }));

    res.json({ store_id: storeId, count: enriched.length, orders: enriched });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Live cart fetch error:', err);
    res.status(500).json({ error: 'Failed to load live cart' });
  }
});

// ─── Verify / Update Item (spec §4, §7) ──────────────────────────────────────
// PATCH /api/website/live-cart/items/:itemId
// Pharmacy selects actual batch, replaces product, adjusts qty, or marks unavailable.
router.patch('/live-cart/items/:itemId', async (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(itemId)) return res.status(400).json({ error: 'Invalid item ID' });

    const {
      actual_medicine_id,
      actual_batch_id,
      confirmed_qty,
      item_status,            // 'CONFIRMED' | 'REPLACED' | 'UNAVAILABLE' | 'QTY_ADJUSTED'
      replacement_reason = '',
      changed_by = 'Pharmacist'
    } = req.body;

    if (!item_status) return res.status(400).json({ error: 'item_status is required' });

    const db = await dbManager.getConnection();
    const item = await db.get('SELECT * FROM online_order_items WHERE id = ?', [itemId]);
    if (!item) return res.status(404).json({ error: 'Order item not found' });

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [item.order_id]);
    if (!order) return res.status(404).json({ error: 'Associated order not found' });

    if (order.pharmacy_verification_status === 'DONE') {
      return res.status(409).json({ error: 'Order is already finalized' });
    }

    // Validate batch has enough stock when confirming
    if (actual_batch_id && item_status !== 'UNAVAILABLE') {
      const batch = await db.get('SELECT * FROM inventory_master WHERE id = ?', [actual_batch_id]);
      if (!batch) return res.status(404).json({ error: 'Batch not found' });

      const reservedElsewhere = await db.get(
        `SELECT COALESCE(SUM(r.reserved_qty), 0) as reserved
         FROM inventory_reservations r
         WHERE r.inventory_id = ? AND r.status = 'ACTIVE' AND r.order_item_id != ?`,
        [actual_batch_id, itemId]
      ).catch(() => ({ reserved: 0 }));

      const effectiveQty = confirmed_qty ?? item.requested_qty;
      const available = batch.quantity - (reservedElsewhere?.reserved || 0);
      if (available < effectiveQty) {
        return res.status(409).json({
          error: `Insufficient stock. Available: ${available}, Needed: ${effectiveQty}`,
          available_qty: available
        });
      }
    }

    // Write audit log if product is being changed (spec §7, §20)
    const isReplacement = actual_medicine_id && Number(actual_medicine_id) !== Number(item.medicine_id);
    const isBatchChange = actual_batch_id && Number(actual_batch_id) !== Number(item.actual_batch_id);
    if (isReplacement || isBatchChange || item_status === 'UNAVAILABLE') {
      await db.run(
        `INSERT INTO catalog_correction_log
           (order_id, order_item_id, changed_by, old_medicine_id, new_medicine_id,
            old_batch_id, new_batch_id, change_type, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.order_id, itemId, changed_by,
          item.medicine_id, actual_medicine_id ?? item.medicine_id,
          item.actual_batch_id, actual_batch_id ?? item.actual_batch_id,
          item_status === 'UNAVAILABLE' ? 'UNAVAILABLE' : isReplacement ? 'REPLACEMENT' : 'BATCH_CHANGE',
          replacement_reason || null
        ]
      );
    }

    // Get MRP/sell_price from selected batch
    let mrp = item.mrp;
    let sellPrice = item.sell_price;
    if (actual_batch_id) {
      const batchInfo = await db.get('SELECT mrp, sell_price FROM inventory_master WHERE id = ?', [actual_batch_id]).catch(() => null);
      if (batchInfo) { mrp = batchInfo.mrp; sellPrice = batchInfo.sell_price; }
    }
    const finalQty = confirmed_qty ?? item.requested_qty;
    const finalSell = sellPrice || mrp || 0;
    const discount = mrp > 0 ? Math.max(0, mrp - finalSell) : 0;
    const finalPrice = finalQty * finalSell;

    await db.run(
      `UPDATE online_order_items
       SET actual_medicine_id = COALESCE(?, actual_medicine_id),
           actual_batch_id = COALESCE(?, actual_batch_id),
           confirmed_qty = ?,
           mrp = ?,
           sell_price = ?,
           discount = ?,
           final_price = ?,
           item_status = ?,
           replacement_reason = COALESCE(?, replacement_reason)
       WHERE id = ?`,
      [
        actual_medicine_id || null,
        actual_batch_id || null,
        finalQty,
        mrp, finalSell, discount, finalPrice,
        item_status,
        replacement_reason || null,
        itemId
      ]
    );

    // Update inventory_reservations to point to confirmed batch
    if (actual_batch_id && item_status !== 'UNAVAILABLE') {
      // Release old reservation
      await db.run(
        `UPDATE inventory_reservations SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
         WHERE order_item_id = ? AND status = 'ACTIVE'`,
        [itemId]
      );
      // Create new reservation on confirmed batch
      await db.run(
        `INSERT INTO inventory_reservations (inventory_id, order_id, order_item_id, reserved_qty, status)
         VALUES (?, ?, ?, ?, 'ACTIVE')`,
        [actual_batch_id, item.order_id, itemId, finalQty]
      );
    }

    if (item_status === 'UNAVAILABLE') {
      // Release reservation — no stock will be consumed
      await db.run(
        `UPDATE inventory_reservations SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
         WHERE order_item_id = ? AND status = 'ACTIVE'`,
        [itemId]
      );
    }

    broadcastOrdersChanged();

    res.json({ success: true, message: 'Item updated', item_id: itemId, item_status });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Item verify error:', err);
    res.status(500).json({ error: 'Failed to update order item' });
  }
});

// ─── Finalize Order → Push to POS Held Bill (spec §6, §19) ───────────────────
// POST /api/website/live-cart/orders/:orderId/finalize
// Pharmacy finalizes: deducts stock, marks order CONFIRMED, pushes a held bill to POS.
router.post('/live-cart/orders/:orderId/finalize', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const { finalized_by = 'Pharmacist' } = req.body;

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.payment_status !== 'CONFIRMED') {
      return res.status(400).json({ error: 'Order payment is not confirmed yet' });
    }
    if (order.pharmacy_verification_status === 'DONE') {
      return res.status(409).json({ error: 'Order already finalized' });
    }

    const items = await db.all(
      `SELECT oi.*, im.mrp as batch_mrp, im.sell_price as batch_sell, im.batch_no,
              COALESCE(am.name, m.name) as resolved_name, m.id as orig_med_id
       FROM online_order_items oi
       LEFT JOIN medicines m ON m.id = oi.medicine_id
       LEFT JOIN medicines am ON am.id = oi.actual_medicine_id
       LEFT JOIN inventory_master im ON im.id = oi.actual_batch_id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    const confirmedItems = items.filter((i: any) => i.item_status !== 'UNAVAILABLE');
    if (confirmedItems.length === 0) {
      return res.status(400).json({ error: 'No confirmed items in order — cannot finalize. Mark order as cancelled instead.' });
    }

    // Check all items have been reviewed
    const pendingItems = items.filter((i: any) => i.item_status === 'PENDING');
    if (pendingItems.length > 0) {
      return res.status(400).json({
        error: `${pendingItems.length} item(s) still pending pharmacy review`,
        pending_count: pendingItems.length
      });
    }

    await db.run('BEGIN TRANSACTION');
    try {
      // Deduct inventory for confirmed items (spec §19)
      for (const item of confirmedItems) {
        if (item.actual_batch_id) {
          await db.run(
            'UPDATE inventory_master SET quantity = quantity - ? WHERE id = ? AND quantity >= ?',
            [item.confirmed_qty, item.actual_batch_id, item.confirmed_qty]
          );
          // Mark reservation as SOLD
          await db.run(
            `UPDATE inventory_reservations SET status = 'SOLD', released_at = CURRENT_TIMESTAMP
             WHERE order_item_id = ? AND status = 'ACTIVE'`,
            [item.id]
          );
        }
      }

      // Mark order as pharmacy verified + status Ready
      await db.run(
        `UPDATE special_orders
         SET pharmacy_verification_status = 'DONE',
             pharmacy_verified_by = ?,
             pharmacy_verified_at = CURRENT_TIMESTAMP,
             status = 'Ready',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [finalized_by, orderId]
      );

      // Build held-bill JSON for POS (spec §19 — POS sale links to online order)
      const heldBillItems = confirmedItems.map((item: any) => ({
        medicine_id: item.actual_medicine_id || item.medicine_id,
        medicine_name: item.resolved_name,
        batch_id: item.actual_batch_id,
        batch_no: item.batch_no || '',
        qty: item.confirmed_qty ?? item.requested_qty,
        mrp: item.batch_mrp || item.mrp || 0,
        sell_price: item.batch_sell || item.sell_price || item.mrp || 0,
        discount: item.discount || 0,
        final_price: item.final_price || 0
      }));

      const heldBillMeta = {
        source: 'online_order',
        online_order_id: orderId,
        customer_name: order.requester,
        customer_phone: order.phone,
        customer_id: order.customer_id,
        items: heldBillItems,
        notes: `Online Order #${orderId} — Payment Confirmed`
      };

      await db.run(
        `INSERT INTO staged_sales (store_id, customer_id, customer_name, cart_json, created_at, status)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'held')`,
        [order.store_id, order.customer_id, order.requester, JSON.stringify(heldBillMeta)]
      );

      // Audit log
      await db.run(
        `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
         VALUES (?, 'order_finalized', ?, ?, CURRENT_TIMESTAMP)`,
        [orderId, `Order finalized by pharmacy. ${confirmedItems.length} items confirmed, ${items.length - confirmedItems.length} unavailable. Held bill pushed to POS.`, finalized_by]
      );

      await db.run(
        `INSERT INTO action_logs (action_type, description, metadata, created_at)
         VALUES ('online_order_finalized', ?, ?, CURRENT_TIMESTAMP)`,
        [
          `Online Order #${orderId} finalized — ${confirmedItems.length} item(s) confirmed`,
          JSON.stringify({ orderId, finalized_by, confirmed_items: confirmedItems.length })
        ]
      );

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    // WhatsApp: notify customer order is ready
    if (order.phone && String(order.phone).replace(/\D/g, '').length >= 10) {
      try {
        const cleanPhone = String(order.phone).replace(/\D/g, '');
        const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
        const medicalName = await getStoreMedicalName(db);
        const readyMsg = `Hello ${order.requester}, your order #${orderId} at ${medicalName} is ready for pickup/delivery!\n\nThank you for your payment.`;
        await whatsappQueueWorker.enqueue(formattedPhone, readyMsg, 'order_ready_notification', order.requester);
      } catch (_) {}
    }

    broadcastOrdersChanged();

    res.json({
      success: true,
      message: 'Order finalized. Held bill pushed to POS.',
      order_id: orderId,
      confirmed_items: confirmedItems.length,
      unavailable_items: items.length - confirmedItems.length
    });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Finalize error:', err);
    res.status(500).json({ error: 'Failed to finalize order' });
  }
});

// ─── Cancel / Refund Trigger (spec §24) ──────────────────────────────────────
// POST /api/website/live-cart/orders/:orderId/cancel
router.post('/live-cart/orders/:orderId/cancel', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const { reason = 'Cancelled by pharmacy', cancelled_by = 'Pharmacist' } = req.body;

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.pharmacy_verification_status === 'DONE') {
      return res.status(409).json({ error: 'Finalized orders cannot be cancelled — raise a return instead' });
    }

    await db.run('BEGIN TRANSACTION');
    try {
      // Release all active reservations
      await db.run(
        `UPDATE inventory_reservations SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
         WHERE order_id = ? AND status = 'ACTIVE'`,
        [orderId]
      );

      await db.run(
        `UPDATE special_orders
         SET status = 'Cancelled',
             pharmacy_verification_status = 'CANCELLED',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [orderId]
      );

      await db.run(
        `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
         VALUES (?, 'order_cancelled', ?, ?, CURRENT_TIMESTAMP)`,
        [orderId, `Order cancelled. Reason: ${reason}. ${order.payment_status === 'CONFIRMED' ? 'REFUND REQUIRED.' : ''}`, cancelled_by]
      );

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    broadcastOrdersChanged();

    res.json({
      success: true,
      message: 'Order cancelled. Stock reservations released.',
      refund_required: order.payment_status === 'CONFIRMED',
      order_id: orderId
    });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// ─── Track Order (customer-facing) ───────────────────────────────────────────
// GET /api/website/orders/:orderId/track
router.get('/orders/:orderId/track', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const events = await db.all(
      'SELECT * FROM order_tracking_events WHERE order_id = ? ORDER BY performed_at ASC',
      [orderId]
    ).catch(() => []);

    const returnInfo = returnWindowService.evaluateOrderReturnStatus(order);

    res.json({
      order_id: order.id,
      store_id: order.store_id,
      product: order.product || order.medicine_name,
      quantity: order.qty,
      requester: order.requester,
      status: order.status,
      payment_status: order.payment_status,
      pharmacy_verification_status: order.pharmacy_verification_status,
      delivery_status: order.delivery_status || 'pending',
      created_at: order.created_at,
      delivered_at: order.delivered_at,
      return_window: returnInfo,
      tracking_timeline: events
    });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Order tracking error:', err);
    res.status(500).json({ error: 'Failed to track order' });
  }
});

// ─── Return Request (customer-facing) ────────────────────────────────────────
// POST /api/website/orders/:orderId/return-request
router.post('/orders/:orderId/return-request', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    const { reason = 'Customer return request' } = req.body;
    if (isNaN(orderId)) return res.status(400).json({ error: 'Invalid order ID' });

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const returnInfo = returnWindowService.evaluateOrderReturnStatus(order);
    if (!returnInfo.isEligible) {
      return res.status(400).json({
        error: '14-day return window has expired for this order.',
        return_info: returnInfo
      });
    }

    await db.run(
      `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
       VALUES (?, 'return_requested', ?, 'customer', CURRENT_TIMESTAMP)`,
      [orderId, `Customer requested return within 14-day window. Reason: ${reason}`]
    );

    await db.run(
      `INSERT INTO action_logs (action_type, description, metadata, created_at)
       VALUES ('website_return_request', ?, ?, CURRENT_TIMESTAMP)`,
      [
        `Return requested for Order #${orderId} (${order.product})`,
        JSON.stringify({ orderId, reason, customer: order.requester, phone: order.phone })
      ]
    );

    broadcastOrdersChanged();

    res.json({
      success: true,
      message: 'Return request submitted. Our pharmacy team will process your return.',
      return_info: returnInfo
    });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Return request error:', err);
    res.status(500).json({ error: 'Failed to submit return request' });
  }
});

// ─── Direct Prescription / Medicine Photo Request to Pharmacy WhatsApp ──────
// POST /api/website/prescription-request
// Allows customers to upload a prescription slip or medicine photo when searching or ordering,
// saves an order record in special_orders (visible in Website Orders & Live Cart),
// and redirects customer directly to the configured pharmacy WhatsApp phone number.
router.post('/prescription-request', async (req, res) => {
  try {
    const {
      customer_name,
      customer_phone,
      medicine_name,
      notes,
      image,
      images,
      store_id = 1
    } = req.body;

    if (!customer_name || !String(customer_name).trim()) {
      return res.status(400).json({ error: 'Patient or customer name is required' });
    }

    const cleanPhone = customer_phone ? String(customer_phone).replace(/\D/g, '') : '';
    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Valid 10-digit mobile number is required' });
    }

    const cleanName = formatCustomerName(customer_name);
    const targetStoreId = parseInt(String(store_id), 10) || 1;

    // Collect all base64 image strings (supports both single `image` and array `images`)
    let imageList: string[] = [];
    if (Array.isArray(images) && images.length > 0) {
      imageList = images.filter((img: any) => typeof img === 'string' && img.trim().length > 0);
    } else if (image && typeof image === 'string' && image.trim().length > 0) {
      imageList = [image.trim()];
    }

    const savedUrls: string[] = [];
    if (imageList.length > 0) {
      const uploadsDir = path.resolve(getAppDataDir(), 'uploads', 'prescriptions');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      for (let i = 0; i < imageList.length; i++) {
        const rawImg = imageList[i];
        const base64Str = rawImg.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Str, 'base64');
        const safeName = `Rx_Web_${Date.now()}_${i + 1}_${Math.random().toString(36).substring(2, 7)}.jpg`;
        const fullPath = path.join(uploadsDir, safeName);
        fs.writeFileSync(fullPath, buffer);
        savedUrls.push(`/uploads/prescriptions/${safeName}`);
      }
    }

    // Single URL or JSON array string for multiple URLs
    let prescriptionUrl = '';
    if (savedUrls.length === 1) {
      prescriptionUrl = savedUrls[0];
    } else if (savedUrls.length > 1) {
      prescriptionUrl = JSON.stringify(savedUrls);
    }

    const db = await dbManager.getConnection();
    const medRequested = (medicine_name || '').trim() || 'Prescription / Medicine Inquiry';
    const notesText = (notes || '').trim();

    // Insert order record into special_orders
    const result = await db.run(
      `INSERT INTO special_orders (
        store_id, requester, phone, medicine_name, product, qty, notes,
        status, customer_order_source, source, prescription_url, total_amount, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, 'Pending', 'website', 'website', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        targetStoreId,
        cleanName,
        cleanPhone,
        medRequested,
        medRequested,
        notesText || 'Requested via Website Prescription / Photo Upload',
        prescriptionUrl || null
      ]
    );

    const orderId = result.lastID;

    // Log tracking event
    await db.run(
      `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
       VALUES (?, 'order_created', ?, 'customer', CURRENT_TIMESTAMP)`,
      [orderId, `Customer uploaded ${savedUrls.length || 1} prescription/photo inquiry via website`]
    ).catch(() => {});

    // Resolve configured pharmacy name and phone number from store and app_settings
    let pharmacyName = await getStoreMedicalName(db, targetStoreId);
    let pharmacyPhone = await getStorePhone(db, targetStoreId);

    // Dynamic fallback to app_settings if store row had blank contact
    if (!pharmacyPhone || !pharmacyPhone.trim()) {
      const settingRow = await db.get(
        `SELECT value FROM app_settings 
         WHERE key IN ('shop_phone', 'owner_whatsapp_number', 'store_phone', 'pharmacy_phone', 'phone') 
           AND value IS NOT NULL AND TRIM(value) != '' 
         LIMIT 1`
      );
      if (settingRow && settingRow.value) {
        pharmacyPhone = settingRow.value.trim();
      }
    }

    let cleanPharmacyPhone = (pharmacyPhone || '').replace(/\D/g, '');
    if (cleanPharmacyPhone.length === 11 && cleanPharmacyPhone.startsWith('0')) {
      cleanPharmacyPhone = cleanPharmacyPhone.slice(1);
    }
    const targetPhone = cleanPharmacyPhone.length === 10 ? `91${cleanPharmacyPhone}` : cleanPharmacyPhone;

    // Public host URL for prescription image previews
    const host = req.get('host') || 'localhost:5175';
    const protocol = req.protocol || 'http';

    // Formatted WhatsApp message for direct messaging
    let waText = `Hello ${pharmacyName || 'Pharmacy'}! 🏥\n\n` +
      `I want to order medicines using my prescription / photo:\n` +
      `📋 *Order Ref:* #${orderId}\n` +
      `👤 *Patient:* ${cleanName}\n` +
      `📱 *Mobile:* ${cleanPhone}\n`;

    if (medRequested && medRequested !== 'Prescription / Medicine Inquiry') {
      waText += `💊 *Requested Item:* ${medRequested}\n`;
    }
    if (notesText) {
      waText += `📝 *Notes:* ${notesText}\n`;
    }

    if (savedUrls.length === 1) {
      waText += `📷 *Prescription Photo:* ${protocol}://${host}${savedUrls[0]}\n`;
    } else if (savedUrls.length > 1) {
      waText += `📷 *Prescription Photos (${savedUrls.length}):*\n`;
      savedUrls.forEach((u, idx) => {
        waText += `Page ${idx + 1}: ${protocol}://${host}${u}\n`;
      });
    }

    waText += `\nPlease check counter availability and send me the price estimate and UPI payment QR code!`;

    const waUrl = targetPhone
      ? `https://wa.me/${targetPhone}?text=${encodeURIComponent(waText)}`
      : `https://wa.me/?text=${encodeURIComponent(waText)}`;

    // Broadcast update so pharmacy counter staff sees it live in Website Orders & Header
    broadcastOrdersChanged();

    res.status(201).json({
      success: true,
      message: 'Prescription request submitted successfully',
      order_id: orderId,
      prescription_url: prescriptionUrl,
      prescription_urls: savedUrls,
      whatsapp_url: waUrl,
      pharmacy_phone: targetPhone,
      pharmacy_name: pharmacyName || 'Pharmacy Counter'
    });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Prescription request error:', err);
    res.status(500).json({ error: 'Failed to submit prescription request: ' + (err.message || 'Unknown error') });
  }
});

export default router;
