import { dbManager } from '../database/connection.js';
import { orderScheduleService } from './orderScheduleService.js';
import { eventService } from './eventService.js';
import { normalizeWhatsAppPhone } from '../whatsappClient.js';

export interface ReconcilerOrderItem {
  medicine_name: string;
  qty?: number;
  unit?: string;
  price?: number;
  rate?: number;
  mrp?: number;
  distributor?: string;
}

export interface UpsertRefillOrderParams {
  phone: string;
  customer_id?: number | null;
  customer_name?: string | null;
  items: ReconcilerOrderItem[];
  source?: 'refill' | 'whatsapp' | 'whatsapp_refill_confirm' | 'website' | 'manual';
  source_refill_id?: number | null;
  store_id?: number;
  notes?: string;
  priority?: 'High' | 'Normal' | 'Low';
  advance_payment?: number;
  status?: string;
  dbInstance?: any;
}

export interface ReconciledOrderResult {
  id: number;
  product: string;
  qty: number;
  isExisting: boolean;
  status: string;
}

export class RefillOrderReconciler {
  /**
   * Canonical join for order creation from refills, WhatsApp bot, and website.
   * Deduplicates active pending orders per customer+medicine within 15 minutes,
   * binds full delivery schedule, and maintains a single unified special_orders pipeline.
   */
  async upsertForPhone(params: UpsertRefillOrderParams): Promise<{
    success: boolean;
    orders: ReconciledOrderResult[];
    customerId?: number | null;
  }> {
    const db = params.dbInstance || (await dbManager.getConnection());
    const rawPhone = params.phone || '';
    const cleanDigits = normalizeWhatsAppPhone(rawPhone);
    const last10 = cleanDigits.slice(-10);
    const targetStoreId = params.store_id || 1;
    const source = params.source || 'refill';
    const priority = params.priority || (source === 'refill' ? 'High' : 'Normal');
    const initialStatus = params.status || 'Pending';

    // 1. Resolve Customer Record
    let customerId = params.customer_id || null;
    let customerName = (params.customer_name || '').trim();

    if (customerId) {
      const existing = await db.get('SELECT id, name FROM customers WHERE id = ?', [customerId]).catch(() => null);
      if (existing) {
        if (!customerName) customerName = existing.name;
      } else {
        customerId = null;
      }
    }

    if (!customerId && last10.length >= 10) {
      const existingByPhone = await db.get(
        'SELECT id, name FROM customers WHERE phone LIKE ? OR phone LIKE ? LIMIT 1',
        [`%${last10}`, `%${cleanDigits}%`]
      ).catch(() => null);

      if (existingByPhone) {
        customerId = existingByPhone.id;
        if (!customerName) customerName = existingByPhone.name;
      } else if (customerName) {
        try {
          const insCust = await db.run(
            'INSERT INTO customers (name, phone, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [customerName, cleanDigits]
          );
          customerId = insCust.lastID;
        } catch (_) {}
      }
    }

    if (!customerName) {
      customerName = 'Customer';
    }

    // 2. Pre-calculate Fulfillment Schedule
    const calculatedSchedule = await orderScheduleService.calculateOrderSchedule(new Date(), targetStoreId);
    const todayStr = new Date().toISOString();
    const reconciledOrders: ReconciledOrderResult[] = [];

    for (const item of params.items) {
      const prodName = (item.medicine_name || '').trim();
      if (!prodName) continue;

      const orderQty = Math.max(1, Number(item.qty) || 1);

      // 3. Deduplication Check: Look for existing active orders in last 15 mins or in Pending/Ordered/Confirmed/Ready
      const existingOrder = await db.get(
        `SELECT id, status, qty FROM special_orders 
         WHERE (phone LIKE ? OR phone LIKE ?) 
           AND LOWER(TRIM(product)) = LOWER(?) 
           AND (
             status IN ('Pending', 'Ordered', 'Confirmed', 'Ready')
             OR created_at > datetime('now', '-15 minutes')
           )
         ORDER BY id DESC LIMIT 1`,
        [`%${last10}`, `%${cleanDigits}%`, prodName]
      );

      if (existingOrder) {
        console.log(`[RefillOrderReconciler] Found existing active special order #${existingOrder.id} for ${prodName} (${cleanDigits}). Idempotent reuse.`);
        reconciledOrders.push({
          id: existingOrder.id,
          product: prodName,
          qty: existingOrder.qty,
          isExisting: true,
          status: existingOrder.status
        });

        if (params.source_refill_id) {
          try {
            await db.run(
              `UPDATE patient_refills SET ordering_triggered = 1, hold_for_stock = 1 WHERE id = ?`,
              [params.source_refill_id]
            );
          } catch (_) {}
        }
        continue;
      }

      // 4. Insert New Order into special_orders
      const res = await db.run(
        `INSERT INTO special_orders (
          store_id, product, requester, phone, customer_id, qty, priority, status, date, notified,
          source, source_refill_id, customer_order_source,
          pharmarack_distributor, pharmarack_rate, pharmarack_mrp, pharmarack_mapped, advance_payment,
          notes, notification_count,
          scheduled_processing_at, estimated_delivery_start, estimated_delivery_end,
          cutoff_at, pharmacy_timezone, schedule_status, schedule_reason, schedule_version,
          schedule_calculated_at, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, 0,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        [
          targetStoreId,
          prodName,
          customerName,
          cleanDigits,
          customerId,
          orderQty,
          priority,
          initialStatus,
          todayStr,
          source,
          params.source_refill_id || null,
          source === 'refill' ? 'refill' : (source === 'website' ? 'website' : 'whatsapp'),
          item.distributor || null,
          item.rate !== undefined ? item.rate : null,
          item.mrp !== undefined ? item.mrp : null,
          item.distributor ? 1 : 0,
          params.advance_payment || 0.0,
          params.notes || null,
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

      const newOrderId = res.lastID;
      console.log(`[RefillOrderReconciler] Created special order #${newOrderId} for ${prodName} x${orderQty} (Source: ${source}).`);

      reconciledOrders.push({
        id: newOrderId,
        product: prodName,
        qty: orderQty,
        isExisting: false,
        status: initialStatus
      });

      if (params.source_refill_id) {
        try {
          await db.run(
            `UPDATE patient_refills SET ordering_triggered = 1, hold_for_stock = 1 WHERE id = ?`,
            [params.source_refill_id]
          );
        } catch (_) {}
      }

      // Broadcast order_updated event
      try {
        eventService.broadcast('order_updated', { at: Date.now(), id: newOrderId, source });
      } catch (_) {}
    }

    try {
      eventService.broadcast('refill_updated', { at: Date.now(), source });
    } catch (_) {}

    return {
      success: true,
      orders: reconciledOrders,
      customerId
    };
  }
}

export const refillOrderReconciler = new RefillOrderReconciler();
