import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';

export const DEFAULT_RETURN_WINDOW_DAYS = 15;
export const RETURN_WINDOW_DAYS = 15;
export const RETURN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface ReturnStatusInfo {
  orderId: number;
  deliveryStatus: string;
  deliveredAt: string | null;
  returnWindowUntil: string | null;
  returnStatus: 'none' | 'eligible' | 'expired' | 'returned' | 'override_approved';
  daysRemaining: number;
  isEligible: boolean;
  overrideReason?: string | null;
  overrideBy?: string | null;
  overrideAt?: string | null;
}

export class ReturnWindowService {
  /**
   * Fetches the configured return window duration from app_settings (default 15 days).
   */
  async getConfiguredReturnWindowDays(storeIdOrDb?: any, customDb?: any): Promise<number> {
    try {
      let db: any;
      if (customDb) {
        db = customDb;
      } else if (storeIdOrDb && typeof storeIdOrDb.get === 'function') {
        db = storeIdOrDb;
      } else {
        db = await dbManager.getConnection();
      }
      const row = await db.get("SELECT value FROM app_settings WHERE key = 'return_window_days'");
      if (row && row.value) {
        const val = parseInt(row.value, 10);
        if (!isNaN(val) && val > 0) return val;
      }
    } catch (_) {}
    return DEFAULT_RETURN_WINDOW_DAYS;
  }

  /**
   * Calculates the return window deadline given a delivered timestamp and optional days
   */
  calculateReturnWindowUntil(deliveredAt: string | Date, windowDays?: number): string {
    const deliveredDate = new Date(deliveredAt);
    const days = windowDays !== undefined && windowDays > 0 ? windowDays : DEFAULT_RETURN_WINDOW_DAYS;
    const deadlineMs = deliveredDate.getTime() + (days * 24 * 60 * 60 * 1000);
    return new Date(deadlineMs).toISOString();
  }

  /**
   * Evaluates the return window status for an order
   */
  evaluateOrderReturnStatus(order: any): ReturnStatusInfo {
    const orderId = order.id;
    const deliveryStatus = order.delivery_status || (order.status === 'Delivered' ? 'delivered' : 'pending');
    const deliveredAt = order.delivered_at || null;
    const overrideBy = order.return_override_by || null;
    const overrideReason = order.return_override_reason || null;
    const overrideAt = order.return_override_at || null;

    if (overrideBy) {
      return {
        orderId,
        deliveryStatus,
        deliveredAt,
        returnWindowUntil: order.return_window_until || null,
        returnStatus: 'override_approved',
        daysRemaining: 0,
        isEligible: true,
        overrideReason,
        overrideBy,
        overrideAt
      };
    }

    if (order.return_status === 'returned') {
      return {
        orderId,
        deliveryStatus,
        deliveredAt,
        returnWindowUntil: order.return_window_until || null,
        returnStatus: 'returned',
        daysRemaining: 0,
        isEligible: false
      };
    }

    if (deliveryStatus !== 'delivered' || !deliveredAt) {
      return {
        orderId,
        deliveryStatus,
        deliveredAt: null,
        returnWindowUntil: null,
        returnStatus: 'none',
        daysRemaining: 0,
        isEligible: false
      };
    }

    const windowUntil = order.return_window_until || this.calculateReturnWindowUntil(deliveredAt);
    const deadline = new Date(windowUntil).getTime();
    const now = Date.now();
    const msRemaining = deadline - now;
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
    const isEligible = msRemaining > 0;
    const returnStatus = isEligible ? 'eligible' : 'expired';

    return {
      orderId,
      deliveryStatus: 'delivered',
      deliveredAt,
      returnWindowUntil: windowUntil,
      returnStatus,
      daysRemaining,
      isEligible
    };
  }

  /**
   * Marks an order as delivered, stamping delivered_at and calculating the 14-day return window
   */
  async markDelivered(orderId: number, deliveredAtDate?: Date, dbInstance?: any): Promise<ReturnStatusInfo> {
    const db = dbInstance || (await dbManager.getConnection());
    const deliveredAt = (deliveredAtDate || new Date()).toISOString();
    const windowDays = await this.getConfiguredReturnWindowDays(db);
    const returnWindowUntil = this.calculateReturnWindowUntil(deliveredAt, windowDays);

    await db.run(
      `UPDATE special_orders
       SET delivery_status = 'delivered',
           status = 'Delivered',
           delivered_at = ?,
           return_window_until = ?,
           return_status = 'eligible',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [deliveredAt, returnWindowUntil, orderId]
    );

    await db.run(
      `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
       VALUES (?, 'delivered', ?, 'system', CURRENT_TIMESTAMP)`,
      [orderId, `Order delivered. ${windowDays}-day return window open until ${returnWindowUntil}`]
    );

    try {
      eventService.broadcast('order_updated', { at: Date.now(), orderId, action: 'delivered' });
    } catch (_) {}

    const updatedOrder = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    return this.evaluateOrderReturnStatus(updatedOrder);
  }

  /**
   * Background scan: automatically closes expired 14-day return windows without deleting records
   */
  async checkAndCloseExpiredReturnWindows(dbInstance?: any): Promise<number> {
    const db = dbInstance || (await dbManager.getConnection());
    const nowIso = new Date().toISOString();

    const expiredOrders = await db.all(
      `SELECT id, delivered_at, return_window_until 
       FROM special_orders
       WHERE delivery_status = 'delivered'
         AND return_status = 'eligible'
         AND return_window_until IS NOT NULL
         AND return_window_until <= ?
         AND return_override_by IS NULL`,
      [nowIso]
    ).catch(() => []);

    if (expiredOrders.length === 0) return 0;

    for (const order of expiredOrders) {
      await db.run(
        `UPDATE special_orders
         SET return_status = 'expired',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [order.id]
      );

      await db.run(
        `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
         VALUES (?, 'return_window_expired', '14-day return period ended. Return window closed automatically.', 'system', CURRENT_TIMESTAMP)`,
        [order.id]
      );
    }

    try {
      eventService.broadcast('order_updated', { at: Date.now(), expiredCount: expiredOrders.length });
    } catch (_) {}

    return expiredOrders.length;
  }

  /**
   * Human exception override: Pharmacist/Manager approves return after expiration
   */
  async applyReturnOverride(
    orderId: number,
    opts: { overrideBy: string; reason: string },
    dbInstance?: any
  ): Promise<ReturnStatusInfo> {
    const db = dbInstance || (await dbManager.getConnection());
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) {
      throw new Error(`Order #${orderId} not found`);
    }

    const overrideBy = (opts.overrideBy || 'Admin').trim();
    const reason = (opts.reason || 'Management approval').trim();
    const nowIso = new Date().toISOString();

    await db.run(
      `UPDATE special_orders
       SET return_status = 'override_approved',
           return_override_by = ?,
           return_override_reason = ?,
           return_override_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [overrideBy, reason, nowIso, orderId]
    );

    await db.run(
      `INSERT INTO action_logs (action_type, description, metadata, created_at)
       VALUES ('return_override', ?, ?, CURRENT_TIMESTAMP)`,
      [
        `Return window manually overridden for Order #${orderId} by ${overrideBy}`,
        JSON.stringify({ orderId, overrideBy, reason, previousStatus: order.return_status })
      ]
    );

    await db.run(
      `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
       VALUES (?, 'return_override', ?, ?, CURRENT_TIMESTAMP)`,
      [orderId, `Return window override granted by ${overrideBy}. Reason: ${reason}`, overrideBy]
    );

    try {
      eventService.broadcast('order_updated', { at: Date.now(), orderId, action: 'return_override' });
    } catch (_) {}

    const updated = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    return this.evaluateOrderReturnStatus(updated);
  }
}

export const returnWindowService = new ReturnWindowService();
