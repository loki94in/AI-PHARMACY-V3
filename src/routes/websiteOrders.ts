import express from 'express';
import { dbManager } from '../database/connection.js';
import { medicineAvailabilityEngine } from '../services/medicineAvailabilityEngine.js';
import { returnWindowService } from '../services/returnWindowService.js';
import { eventService } from '../services/eventService.js';
import { formatCustomerName } from '../utils/nameFormatter.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';
import { getStoreMedicalNameAndPhone } from '../services/storeSettingsService.js';

const router = express.Router();

const broadcastOrdersChanged = () => {
  try {
    eventService.broadcast('order_updated', { at: Date.now(), source: 'website' });
  } catch (_) {}
};

// GET /api/website/medicines/search — Customer-facing safe medicine search
// Shows only customer-safe product info & Available / Sold Out status.
// NEVER leaks distributor names, rates, or internal mappings.
router.get('/medicines/search', async (req, res) => {
  try {
    const query = ((req.query.query as string) || '').trim();
    const storeId = parseInt((req.query.store_id as string) || '1', 10) || 1;
    const limit = Math.min(parseInt((req.query.limit as string) || '20', 10) || 20, 50);

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const db = await dbManager.getConnection();

    // 1. Search local master catalog
    let medicines = await db.all(
      `SELECT id, name, generic_name, strength, packaging, manufacturer, category, mrp, sell_price
       FROM medicines
       WHERE name LIKE ?
       ORDER BY name ASC
       LIMIT ?`,
      [`${query}%`, limit]
    ).catch(() => []);

    if (medicines.length === 0 && query.length >= 2) {
      medicines = await db.all(
        `SELECT id, name, generic_name, strength, packaging, manufacturer, category, mrp, sell_price
         FROM medicines
         WHERE name LIKE ?
         ORDER BY name ASC
         LIMIT ?`,
        [`%${query}%`, limit]
      ).catch(() => []);
    }

    // 2. Compute store-specific availability for each medicine
    const safeResults = [];

    for (const med of medicines) {
      // Check store local stock
      const stockRow = await db.get(
        `SELECT SUM(quantity) as total_qty 
         FROM inventory_master 
         WHERE medicine_id = ? AND store_id = ? AND is_active = 1 AND (expiry_date IS NULL OR date(expiry_date) > date('now'))`,
        [med.id, storeId]
      ).catch(() => ({ total_qty: 0 }));

      const localStock = stockRow?.total_qty || 0;

      // Check mapped distributor catalog availability for this store (offline cache)
      const distRow = await db.get(
        `SELECT availability 
         FROM distributor_catalog 
         WHERE product_name LIKE ? AND is_mapped = 1
         LIMIT 1`,
        [`%${med.name}%`]
      ).catch(() => null);

      const hasDistributorStock = distRow && String(distRow.availability || '').toLowerCase().includes('avail');
      const isAvailable = localStock > 0 || Boolean(hasDistributorStock);

      safeResults.push({
        id: med.id,
        name: med.name,
        generic_name: med.generic_name || '',
        strength: med.strength || '',
        packaging: med.packaging || '',
        manufacturer: med.manufacturer || '',
        category: med.category || '',
        mrp: med.mrp || 0,
        price: med.sell_price || med.mrp || 0,
        is_available: isAvailable,
        availability_status: isAvailable ? 'Available' : 'Sold Out'
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

// POST /api/website/orders — Customer creates online order
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
    payment_method = 'COD'
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

    // Ensure customer exists in customers table
    let customerId = null;
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
          customerId = custRes.lastID;
        }
      } catch (_) {}
    }

    const createdOrders: Array<{ id: number; product: string; qty: number }> = [];

    await db.run('BEGIN TRANSACTION');
    try {
      for (const item of items) {
        const prodName = (item.product || item.product_name || item.name || '').trim();
        if (!prodName) continue;
        const qty = Number(item.qty) || 1;
        const price = Number(item.price || item.mrp || 0);

        const result = await db.run(
          `INSERT INTO special_orders (
            store_id, customer_id, product, requester, phone, qty, priority, status, date, notified,
            advance_payment, notes, customer_order_source, prescription_url, product_image_url,
            delivery_status, return_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'Normal', 'Pending', ?, 0, 0, ?, 'website', ?, ?, 'pending', 'none', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
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
            product_image_url || null
          ]
        );

        const orderId = Number(result.lastID);
        createdOrders.push({ id: orderId, product: prodName, qty });

        // Record order tracking creation event
        await db.run(
          `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
           VALUES (?, 'website_order_created', ?, 'customer', CURRENT_TIMESTAMP)`,
          [orderId, `Order placed online via website for Store #${targetStoreId}. Items: ${prodName} (Qty: ${qty})`]
        );
      }

      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    // Send WhatsApp Order Confirmation if phone is valid
    if (cleanPhone && cleanPhone.length >= 10) {
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const medicalName = await getStoreMedicalNameAndPhone(db);
      const itemsSummary = createdOrders.map((o, idx) => `${idx + 1}. ${o.product} (x${o.qty})`).join('\n');
      const orderIdsStr = createdOrders.map(o => `#${o.id}`).join(', ');

      const confirmMsg = `Hello ${cleanName}, thank you for your order (${orderIdsStr}) at ${medicalName}!\n\nOrder Items:\n${itemsSummary}\n\nWe are preparing your order and will notify you upon dispatch.`;

      try {
        await whatsappQueueWorker.enqueue(formattedPhone, confirmMsg, 'website_order_confirmation', cleanName);
      } catch (waErr) {
        console.warn('[WebsiteOrdersRoute] WhatsApp confirmation warning:', waErr);
      }
    }

    broadcastOrdersChanged();

    res.status(201).json({
      success: true,
      message: 'Website order placed successfully',
      store_id: targetStoreId,
      orders: createdOrders,
      customer: { name: cleanName, phone: cleanPhone }
    });
  } catch (err: any) {
    console.error('[WebsiteOrdersRoute] Order placement error:', err);
    res.status(500).json({ error: 'Failed to place order: ' + (err.message || 'Unknown error') });
  }
});

// GET /api/website/orders/:orderId/track — Customer track order and 14-day return window status
router.get('/orders/:orderId/track', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

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

// POST /api/website/orders/:orderId/return-request — Customer request return within 14-day window
router.post('/orders/:orderId/return-request', async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId, 10);
    const { reason = 'Customer return request' } = req.body;

    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Invalid order ID' });
    }

    const db = await dbManager.getConnection();
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const returnInfo = returnWindowService.evaluateOrderReturnStatus(order);

    if (!returnInfo.isEligible) {
      return res.status(400).json({
        error: '14-day return window has expired for this order. Returns are no longer accepted.',
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

export default router;
