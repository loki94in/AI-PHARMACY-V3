import { dbManager } from '../database/connection.js';
import { addItemsToPharmarackCart } from '../routes/pharmarack.js';
import { eventService } from './eventService.js';
import { activityTracker } from '../utils/activityTracker.js';

const CLOUD_SERVER_URL = process.env.CLOUD_CATALOG_URL || process.env.LICENSE_SERVER_URL || 'https://website-woad-seven-26.vercel.app';

export interface QueuedCartItem {
  req_id: string;
  medicine_name: string;
  qty: number;
  store_id?: number | string;
  store_name?: string;
  product_code?: string;
  product_id?: number | string;
  notes?: string;
  source?: string;
  is_refill?: boolean;
  created_at?: string;
}

export interface DrainResult {
  success: boolean;
  count: number;
  processed: number;
  failed: number;
  message?: string;
  reason?: string;
}

async function getAdminSecret(): Promise<string> {
  if (process.env.ADMIN_SECRET && process.env.ADMIN_SECRET.trim() !== '') {
    return process.env.ADMIN_SECRET.trim();
  }
  try {
    const db = await dbManager.getConnection();
    const row = await db.get(
      "SELECT value FROM app_settings WHERE key = 'cloud_admin_secret' OR key = 'admin_secret'"
    );
    if (row?.value && row.value.trim() !== '') {
      return row.value.trim();
    }
  } catch (_) {}
  return '';
}

class CartQueueSyncService {
  private static instance: CartQueueSyncService;
  private isDraining = false;

  private constructor() {}

  public static getInstance(): CartQueueSyncService {
    if (!CartQueueSyncService.instance) {
      CartQueueSyncService.instance = new CartQueueSyncService();
    }
    return CartQueueSyncService.instance;
  }

  /**
   * Pulls pending online live-cart requests and drains them into the shop's Pharmarack cart.
   * Enforces single-flight concurrency, batch bounding (<=10), idempotency via cloud_exec_ledger,
   * and the unified same-medicine merge rule.
   */
  public async drainCartAddQueue(): Promise<DrainResult> {
    if (this.isDraining) {
      return { success: true, count: 0, processed: 0, failed: 0, message: 'Drain already in flight' };
    }

    const secret = await getAdminSecret();
    if (!secret) {
      return { success: false, count: 0, processed: 0, failed: 0, reason: 'NO_SECRET', message: 'Cloud ADMIN_SECRET not configured' };
    }

    const db = await dbManager.getConnection();
    const queueMode = await db.get("SELECT value FROM app_settings WHERE key = 'cloud_cart_queue_mode'");
    if (queueMode && queueMode.value === 'off') {
      return { success: true, count: 0, processed: 0, failed: 0, reason: 'DISABLED', message: 'Cart queue drain disabled in settings' };
    }

    this.isDraining = true;
    try {
      const res = await fetch(`${CLOUD_SERVER_URL}/api/catalog?action=cart_queue_get`, {
        method: 'GET',
        headers: {
          'x-admin-secret': secret,
        },
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        return { success: false, count: 0, processed: 0, failed: 0, message: `Cloud queue fetch failed: ${res.status} ${errorText}` };
      }

      const data: any = await res.json().catch(() => ({}));
      const items: QueuedCartItem[] = Array.isArray(data.items) ? data.items : [];

      if (items.length === 0) {
        return { success: true, count: 0, processed: 0, failed: 0, message: 'Zero queued items in online cart' };
      }

      // Bound batch to maximum 10 items per cycle to prevent event-loop hogging
      const batch = items.slice(0, 10);
      const successfulReqIds: string[] = [];
      let failedCount = 0;

      for (const item of batch) {
        const reqId = String(item.req_id || '').trim();
        if (!reqId) continue;

        // Idempotency check via cloud_exec_ledger
        const existing = await db.get(
          'SELECT id, processed_at, attempts FROM cloud_exec_ledger WHERE id = ?',
          [reqId]
        );

        if (existing && existing.processed_at) {
          // Already successfully executed, queue for ack
          successfulReqIds.push(reqId);
          continue;
        }

        if (!existing) {
          await db.run(
            `INSERT OR IGNORE INTO cloud_exec_ledger (id, kind, payload_json, received_at, attempts)
             VALUES (?, 'cart_queue_add', ?, datetime('now'), 0)`,
            [reqId, JSON.stringify(item)]
          );
        }

        // Resolve distributor link if missing from queued item
        let storeId = Number(item.store_id || 0);
        let storeName = item.store_name || '';
        let productCode = item.product_code || '';
        let productId = Number(item.product_id || 0);
        let ptr = 0;
        let productName = (item.medicine_name || '').trim();

        if (!productCode || !storeId) {
          const link = await db.get(
            `SELECT mdl.store_id, mdl.store_name, mdl.product_code, mdl.product_id, mdl.product_name, mdl.ptr
             FROM medicine_distributor_links mdl
             JOIN medicines m ON m.id = mdl.medicine_id
             WHERE LOWER(m.name) = LOWER(?) OR LOWER(mdl.product_name) = LOWER(?)
             LIMIT 1`,
            [productName, productName]
          );

          if (link) {
            storeId = Number(link.store_id || 0);
            storeName = link.store_name || '';
            productCode = link.product_code || '';
            productId = Number(link.product_id || 0);
            ptr = Number(link.ptr || 0);
            if (link.product_name) productName = link.product_name;
          }
        }

        // Add to Pharmarack live cart
        const cartPayload = [{
          storeId,
          storeName,
          productCode,
          productId,
          productName,
          qty: Math.max(1, Math.min(99, Number(item.qty || 1))),
          rate: ptr,
          isUpdate: false,
        }];

        const addResult = await addItemsToPharmarackCart(cartPayload);

        if (addResult.success) {
          successfulReqIds.push(reqId);
        } else {
          failedCount++;
          const errorMsg = addResult.error || addResult.reason || addResult.message || 'Cart add failed';
          await db.run(
            `UPDATE cloud_exec_ledger 
             SET attempts = attempts + 1, result_text = ? 
             WHERE id = ?`,
            [errorMsg, reqId]
          );
          console.warn(`[CartQueueSync] Item ${reqId} (${productName}) failed: ${errorMsg}`);
        }
      }

      // Acknowledge successfully executed items to cloud
      if (successfulReqIds.length > 0) {
        try {
          const ackRes = await fetch(`${CLOUD_SERVER_URL}/api/catalog?action=cart_queue_ack`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-secret': secret,
            },
            body: JSON.stringify({ reqIds: successfulReqIds }),
          });

          if (ackRes.ok) {
            // Mark items processed in local ledger only AFTER cloud acknowledges
            for (const id of successfulReqIds) {
              await db.run(
                `UPDATE cloud_exec_ledger 
                 SET processed_at = datetime('now'), result_text = 'success' 
                 WHERE id = ?`,
                [id]
              );
            }

            eventService.broadcast('cart_queue_processed', {
              count: successfulReqIds.length,
              reqIds: successfulReqIds,
            });
            eventService.broadcast('cart_queue_changed', {});
            eventService.broadcast('toast_alert', {
              type: 'success',
              message: `🛒 ${successfulReqIds.length} item(s) from online queue added to Live Cart!`,
              link: '/live-cart',
            });
          } else {
            console.warn('[CartQueueSync] Cloud ACK returned non-200, items retained in ledger for next round.');
          }
        } catch (ackErr: any) {
          console.warn('[CartQueueSync] Cloud ACK network error:', ackErr.message);
        }
      }

      return {
        success: true,
        count: batch.length,
        processed: successfulReqIds.length,
        failed: failedCount,
        message: `Processed ${successfulReqIds.length}/${batch.length} queued online cart items.`,
      };
    } catch (err: any) {
      console.error('[CartQueueSync] Drain error:', err);
      return { success: false, count: 0, processed: 0, failed: 0, message: err.message };
    } finally {
      this.isDraining = false;
    }
  }
}

export const cartQueueSyncService = CartQueueSyncService.getInstance();
