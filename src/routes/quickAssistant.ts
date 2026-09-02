import express from 'express';
import { dbManager } from '../database/connection.js';
import { resolveStoreId } from '../services/storeContextService.js';

const router = express.Router();

// GET /api/quick-assistant — Aggregates all special order operations for Quick Assistant panel
router.get('/', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const storeId = resolveStoreId(req);
    const allStores = req.query.all_stores === 'true';

    const storeClause = allStores ? '1=1' : 's.store_id = ?';
    const storeParams = allStores ? [] : [storeId];

    const [todayOrders, overlapsPending, readyToNotify, overdue, websiteOrders, returnRequests] = await Promise.all([
      db.all(
        `SELECT s.* FROM special_orders s
         WHERE (date(s.date) = date('now') OR date(s.created_at) = date('now'))
           AND ${storeClause}
         ORDER BY s.id DESC`,
        storeParams
      ).catch(() => []),

      db.all(
        `SELECT o.*, s.product, s.requester, s.phone, s.store_id
         FROM order_overlaps o
         JOIN special_orders s ON o.special_order_id = s.id
         WHERE o.overlap_status = 'detected'
           AND ${storeClause}
         ORDER BY o.id DESC`,
        storeParams
      ).catch(() => []),

      db.all(
        `SELECT s.* FROM special_orders s
         WHERE s.status IN ('ARRIVED', 'Ready', 'POTENTIAL_ARRIVAL') AND s.notified = 0
           AND ${storeClause}
         ORDER BY s.id DESC`,
        storeParams
      ).catch(() => []),

      db.all(
        `SELECT s.* FROM special_orders s
         WHERE s.status IN ('CREATED', 'PENDING', 'Pending', 'IN_TRANSIT')
           AND datetime(COALESCE(s.date, s.created_at)) <= datetime('now', '-2 days')
           AND ${storeClause}
         ORDER BY s.id DESC`,
        storeParams
      ).catch(() => []),

      db.all(
        `SELECT s.* FROM special_orders s
         WHERE s.customer_order_source = 'website'
           AND s.status NOT IN ('Fulfilled', 'FULFILLED', 'Cancelled')
           AND ${storeClause}
         ORDER BY s.id DESC`,
        storeParams
      ).catch(() => []),

      db.all(
        `SELECT s.* FROM special_orders s
         WHERE (s.return_status IN ('eligible', 'override_approved') OR s.delivery_status = 'delivered')
           AND ${storeClause}
         ORDER BY s.id DESC`,
        storeParams
      ).catch(() => []),
    ]);

    const activeOrders = await db.get(
      `SELECT COUNT(*) as count FROM special_orders s 
       WHERE s.status NOT IN ('Fulfilled', 'FULFILLED', 'Cancelled')
         AND ${storeClause}`,
      storeParams
    ).catch(() => ({ count: 0 }));

    res.json({
      store_id: allStores ? 'all' : storeId,
      today_orders: todayOrders,
      overlaps_pending: overlapsPending,
      ready_to_notify: readyToNotify,
      overdue,
      website_orders: websiteOrders,
      website_orders_count: websiteOrders.length,
      returns_pending: returnRequests,
      returns_pending_count: returnRequests.length,
      total_active: activeOrders?.count || 0,
      overlaps_count: overlapsPending.length
    });
  } catch (err: any) {
    console.error('[QuickAssistantRoute] Error fetching quick assistant summary:', err);
    res.status(500).json({ error: 'Failed to fetch quick assistant summary' });
  }
});

export default router;
