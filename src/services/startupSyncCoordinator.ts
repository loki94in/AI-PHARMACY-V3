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
  private isRefillCatchUpRunning: boolean = false;

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

      // Trigger automatic catch-up pass for online-sourced refills
      void this.runRefillAutoCartCatchUp('boot_cart_loaded').catch(err => {
        console.warn('[StartupSyncCoordinator] Refill auto cart catch-up warning:', err?.message || err);
      });

      // Trigger automatic drain of online cart queue from owner web portal
      void (async () => {
        try {
          const { cartQueueSyncService } = await import('./cartQueueSyncService.js');
          await cartQueueSyncService.drainCartAddQueue();
        } catch (err: any) {
          console.warn('[StartupSyncCoordinator] Cloud cart queue drain warning:', err?.message || err);
        }
      })();

      // Trigger automatic sync of all existing patients to portal accounts (auto-generates PINs for old patients)
      void (async () => {
        try {
          const { syncAllCustomersToPortal } = await import('../routes/customerPortal.js');
          const { dbManager } = await import('../database/connection.js');
          const db = await dbManager.getConnection();
          await syncAllCustomersToPortal(db);
        } catch (err: any) {
          console.warn('[StartupSyncCoordinator] Patient portal accounts sync warning:', err?.message || err);
        }
      })();
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

          // Stage customer notification in automation_notifications (STRICTLY STAGED, NEVER AUTO-SENT — Owner Decision D4)
          const cleanPhone = String(ord.phone || '').replace(/\D/g, '').slice(-10);
          if (cleanPhone && cleanPhone.length === 10) {
            try {
              const { getStoreMedicalName, getStorePhone } = await import('./storeSettingsService.js');
              const storeLabel = (await getStoreMedicalName(db)) || 'AI Pharmacy';
              const storePhone = await getStorePhone(db);
              const phoneSuffix = storePhone ? `\n📞 ${storePhone}` : '';
              const syncMsg = `🛒 *Order Synced to Live Cart — ${storeLabel}*\n\nHello *${ord.requester || 'Customer'}*,\nYour queued medicine request for *${prodName}* (Qty: ${ord.qty || 1}) has been synchronized and forwarded to our distributor Live Cart for procurement!\n\nWe will update you as soon as stock arrives at the counter.${phoneSuffix}`;
              await db.run(
                `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, needs_confirmation, reference_id)
                 VALUES (?, ?, ?, ?, 'staged', 1, ?)`,
                ['live_cart_sync_notification', ord.requester || 'Customer', cleanPhone, syncMsg, String(ord.id)]
              ).catch(() => {});
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
   * Catches up online-sourced refills (website + whatsapp) into the live Pharmarack cart.
   * Single-flight, bounded batch (max 10), serial execution, reuses processRefillCartItem exactly.
   * Owner-approved exception to worker prohibitions (Phase B).
   */
  public async runRefillAutoCartCatchUp(triggerSource = 'event'): Promise<{ processed: number; added: number; failed: number }> {
    if (this.isRefillCatchUpRunning) {
      console.log(`[StartupSyncCoordinator] Refill catch-up pass already running (trigger=${triggerSource}). Skipping duplicate.`);
      return { processed: 0, added: 0, failed: 0 };
    }

    this.isRefillCatchUpRunning = true;
    try {
      const { dbManager } = await import('../database/connection.js');
      const db = await dbManager.getConnection();

      const { getRefillAutoCartAddMode } = await import('./storeSettingsService.js');
      const mode = await getRefillAutoCartAddMode(db);
      if (mode !== 'auto') {
        console.log(`[StartupSyncCoordinator] Refill auto cart-add is ${mode}. Skipping catch-up.`);
        return { processed: 0, added: 0, failed: 0 };
      }

      const { getPharmarackSettings } = await import('../routes/pharmarack.js');
      const prSettings = await getPharmarackSettings();
      if (!prSettings['pharmarack_session_token']) {
        console.log('[StartupSyncCoordinator] No active Pharmarack session token. Skipping refill auto cart catch-up.');
        return { processed: 0, added: 0, failed: 0 };
      }

      // Query eligible pending online refills
      const eligibleRefills = await db.all(
        `SELECT pr.id, pr.medicine_id, pr.quantity_needed, pr.patient_name, pr.source, pr.cart_status,
                m.name AS medicine_name
         FROM patient_refills pr
         JOIN medicines m ON m.id = pr.medicine_id
         WHERE LOWER(pr.source) IN ('website', 'whatsapp')
           AND pr.is_active = 1
           AND LOWER(pr.status) = 'pending'
           AND (pr.cart_status IS NULL OR pr.cart_status NOT IN ('added', 'ready', 'in_cart'))
         ORDER BY pr.id ASC
         LIMIT 10`
      );

      if (!eligibleRefills || eligibleRefills.length === 0) {
        return { processed: 0, added: 0, failed: 0 };
      }

      console.log(`[StartupSyncCoordinator] Running refill auto-add catch-up for ${eligibleRefills.length} online refill(s) (trigger=${triggerSource}).`);
      const { processRefillCartItem } = await import('./refillCartService.js');
      let addedCount = 0;
      let failedCount = 0;

      for (const item of eligibleRefills) {
        try {
          const res = await processRefillCartItem(item.id, { qty: item.quantity_needed || 1 });
          await db.run(
            `UPDATE patient_refills SET cart_status = ? WHERE id = ?`,
            [res.status, item.id]
          );

          if (res.status === 'added' || res.status === 'in_cart') {
            addedCount++;
            // Mark any linked website_refill in special_orders as in_live_cart
            await db.run(
              `UPDATE special_orders 
               SET needs_live_cart_sync = 0, status = 'In Live Cart', delivery_status = 'in_live_cart'
               WHERE customer_order_source = 'website_refill' 
                 AND (LOWER(product) = LOWER(?) OR LOWER(medicine_name) = LOWER(?))
                 AND needs_live_cart_sync = 1`,
              [item.medicine_name, item.medicine_name]
            ).catch(() => {});
          } else {
            failedCount++;
          }

          // Small yield between items to protect CPU event loop on 4-core machine
          await new Promise(r => setTimeout(r, 200));
        } catch (itemErr: any) {
          failedCount++;
          console.warn(`[StartupSyncCoordinator] Refill #${item.id} auto-add error:`, itemErr?.message || itemErr);
          await db.run(
            `UPDATE patient_refills SET cart_status = 'failed' WHERE id = ?`,
            [item.id]
          ).catch(() => {});
        }
      }

      if (addedCount > 0 || failedCount > 0) {
        try {
          const { eventService } = await import('./eventService.js');
          eventService.broadcast('refill_updated', { source: 'auto_cart_catch_up', added: addedCount, failed: failedCount });
          eventService.broadcast('cart_updated', { source: 'refill_auto_add' });

          if (addedCount > 0) {
            eventService.broadcast('toast_alert', {
              type: 'success',
              message: `🛒 ${addedCount} online refill(s) automatically added to live Pharmarack cart!`,
              link: '/pharmarack-cart'
            });
          }
        } catch (_) {}
      }

      return { processed: eligibleRefills.length, added: addedCount, failed: failedCount };
    } catch (err: any) {
      console.warn('[StartupSyncCoordinator] Refill catch-up failure:', err?.message || err);
      return { processed: 0, added: 0, failed: 0 };
    } finally {
      this.isRefillCatchUpRunning = false;
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
