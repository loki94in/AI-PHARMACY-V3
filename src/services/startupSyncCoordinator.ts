/**
 * StartupSyncCoordinator
 *
 * Coordinates startup background scanning with Pharmarack live cart loading.
 * Ensures background scanning waits until the live Pharmarack cart is initialized
 * or until a safety timeout (15s) elapses, preventing false shortage alerts and
 * race conditions with medicines already in the cart.
 */

class StartupSyncCoordinator {
  private cartLoaded: boolean = false;
  private syncPending: boolean = true;
  private warmUpSettled: boolean = false;
  private lastError: string | null = null;
  private startupTime: number = Date.now();
  private maxTimeoutMs: number = 15000;
  private resolveCallbacks: Array<() => void> = [];
  private timeoutHandle: NodeJS.Timeout | null = null;

  constructor() {
    // Auto-release after safety timeout (15 seconds) so background scanning is never blocked forever
    this.timeoutHandle = setTimeout(() => {
      if (this.syncPending && !this.cartLoaded) {
        console.log('[StartupSyncCoordinator] 15s startup window elapsed. Releasing background scanners.');
        this.warmUpSettled = true;
        this.releaseWaiters();
      }
    }, this.maxTimeoutMs);
  }

  /**
   * Called when Pharmarack cart items are successfully loaded or synchronized.
   */
  public markCartLoaded(): void {
    if (!this.cartLoaded) {
      this.cartLoaded = true;
      this.syncPending = false;
      this.warmUpSettled = true;
      this.lastError = null;
      console.log(`[StartupSyncCoordinator] Pharmarack cart loaded successfully in ${Date.now() - this.startupTime}ms. Releasing scanners.`);
      this.releaseWaiters();

      // Trigger automatic sync of offline-queued orders
      void this.syncPendingLiveCartOrders().catch(err => {
        console.warn('[StartupSyncCoordinator] Offline live cart sync warning:', err?.message || err);
      });
    }
  }

  /**
   * Scans and syncs all orders that were queued while offline into the live cart.
   */
  public async syncPendingLiveCartOrders(): Promise<{ processed: number; synced: number }> {
    try {
      const { dbManager } = await import('../database/connection.js');
      const db = await dbManager.getConnection();

      const queuedOrders = await db.all(
        `SELECT * FROM special_orders 
         WHERE needs_live_cart_sync = 1 
           AND status NOT IN ('Cancelled', 'Delivered', 'Completed')
         ORDER BY id ASC LIMIT 50`
      );

      if (!queuedOrders || queuedOrders.length === 0) {
        return { processed: 0, synced: 0 };
      }

      console.log(`[StartupSyncCoordinator] Found ${queuedOrders.length} offline-queued order(s) needing Live Cart sync.`);
      const { addItemsToPharmarackCart } = await import('../routes/pharmarack.js');
      let syncedCount = 0;

      for (const ord of queuedOrders) {
        const prodName = ord.pharmarack_product_name || ord.medicine_name || ord.product;
        let storeId = ord.pharmarack_store_id ? Number(ord.pharmarack_store_id) : 0;
        let distName = ord.pharmarack_distributor || '';
        let prodId = ord.pharmarack_product_id ? Number(ord.pharmarack_product_id) : (ord.medicine_id ? Number(ord.medicine_id) : 0);
        let prodCode = ord.pharmarack_product_code ? String(ord.pharmarack_product_code) : '';
        let rate = Number(ord.pharmarack_rate) || 0;
        let mrp = Number(ord.pharmarack_mrp) || 0;

        if (!storeId) {
          const linkRow = await db.get(
            `SELECT store_id, distributor_name, product_id, product_code, rate, mrp 
             FROM medicine_distributor_links 
             WHERE LOWER(TRIM(medicine_name)) = LOWER(TRIM(?))
             ORDER BY is_preferred DESC LIMIT 1`,
            [prodName]
          ).catch(() => null);

          if (linkRow && linkRow.store_id) {
            storeId = Number(linkRow.store_id);
            distName = distName || linkRow.distributor_name || '';
            prodId = prodId || Number(linkRow.product_id) || 0;
            prodCode = prodCode || String(linkRow.product_code || '');
            rate = rate || Number(linkRow.rate) || 0;
            mrp = mrp || Number(linkRow.mrp) || 0;
          } else {
            const catRow = await db.get(
              `SELECT store_id, store_name, product_id, product_code, rate, mrp 
               FROM distributor_catalog 
               WHERE (LOWER(TRIM(product_name)) = LOWER(TRIM(?)) OR LOWER(product_name) LIKE LOWER(?)) 
                 AND store_id > 0
               ORDER BY rate ASC LIMIT 1`,
              [prodName, `%${prodName}%`]
            ).catch(() => null);

            if (catRow && catRow.store_id) {
              storeId = Number(catRow.store_id);
              distName = distName || catRow.store_name || '';
              prodId = prodId || Number(catRow.product_id) || 0;
              prodCode = prodCode || String(catRow.product_code || '');
              rate = rate || Number(catRow.rate) || 0;
              mrp = mrp || Number(catRow.mrp) || 0;
            }
          }
        }

        const cartRes = await addItemsToPharmarackCart([{
          productName: prodName,
          product: prodName,
          productId: prodId,
          productCode: prodCode,
          storeId,
          storeName: distName || 'Standard Distributor',
          qty: ord.qty > 0 ? ord.qty : 1,
          rate,
          mrp,
          packaging: '1 strip',
          mapped: storeId > 0
        }]).catch((err: any) => ({ success: false, error: err?.message || String(err), offline: false }));

        if (cartRes.success && !(cartRes as any).offline) {
          syncedCount++;
          await db.run(
            `UPDATE special_orders 
             SET needs_live_cart_sync = 0,
                 status = 'In Live Cart',
                 delivery_status = 'in_live_cart',
                 pharmacy_verification_status = 'IN_LIVE_CART',
                 pharmarack_distributor = ?,
                 pharmarack_store_id = ?,
                 pharmarack_product_id = ?,
                 pharmarack_product_code = ?,
                 pharmarack_rate = ?,
                 pharmarack_mrp = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [distName, storeId, prodId, prodCode, rate, mrp, ord.id]
          ).catch(() => {});

          await db.run(
            `INSERT OR REPLACE INTO online_order_items (
               order_id, product_name, product_name_snapshot, requested_qty, confirmed_qty, mrp, final_price, subtotal, item_status
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED')`,
            [ord.id, prodName, prodName, ord.qty || 1, ord.qty || 1, mrp, rate, (ord.qty || 1) * rate]
          ).catch(() => {});

          await db.run(
            `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by, performed_at)
             VALUES (?, 'offline_synced_to_live_cart', ?, 'system', CURRENT_TIMESTAMP)`,
            [ord.id, `Offline order successfully synced to Live Cart (${distName || 'Distributor'}).`]
          ).catch(() => {});

          // Notify customer via WhatsApp
          const cleanPhone = String(ord.phone || '').replace(/\D/g, '').slice(-10);
          if (cleanPhone && cleanPhone.length === 10) {
            try {
              const { whatsappQueueWorker } = await import('./whatsappQueueWorker.js');
              const syncMsg = `🛒 *Order Synced to Live Cart — AI Pharmacy*\n\nHello *${ord.requester || 'Customer'}*,\nYour queued medicine request for *${prodName}* (Qty: ${ord.qty || 1}) has been automatically synchronized and forwarded to our distributor Live Cart for procurement!\n\nWe will update you as soon as stock arrives at the counter.`;
              await whatsappQueueWorker.enqueue(`91${cleanPhone}`, syncMsg, 'live_cart_sync_notification', ord.requester);
            } catch (_) {}
          }
        }
      }

      if (syncedCount > 0) {
        try {
          const { eventService } = await import('./eventService.js');
          eventService.broadcast('order_updated', { at: Date.now(), source: 'offline_sync' });
          eventService.broadcast('live_cart_updated', { at: Date.now(), count: syncedCount });
        } catch (_) {}
      }

      return { processed: queuedOrders.length, synced: syncedCount };
    } catch (e: any) {
      console.warn('[StartupSyncCoordinator] syncPendingLiveCartOrders failure:', e?.message || e);
      return { processed: 0, synced: 0 };
    }
  }

  /**
   * Called when boot live-cart warm-up settles with an error, offline state, or skip.
   */
  public markWarmUpSettled(error?: string | null): void {
    this.warmUpSettled = true;
    if (error) this.lastError = error;
    if (this.syncPending && !this.cartLoaded) {
      this.releaseWaiters();
    }
  }

  /**
   * Called by background workers (WhatsApp intent scanner, OCR queue, refill scanner)
   * on cold boot to await cart readiness before processing new shortage scans.
   */
  public async waitForCartSync(): Promise<void> {
    if (this.cartLoaded || !this.syncPending) {
      return Promise.resolve();
    }

    // If already past timeout, proceed immediately
    if (Date.now() - this.startupTime >= this.maxTimeoutMs) {
      this.releaseWaiters();
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.resolveCallbacks.push(resolve);
    });
  }

  /**
   * Release all waiting promises.
   */
  private releaseWaiters(): void {
    this.syncPending = false;
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    const callbacks = [...this.resolveCallbacks];
    this.resolveCallbacks = [];
    callbacks.forEach(cb => {
      try {
        cb();
      } catch (err) {
        console.error('[StartupSyncCoordinator] Error in release waiter callback:', err);
      }
    });
  }

  /**
   * Check if cart sync is complete.
   */
  public isReady(): boolean {
    return this.cartLoaded || !this.syncPending;
  }

  /**
   * Get current sync status for UI alerting.
   */
  public getStatus(): { cartLoaded: boolean; syncPending: boolean; elapsedMs: number; timedOut: boolean; warmUpSettled: boolean; lastError: string | null } {
    const elapsed = Date.now() - this.startupTime;
    const timedOut = !this.cartLoaded && elapsed >= this.maxTimeoutMs;
    return {
      cartLoaded: this.cartLoaded,
      syncPending: this.syncPending && !timedOut,
      elapsedMs: elapsed,
      timedOut,
      warmUpSettled: this.warmUpSettled || this.cartLoaded || timedOut,
      lastError: this.lastError
    };
  }
}

export const startupSyncCoordinator = new StartupSyncCoordinator();
