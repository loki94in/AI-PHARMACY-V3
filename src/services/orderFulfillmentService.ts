import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import { scoreOrderNameMatch, ARRIVAL_MATCH_THRESHOLD } from '../utils/orderNameMatcher.js';

export class OrderFulfillmentService {
  private static instance: OrderFulfillmentService;
  private intervalId: NodeJS.Timeout | null = null;
  private isCheckingRefills = false;

  private constructor() {}

  public static getInstance(): OrderFulfillmentService {
    if (!OrderFulfillmentService.instance) {
      OrderFulfillmentService.instance = new OrderFulfillmentService();
    }
    return OrderFulfillmentService.instance;
  }

  public async start() {
    if (this.intervalId) return;

    try {
      const db = await dbManager.getConnection();
      const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
      const refillRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_refills_enabled'");
      if (autoRow?.value === 'false' || refillRow?.value === 'false') {
        console.log('[OrderFulfillmentService] Refill scheduler disabled in Settings.');
        return;
      }

      // Read the user-configured refill check time (HH:MM, 24h). Default: 09:00.
      let checkHour = 9, checkMin = 0;
      try {
        const timeRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_refills_check_time'");
        if (timeRow?.value && timeRow.value.includes(':')) {
          const [h, m] = timeRow.value.split(':').map((s: string) => parseInt(s.trim(), 10));
          checkHour = isNaN(h) ? 9 : h;
          checkMin = isNaN(m) ? 0 : m;
        }
      } catch (_) {}

      console.log(`[OrderFulfillmentService] Starting background refill scheduler at ${String(checkHour).padStart(2, '0')}:${String(checkMin).padStart(2, '0')} daily...`);
    } catch (_) {}

    // Run initial evaluation on boot
    this.checkRefillsAndGenerateOrders();

    // Schedule daily cron at the configured time.  Falls back to a 1-hour safety net
    // in case the cron import is unavailable (defensive for unusual environments).
    try {
      const cron = await import('node-cron');
      const db = await dbManager.getConnection();
      let checkHour = 9, checkMin = 0;
      try {
        const timeRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_refills_check_time'");
        if (timeRow?.value && timeRow.value.includes(':')) {
          const [h, m] = timeRow.value.split(':').map((s: string) => parseInt(s.trim(), 10));
          checkHour = isNaN(h) ? 9 : h;
          checkMin = isNaN(m) ? 0 : m;
        }
      } catch (_) {}

      const cronExpr = `${checkMin} ${checkHour} * * *`;
      const task = cron.default.schedule(cronExpr, async () => {
        try {
          const { activityTracker } = await import('../utils/activityTracker.js');
          if (activityTracker.isIdle()) return; // P3 gated
        } catch (_) {}
        this.checkRefillsAndGenerateOrders();
      });

      // Store the cron task so stop() can cancel it
      (this as any)._cronTask = task;
      console.log(`[OrderFulfillmentService] Refill evaluator scheduled daily at cron: ${cronExpr}`);
    } catch (cronErr) {
      // Fallback to hourly interval if cron import fails
      console.warn('[OrderFulfillmentService] node-cron unavailable, falling back to hourly interval:', cronErr);
      this.intervalId = setInterval(async () => {
        try {
          const { activityTracker } = await import('../utils/activityTracker.js');
          if (activityTracker.isIdle()) return;
        } catch (_) {}
        this.checkRefillsAndGenerateOrders();
      }, 60 * 60 * 1000);
    }
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if ((this as any)._cronTask) {
      try { (this as any)._cronTask.stop(); } catch (_) {}
      (this as any)._cronTask = null;
    }
  }

  /**
   * Reconcile special orders against newly arrived inventory (from a purchase bill or stock addition).
   * CONTRACT: The app NEVER automatically sends messages to patients upon medicine arrival.
   * Special orders are updated to 'Ready' (in stock) with notified = 0.
   * The user manually clicks the 'Send Arrival WA' button in the UI to notify the customer.
   * Matching is scoped strictly to ACTIVE in-app order statuses ('Pending'/'Ordered') and uses
   * the shared scorer (exact fast-path + High-tier fuzzy >= ARRIVAL_MATCH_THRESHOLD).
   */
  public async reconcileIncomingInventory(db: Database, medicineName: string) {
    if (!medicineName) return;
    
    console.log(`[OrderFulfillmentService] Reconciling incoming inventory for: "${medicineName}"`);
    
    // Find active special orders taken through the app; old/fulfilled/cancelled orders never match
    const pendingOrders = await db.all(
      `SELECT * FROM special_orders 
       WHERE status = 'Pending' OR status = 'Ordered'`
    );

    for (const order of pendingOrders) {
      const match = scoreOrderNameMatch(medicineName.trim(), order.product || order.medicine_name);
      if (match.score < ARRIVAL_MATCH_THRESHOLD) continue;

      // Update special order to 'Ready' (in stock) and keep notified = 0 for manual user trigger
      await db.run(
        `UPDATE special_orders SET status = 'Ready', notified = 0 WHERE id = ?`,
        [order.id]
      );
      console.log(`[OrderFulfillmentService] Special order ID ${order.id} marked as Ready (${match.matchType}, confidence ${(match.confidence * 100).toFixed(0)}%; manual patient notification required via UI).`);
    }
  }

  /**
   * Convert a completed special order into a recurring patient refill rule
   */
  public async convertToRecurringRefill(
    orderId: number,
    refillIntervalDays: number
  ): Promise<{ success: boolean; message: string; refillId?: number }> {
    const db = await dbManager.getConnection();
    
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) {
      return { success: false, message: 'Special order not found' };
    }

    // Try to find the medicine in inventory or medicines table to map the ID
    const medRow = await db.get(
      `SELECT id FROM medicines WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      [order.product.trim()]
    );

    let medicineId = medRow ? medRow.id : null;

    if (!medicineId) {
      // If medicine doesn't exist, create a shell record in medicines table
      const res = await db.run(
        `INSERT INTO medicines (name) VALUES (?)`,
        [order.product.trim()]
      );
      medicineId = res.lastID;
    }

    // Insert or update refill rule
    // We map to patient_refills table
    const nextRefillDate = new Date();
    nextRefillDate.setDate(nextRefillDate.getDate() + refillIntervalDays);
    const nextRefillStr = nextRefillDate.toISOString().replace('T', ' ').substring(0, 19);

    const result = await db.run(
      `INSERT INTO patient_refills (
        patient_name, patient_phone, medicine_id, refill_interval_days,
        last_refill_date, next_refill_date, status, is_active, is_ready, hold_for_stock
      ) VALUES (?, ?, ?, ?, datetime('now'), ?, 'pending', 1, 0, 0)`,
      [
        order.requester,
        order.phone,
        medicineId,
        refillIntervalDays,
        nextRefillStr
      ]
    );

    // Update the special order with converted_to_refill_id (safely check if column exists first or alter it)
    try {
      await db.run('ALTER TABLE special_orders ADD COLUMN converted_to_refill_id INTEGER DEFAULT NULL');
    } catch (_) {}

    await db.run(
      `UPDATE special_orders SET converted_to_refill_id = ? WHERE id = ?`,
      [result.lastID, orderId]
    );

    return { 
      success: true, 
      message: `Successfully converted special order to recurring refill every ${refillIntervalDays} days.`,
      refillId: result.lastID 
    };
  }

  /**
   * Periodically check patient_refills due soon. 
   * If medicine is out-of-stock, automatically create a high-priority special order.
   */
  public async checkRefillsAndGenerateOrders() {
    if (this.isCheckingRefills) return;
    this.isCheckingRefills = true;

    try {
      const db = await dbManager.getConnection();
      // Import dynamically to avoid circular dependencies
      const { checkAllRefills } = await import('./refillService.js');
      await checkAllRefills(db);
    } catch (err: any) {
      console.error('[OrderFulfillmentService] Error in background refill check:', err.message);
    } finally {
      this.isCheckingRefills = false;
    }
  }
}

export const orderFulfillmentService = OrderFulfillmentService.getInstance();
