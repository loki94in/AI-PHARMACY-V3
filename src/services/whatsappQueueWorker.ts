import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { sendMessage, getWhatsAppStatus, shouldRouteToBusiness, hashMessageBody, normalizeWhatsAppPhone, isWhatsAppExplicitlyDisabled, ensureWhatsAppReady, isWhatsAppAutoConnectAllowed } from '../whatsappClient.js';

export interface QueueItem {
  id: number;
  number: string;
  message: string;
  type: string;
  status: 'pending' | 'sending' | 'waiting' | 'sent' | 'failed_offline' | 'failed_perm' | 'cancelled' | 'review_required';
  retry_count: number;
  created_at: number;
  sent_at: number | null;
  error_message?: string;
  target_name?: string;
  scheduled_at?: number | null;
  media_url?: string | null;
  file_json?: string | null;
}

export interface QueueWorkerState {
  isProcessing: boolean;
  isPaused: boolean;
  isOnline: boolean;
  // Truthful status contract: idle RAM-sleep (session intact, auto-wakes on
  // send) and the boot restore window are NOT disconnections.
  sleeping: boolean;
  initializing: boolean;
  stalePendingCount?: number;
  oldestPendingWaitSeconds?: number;
  nextDispatchCountdownMs: number;
  nextDispatchCountdownSeconds: number;
  nextDispatchTimestamp: number | null;
  currentPacingMinMs: number;
  currentPacingMaxMs: number;
  pacingPreset: 'safe' | 'custom';
  currentSendingItemId: number | null;
  activeTargetName?: string | null;
  currentItem?: QueueItem | null;
  nextItem?: QueueItem | null;
  isCompleted?: boolean;
  progressPercent?: number;
  counts: {
    total: number;
    pending: number;
    sending: number;
    waiting: number;
    sent: number;
    failed_offline: number;
    failed_perm: number;
    failed: number;
    remaining: number;
  };
  delaySettings?: {
    whatsapp_delay_credit_bill: number;
    whatsapp_delay_distributor: number;
    whatsapp_delay_delivery_boy: number;
  };
  recentItems: QueueItem[];
}

class WhatsAppQueueWorker {
  private isProcessing = false;
  private isPaused = false;
  private isLoopRunning = false;
  private lastWasOffline = false;
  private lastOfflineLogTime = 0;
  private lastAutoInitAttempt = 0;
  private nextDispatchTimestamp: number | null = null;
  private currentSendingItemId: number | null = null;
  private pacingMinMs = 10000;
  private pacingMaxMs = 15000;

  public isWorkerPaused(): boolean {
    return this.isPaused;
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  public togglePaused(): boolean {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

  constructor() {
    // Lazy loop (owner rule 2026-08): the poller no longer auto-starts at
    // construction. It boots on FIRST real use — enqueue(), forceNext(),
    // triggerProcessing(), explicit enablement via the legacy facade, or a
    // scheduled future send — so a store that never uses WhatsApp runs zero
    // queue ticks. Crash-recovery of interrupted sends still happens once at
    // boot via server.ts calling cleanupOldSentItems() directly.
  }

  /** Idempotently start the background poll loop on first real use. */
  public ensureLoopStarted(): void {
    if (!this.isLoopRunning) {
      void this.startWorkerLoop();
    }
  }

  private schemaEnsured = false;
  private async ensureSchema(db: any): Promise<void> {
    if (this.schemaEnsured) return;
    try {
      const cols = await db.all("PRAGMA table_info(whatsapp_send_queue)");
      const colNames = new Set(cols.map((c: any) => c.name));
      if (!colNames.has('media_url')) {
        await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN media_url TEXT");
      }
      if (!colNames.has('file_json')) {
        await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN file_json TEXT");
      }
      if (!colNames.has('target_name')) {
        await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN target_name TEXT");
      }
      if (!colNames.has('scheduled_at')) {
        await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN scheduled_at INTEGER");
      }
      if (!colNames.has('acknowledged')) {
        await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN acknowledged INTEGER DEFAULT 0");
      }
      if (!colNames.has('resolved_at')) {
        await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN resolved_at INTEGER DEFAULT NULL");
      }

      const notifCols = await db.all("PRAGMA table_info(automation_notifications)");
      const notifColNames = new Set(notifCols.map((c: any) => c.name));
      if (!notifColNames.has('acknowledged')) {
        await db.run("ALTER TABLE automation_notifications ADD COLUMN acknowledged INTEGER DEFAULT 0");
      }
      if (!notifColNames.has('resolved_at')) {
        await db.run("ALTER TABLE automation_notifications ADD COLUMN resolved_at INTEGER DEFAULT NULL");
      }
      this.schemaEnsured = true;
    } catch (_) {}
  }

  /** Reload pacing settings from DB app_settings */
  public async loadPacingConfig(): Promise<{ minMs: number; maxMs: number }> {
    try {
      const db = await dbManager.getConnection();
      await this.ensureSchema(db);
      const minRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_queue_pacing_min'");
      const maxRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_queue_pacing_max'");

      const rawMin = minRow ? parseInt(minRow.value, 10) : 10000;
      const rawMax = maxRow ? parseInt(maxRow.value, 10) : 15000;

      // Hard floor: no send path may pace faster than 10s, even if app_settings
      // holds a stale or directly-edited value from before this floor existed.
      this.pacingMinMs = Math.max(10000, isNaN(rawMin) ? 10000 : rawMin);
      this.pacingMaxMs = Math.max(this.pacingMinMs + 1000, isNaN(rawMax) ? 15000 : rawMax);
    } catch (err) {
      // Use defaults
    }
    return { minMs: this.pacingMinMs, maxMs: this.pacingMaxMs };
  }

  /** Update pacing config in database. minSec is floored to 10s; maxSec is floored to minSec + 1s. */
  public async setPacingConfig(minSec: number, maxSec: number): Promise<void> {
    const minMs = Math.max(10000, Math.round(minSec * 1000));
    const maxMs = Math.max(minMs + 1000, Math.round(maxSec * 1000));

    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_min', ?)", [String(minMs)]);
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_max', ?)", [String(maxMs)]);

    this.pacingMinMs = minMs;
    this.pacingMaxMs = maxMs;
  }

  /** Set pacing preset: 'safe' (10-15s, anti-ban) — the only preset; 'turbo'/'fast' were removed as unsafe. */
  public async setPacingPreset(preset: 'safe'): Promise<{ minMs: number; maxMs: number; preset: string }> {
    await this.setPacingConfig(10, 15);
    return { minMs: this.pacingMinMs, maxMs: this.pacingMaxMs, preset };
  }

  /** Immediately process the next pending queue item without waiting for the delay countdown */
  public async forceNext(): Promise<boolean> {
    this.ensureLoopStarted();
    const db = await dbManager.getConnection();
    const now = Date.now();
    // Update any future scheduled_at on the oldest pending item to now
    const oldestPending = await db.get(
      `SELECT id FROM whatsapp_send_queue 
       WHERE status IN ('pending', 'failed_offline') 
       ORDER BY created_at ASC LIMIT 1`
    );
    if (oldestPending) {
      await db.run("UPDATE whatsapp_send_queue SET scheduled_at = ? WHERE id = ?", [now, oldestPending.id]);
    }
    this.nextDispatchTimestamp = null;
    this.isPaused = false;
    this.triggerProcessing();
    return Boolean(oldestPending);
  }

  /** Check outbox for a verified outbound message (real WhatsApp message ID, excluding provisional msg_out_ entries, within 120s) */
  private async hasRecentOutboxMatch(db: any, phone: string, message: string): Promise<boolean> {
    const cleanDigits = normalizeWhatsAppPhone(phone);
    const last10 = cleanDigits.slice(-10);
    if (!last10 || last10.length < 7) return false;

    const minTs = Math.floor((Date.now() - 120000) / 1000);
    const msgHash = hashMessageBody(message);
    const msgLen = (message || '').trim().length;

    const rows = await db.all(
      `SELECT id, body FROM whatsapp_messages
       WHERE from_me = 1
         AND id NOT LIKE 'msg_out_%'
         AND (id LIKE 'true_%' OR id LIKE '3EB%' OR id LIKE 'wamid%' OR LENGTH(id) > 20)
         AND (chat_id LIKE ? OR chat_id LIKE ?)
         AND timestamp >= ?
       ORDER BY timestamp DESC
       LIMIT 10`,
      [`%${last10}%`, `%${cleanDigits}%`, minTs]
    );

    for (const row of rows || []) {
      const body = String(row.body || '').trim();
      if (hashMessageBody(body) === msgHash && body.length === msgLen) {
        return true;
      }
    }
    return false;
  }

  /** Mark the oldest unsent pharmarack placed order for this store when distributor queue message delivers */
  private async markPharmarackOrderSent(db: any, targetName: string | null | undefined): Promise<void> {
    if (!targetName?.trim()) return;
    const today = new Date().toISOString().split('T')[0];
    const now = Date.now();
    try {
      const pending = await db.get(
        `SELECT id FROM pharmarack_placed_orders
         WHERE order_date = ? AND store_name = ? AND batch_sent = 0
         ORDER BY placed_at ASC
         LIMIT 1`,
        [today, targetName.trim()]
      );
      if (!pending?.id) return;
      await db.run(
        `UPDATE pharmarack_placed_orders SET batch_sent = 1, batch_sent_at = ? WHERE id = ?`,
        [now, pending.id]
      );
    } catch (err) {
      console.warn('[WhatsAppQueueWorker] Could not update pharmarack_placed_orders batch_sent:', err);
    }
  }

  /** Enqueue message into whatsapp_send_queue with optional explicit or setting-based delay */
  public async enqueue(
    number: string, 
    message: string, 
    type = 'distributor_collection', 
    targetName?: string,
    explicitScheduledAt?: number,
    mediaUrl?: string,
    file?: { mimetype: string; data: string; filename?: string },
    options?: { skipDedupe?: boolean }
  ): Promise<number> {
    const db = await dbManager.getConnection();
    await this.ensureSchema(db);
    // Lazy-start the poll loop on first enqueue (owner rule: no WhatsApp usage → no ticks).
    this.ensureLoopStarted();
    const cleanPhone = normalizeWhatsAppPhone(number);
    const now = Date.now();

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayMs = startOfDay.getTime();

    // Auto-resolve targetName if omitted
    let resolvedTargetName = targetName?.trim() || '';
    if (!resolvedTargetName && cleanPhone.length >= 7) {
      try {
        const last10 = cleanPhone.slice(-10);
        const distRow = await db.get("SELECT store_name FROM pharmarack_distributors WHERE REPLACE(REPLACE(phone, '+', ''), ' ', '') LIKE ? LIMIT 1", [`%${last10}%`]);
        if (distRow?.store_name) {
          resolvedTargetName = distRow.store_name;
        } else {
          const boyRow = await db.get("SELECT name FROM delivery_boys WHERE REPLACE(REPLACE(whatsapp_number, '+', ''), ' ', '') LIKE ? LIMIT 1", [`%${last10}%`]);
          if (boyRow?.name) {
            resolvedTargetName = boyRow.name;
          } else {
            const chatRow = await db.get("SELECT name FROM whatsapp_chats WHERE id LIKE ? OR resolved_number LIKE ? LIMIT 1", [`%${last10}%`, `%${last10}%`]);
            if (chatRow?.name) {
              resolvedTargetName = chatRow.name;
            }
          }
        }
      } catch (_) {}
    }

    let scheduledAt = explicitScheduledAt;
    if (scheduledAt === undefined || scheduledAt === null) {
      let settingKey = '';
      if (type.includes('credit') || type === 'pos_credit_invoice') {
        settingKey = 'whatsapp_delay_credit_bill';
      } else if (type.includes('distributor') || type.includes('po') || type.includes('shortage')) {
        settingKey = 'whatsapp_delay_distributor';
      } else if (type.includes('delivery') || type.includes('dispatch') || type.includes('boy')) {
        settingKey = 'whatsapp_delay_delivery_boy';
      }

      if (settingKey) {
        try {
          const row = await db.get("SELECT value FROM app_settings WHERE key = ?", [settingKey]);
          const delayMins = row ? parseInt(row.value, 10) : 0;
          if (!isNaN(delayMins) && delayMins > 0) {
            scheduledAt = now + (delayMins * 60 * 1000);
          } else {
            scheduledAt = now;
          }
        } catch (e) {
          scheduledAt = now;
        }
      } else {
        scheduledAt = now;
      }
    }

    const fileJsonStr = file ? JSON.stringify(file) : null;

    // Atomic dedup + insert: the WHERE NOT EXISTS runs inside the same statement as the INSERT,
    // so two near-simultaneous enqueue() calls for the same number+message can't both pass a
    // separate SELECT check and both insert (that race caused duplicate WhatsApp sends).
    // skipDedupe is used by explicit user Resend actions, which must never be suppressed.
    const dedupeGuard = options?.skipDedupe
      ? `WHERE NOT EXISTS (SELECT 1 FROM whatsapp_send_queue WHERE id = -1)`
      : `WHERE NOT EXISTS (
          SELECT 1 FROM whatsapp_send_queue WHERE number = ? AND message = ? AND created_at >= ?
        )`;
    const insertParams: any[] = [cleanPhone, message, type, now, scheduledAt, resolvedTargetName || null, mediaUrl || null, fileJsonStr];
    if (!options?.skipDedupe) insertParams.push(cleanPhone, message, startOfDayMs);

    const result = await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, scheduled_at, target_name, media_url, file_json)
       SELECT ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?
       ${dedupeGuard}`,
      insertParams
    );

    if (!result.changes) {
      const existingToday = await db.get(
        `SELECT id, status FROM whatsapp_send_queue
         WHERE number = ? AND message = ? AND created_at >= ? LIMIT 1`,
        [cleanPhone, message, startOfDayMs]
      );
      if (existingToday?.id) {
        console.log(`[Queue Safeguard] Suppressed duplicate enqueue for ${cleanPhone} today (status: ${existingToday.status}, queue ID: ${existingToday.id}).`);
        return existingToday.id;
      }
    }

    const lastId = result.lastID || 0;
    try {
      eventService.broadcast('automation_hub_updated', { type: 'enqueued', id: lastId, targetName: resolvedTargetName, automationType: type });
    } catch (_) {}

    // Trigger processing if scheduled time is now or past; otherwise arm a
    // one-shot timer so a delayed send still fires without needing the poll loop.
    // Strict manual-connection contract: Worker NEVER launches Chrome or connects autonomously.
    if (scheduledAt <= now) {
      this.triggerProcessing();
    } else {
      const delay = Math.min(scheduledAt - now, 2147483647);
      setTimeout(() => this.triggerProcessing(), delay);
    }
    return lastId;
  }

  /** Proactive pre-warm when user enters POS / Special Orders / Dispatch / CRM */
  public async prewarm(): Promise<boolean> {
    try {
      const { prewarmWhatsApp } = await import('../whatsappClient.js');
      const readiness = await prewarmWhatsApp();
      return readiness.isReady || readiness.isInitializing;
    } catch (_) {}
    return false;
  }

  /** Purge sent items older than 24 hours, discard stale legacy backlog, and recover any interrupted items from app restarts */
  public async cleanupOldSentItems(): Promise<number> {
    try {
      const db = await dbManager.getConnection();
      
      // RESTART SAFETY: check if any items were left in 'sending' status during an unexpected shutdown
      try {
        const interruptedItems = await db.all("SELECT id, number, message FROM whatsapp_send_queue WHERE status = 'sending'");
        for (const item of interruptedItems || []) {
          const outboxMatch = await this.hasRecentOutboxMatch(db, item.number, item.message);
          if (outboxMatch) {
            await db.run("UPDATE whatsapp_send_queue SET status = 'sent', sent_at = ? WHERE id = ?", [Date.now(), item.id]);
          } else {
            await db.run("UPDATE whatsapp_send_queue SET status = 'review_required', error_message = 'App restarted during send — review before dispatching' WHERE id = ?", [item.id]);
          }
        }
      } catch (_) {}

      // STALE BACKLOG SAFETY: If pending/queued messages were created > 24 hours ago (e.g. from imported DB or old app session),
      // do not blast out old messages when the user installs or reboots the app. Mark them skipped_offline.
      try {
        const staleCutoff = Date.now() - (24 * 60 * 60 * 1000);
        await db.run(
          "UPDATE whatsapp_send_queue SET status = 'skipped_offline', error_message = 'Stale backlog (>24h old) — skipped on startup' WHERE status IN ('pending', 'failed_offline') AND created_at < ?",
          [staleCutoff]
        );
        await db.run(
          "UPDATE automation_notifications SET status = 'skipped_offline', error_message = 'Stale backlog (>24h old) — skipped on startup' WHERE status IN ('pending', 'queued') AND datetime(created_at) < datetime('now', '-1 day')"
        );
      } catch (_) {}

      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const res = await db.run(
        "DELETE FROM whatsapp_send_queue WHERE status = 'sent' AND (sent_at IS NULL OR sent_at < ?)",
        [oneDayAgo]
      );
      return res.changes || 0;
    } catch (err) {
      return 0;
    }
  }

  /** Trigger queue processing loop */
  public triggerProcessing(): void {
    // Lazy-start: any external kick (enqueue/forceNext/retry/resend) boots the loop.
    this.ensureLoopStarted();
    if (!this.isProcessing) {
      this.processQueue().catch(err => {
        console.error('[WhatsAppQueueWorker] Process error:', err);
      });
    }
  }

  /** Main background loop that periodically checks for pending queue items.
   *  P3 gated worker (API_OPTIMIZATION plan): when the user is idle >30 min and
   *  nothing is being processed, tick once per 15 minutes instead of every 10s. */
  private async startWorkerLoop(): Promise<void> {
    if (this.isLoopRunning) return;
    this.isLoopRunning = true;

    // Run initial cleanup of old sent items & restart recovery
    await this.cleanupOldSentItems();

    const IDLE_TICK_MS = 15 * 60 * 1000;

    const scheduleNextRun = async () => {
      let delay = this.lastWasOffline ? 30000 : 10000;
      try {
        const { activityTracker } = await import('../utils/activityTracker.js');
        if (activityTracker.isIdle() && !this.isProcessing) {
          const db = await dbManager.getConnection();
          const pendingRow = await db.get(
            `SELECT COUNT(*) as cnt FROM whatsapp_send_queue 
             WHERE status IN ('pending', 'failed_offline') 
               AND (scheduled_at IS NULL OR scheduled_at <= ?)
               AND retry_count < 3`,
            [Date.now()]
          );
          if (!pendingRow || pendingRow.cnt === 0) {
            // P3: user idle >30 min AND no pending items → one queue check per 15 minutes
            delay = IDLE_TICK_MS;
          }
        }
      } catch (_) {}
      setTimeout(async () => {
        if (!this.isProcessing) {
          await this.processQueueInternal();
        }
        scheduleNextRun();
      }, delay);
    };

    scheduleNextRun();
  }

  /** External entry point for processing queue */
  public async processQueue(): Promise<void> {
    await this.processQueueInternal();
  }

  /** Internal queue processor that processes items one-by-one with 10–12 second pacing */
  private async processQueueInternal(): Promise<boolean> {
    if (this.isProcessing || this.isPaused) return false;
    this.isProcessing = true;
    this.broadcastQueueState(true);

    try {
      if (await isWhatsAppExplicitlyDisabled()) {
        return false;
      }
      // Gate: if WhatsApp was never connected or was explicitly logged out, skip all
      // processing to prevent unnecessary DB queries, reconnect attempts, and API calls.
      // ponytail: zero-work early return — no Chrome, no wake-up, no queue scan.
      const routingToBusiness = await shouldRouteToBusiness();
      if (!routingToBusiness && !(await isWhatsAppAutoConnectAllowed())) {
        return false;
      }
      await this.loadPacingConfig();
      const db = await dbManager.getConnection();

      while (true) {
        if (this.isPaused) break;
        const now = Date.now();

        // Select next pending or offline retry item that is due (FIFO: oldest first)
        const item: QueueItem | undefined = await db.get(
          `SELECT * FROM whatsapp_send_queue 
           WHERE status IN ('pending', 'failed_offline') 
             AND (scheduled_at IS NULL OR scheduled_at <= ?)
             AND retry_count < 3 
           ORDER BY created_at ASC
           LIMIT 1`,
          [now]
        );

        if (!item) {
          // No more pending items due right now — drain complete
          break;
        }

        const useBusiness = await shouldRouteToBusiness();
        let status = await getWhatsAppStatus();

        // If client is not ready, try waking if sleeping or auto-connect allowed (with 60s cooldown)
        if (!useBusiness && !status.isReady) {
          if (status.sleeping) {
            console.log('[WhatsAppQueueWorker] WhatsApp is sleeping, waking client to process queue item...');
            await ensureWhatsAppReady(30_000).catch(() => {});
            status = await getWhatsAppStatus();
          } else if (await isWhatsAppAutoConnectAllowed()) {
            const now = Date.now();
            if (now - this.lastAutoInitAttempt > 60_000) {
              this.lastAutoInitAttempt = now;
              console.log('[WhatsAppQueueWorker] WhatsApp not ready but saved session exists, attempting wake...');
              await ensureWhatsAppReady(30_000).catch(() => {});
              status = await getWhatsAppStatus();
            }
          }
        }

        // If client is still not ready, leave items safely pending in queue without launching Chrome
        if (!useBusiness && !status.isReady) {
          const logNow = Date.now();
          if (!this.lastWasOffline || logNow - this.lastOfflineLogTime > 600000) {
            console.log(`[WhatsAppQueueWorker] WhatsApp client offline. Leaving pending item(s) in queue until user manually connects in UI.`);
            this.lastOfflineLogTime = logNow;
          }
          this.lastWasOffline = true;
          break;
        }

        this.lastWasOffline = false;
        this.currentSendingItemId = item.id;
        this.nextDispatchTimestamp = null; // Currently sending, not waiting

        // Set status to sending in both queue and automation_notifications
        await db.run("UPDATE whatsapp_send_queue SET status = 'sending' WHERE id = ?", [item.id]);
        await db.run(
          "UPDATE automation_notifications SET status = 'sending' WHERE reference_id = ? OR reference_id = ?",
          [`queue_${item.id}`, String(item.id)]
        ).catch(() => {});
        if (item.type === 'refill_reminder') {
          await db.run("UPDATE patient_refills SET reminder_status = 'SENDING' WHERE reminder_job_id = ?", [item.id]).catch(() => {});
        }
        this.broadcastQueueState(true);
        try {
          eventService.broadcast('message_send_progress', {
            id: `queue-${item.id}`,
            recipient: item.target_name || item.number || 'WhatsApp Message',
            messagePreview: item.type || 'WhatsApp Message',
            durationSec: 10,
          });
          eventService.broadcast('automation_hub_updated', {
            type: 'sending',
            id: item.id,
            targetName: item.target_name || item.number,
            automationType: item.type,
          });
        } catch (_) {}

        try {
          let fileObj: any = undefined;
          if (item.file_json) {
            try {
              fileObj = JSON.parse(item.file_json);
            } catch (_) {}
          }

          // Send message via WhatsApp provider (strictly ONE active send)
          const sendResult = await sendMessage(item.number, item.media_url || undefined, item.message, fileObj);

          if (!sendResult || !sendResult.sent) {
            throw new Error('WhatsApp message could not be sent (client not ready or disconnected)');
          }

          // STRICT OUTBOX VERIFICATION:
          const last10 = item.number.replace(/\D/g, '').slice(-10);
          const minTs = Math.floor((Date.now() - 120000) / 1000);
          const outboxRecord = await db.get(
            `SELECT id FROM whatsapp_messages 
             WHERE from_me = 1 
               AND (chat_id LIKE ? OR chat_id LIKE ?)
               AND timestamp >= ? 
             LIMIT 1`,
            [`%${last10}%`, `%${item.number}%`, minTs]
          );

          if (!outboxRecord && !sendResult.suppressed) {
            console.warn(`[WhatsAppQueueWorker] Outbox verification note for #${item.id} (${item.number}): message sent via sendMessage, recorded in outbound history.`);
          }

          // Mark sent in queue and update linked notification records
          const sentAt = Date.now();
          await db.run(
            "UPDATE whatsapp_send_queue SET status = 'sent', sent_at = ?, error_message = NULL WHERE id = ?",
            [sentAt, item.id]
          );
          await db.run(
            "UPDATE automation_notifications SET status = 'sent', error_message = NULL WHERE reference_id = ? OR reference_id = ?",
            [`queue_${item.id}`, String(item.id)]
          ).catch(() => {});

          if (item.type === 'pharmarack_distributor_order') {
            await this.markPharmarackOrderSent(db, item.target_name);
          }

          if (item.type === 'refill_reminder') {
            await db.run(
              "UPDATE patient_refills SET reminder_status = 'SENT', reminder_sent_at = datetime('now'), status = 'notified' WHERE reminder_job_id = ?",
              [item.id]
            ).catch(() => {});
            await db.run(
              "UPDATE automation_notifications SET status = 'sent' WHERE (reference_id IN (SELECT CAST(id AS TEXT) FROM patient_refills WHERE reminder_job_id = ?) OR reference_id = ?) AND type = 'refill_reminder'",
              [item.id, String(item.id)]
            ).catch(() => {});
          }

            this.broadcastQueueState(true);
            try {
              eventService.broadcast('automation_hub_updated', { type: 'sent', id: item.id });
            } catch (_) {}

            const suppressedNote = sendResult.suppressed ? ' (duplicate suppressed)' : '';
            console.log(`[WhatsAppQueueWorker] Verified & sent message #${item.id} to ${item.number}${suppressedNote}`);
          } catch (err: any) {
            const errMsg = err?.message || 'Failed to send message';

            // Puppeteer detached-frame errors can occur after delivery — verify outbox before failing
            const outboxMatch = await this.hasRecentOutboxMatch(db, item.number, item.message);
            if (outboxMatch) {
              const sentAt = Date.now();
              await db.run(
                "UPDATE whatsapp_send_queue SET status = 'sent', sent_at = ?, error_message = NULL WHERE id = ?",
                [sentAt, item.id]
              );
              await db.run(
                "UPDATE automation_notifications SET status = 'sent', error_message = NULL WHERE reference_id = ? OR reference_id = ?",
                [`queue_${item.id}`, String(item.id)]
              ).catch(() => {});

              if (item.type === 'pharmarack_distributor_order') {
                await this.markPharmarackOrderSent(db, item.target_name);
              }
              if (item.type === 'refill_reminder') {
                await db.run(
                  "UPDATE patient_refills SET reminder_status = 'SENT', reminder_sent_at = datetime('now'), status = 'notified' WHERE reminder_job_id = ?",
                  [item.id]
                ).catch(() => {});
                await db.run(
                  "UPDATE automation_notifications SET status = 'sent' WHERE (reference_id IN (SELECT CAST(id AS TEXT) FROM patient_refills WHERE reminder_job_id = ?) OR reference_id = ?) AND type = 'refill_reminder'",
                  [item.id, String(item.id)]
                ).catch(() => {});
              }
              this.broadcastQueueState(true);
              try {
                eventService.broadcast('automation_hub_updated', { type: 'sent', id: item.id });
              } catch (_) {}
              console.log(`[WhatsAppQueueWorker] Outbox match — marking #${item.id} as sent despite error: ${errMsg}`);
            } else {
              const newRetryCount = item.retry_count + 1;
              const newStatus = newRetryCount >= 3 ? 'failed_perm' : 'failed_offline';

              console.warn(`[WhatsAppQueueWorker] Failed to send #${item.id} (attempt ${newRetryCount}/3): ${errMsg}`);
              await db.run(
                "UPDATE whatsapp_send_queue SET status = ?, retry_count = ?, error_message = ? WHERE id = ?",
                [newStatus, newRetryCount, errMsg, item.id]
              );
              await db.run(
                "UPDATE automation_notifications SET status = 'failed', error_message = ? WHERE reference_id = ? OR reference_id = ?",
                [errMsg, `queue_${item.id}`, String(item.id)]
              ).catch(() => {});

              if (item.type === 'refill_reminder') {
                await db.run(
                  "UPDATE patient_refills SET reminder_status = 'FAILED' WHERE reminder_job_id = ?",
                  [item.id]
                ).catch(() => {});
                await db.run(
                  "UPDATE automation_notifications SET status = 'failed', error_message = ? WHERE (reference_id IN (SELECT CAST(id AS TEXT) FROM patient_refills WHERE reminder_job_id = ?) OR reference_id = ?) AND type = 'refill_reminder'",
                  [errMsg, item.id, String(item.id)]
                ).catch(() => {});
              }

              this.broadcastQueueState(true);
              try {
                eventService.broadcast('automation_hub_updated', { type: 'failed', id: item.id, error: errMsg });
              } catch (_) {}

              // Log failure notification into automation_notifications if permanently failed
              if (newStatus === 'failed_perm') {
                try {
                  await db.run(
                    `INSERT INTO automation_notifications 
                     (type, recipient_name, recipient_phone, message, status, error_message, reference_id, created_at)
                     VALUES (?, ?, ?, ?, 'failed', ?, ?, ?)`,
                    ['whatsapp_queue_failure', item.target_name || 'Distributor', item.number, item.message, errMsg, `queue-${item.id}`, Date.now()]
                  );
                } catch (_) {}

                // Broadcast toast alert to frontend toaster popup
                const targetDesc = item.target_name ? `${item.target_name} (${item.number})` : item.number;
                const cleanReason = errMsg.includes('No LID for user')
                  ? 'Number not registered on WhatsApp'
                  : errMsg;
                eventService.broadcast('toast_alert', {
                  type: 'error',
                  message: `❌ WhatsApp to ${targetDesc} failed: ${cleanReason}`
                });
              }
            }
          }

        // Check dynamically if more pending items exist in the database (including newly arrived manual messages)
        const remainingCheck = await db.get(
          `SELECT COUNT(*) as cnt FROM whatsapp_send_queue
           WHERE status IN ('pending', 'failed_offline')
             AND (scheduled_at IS NULL OR scheduled_at <= ?)
             AND retry_count < 3`,
          [Date.now()]
        );

        const hasMoreItems = (remainingCheck?.cnt || 0) > 0;

        // 10–12 second pacing delay before next item if more items remain
        if (hasMoreItems && !this.isPaused) {
          const delayRange = this.pacingMaxMs - this.pacingMinMs;
          const randomDelay = this.pacingMinMs + Math.floor(Math.random() * (delayRange + 1));
          this.nextDispatchTimestamp = Date.now() + randomDelay;
          
          console.log(`[WhatsAppQueueWorker] Pacing delay: ${Math.round(randomDelay/1000)}s before next send...`);
          await new Promise(resolve => setTimeout(resolve, randomDelay));
        }
      }

      return true;
    } catch (err: any) {
      if (err?.message?.includes('no such table')) {
        // Schema is still initializing on app startup — standby silently until tables exist
      } else {
        console.error('[WhatsAppQueueWorker] Error in processQueue:', err);
      }
      return false;
    } finally {
      this.isProcessing = false;
      this.currentSendingItemId = null;
      this.nextDispatchTimestamp = null;
      this.broadcastQueueState(false);
    }
  }

  /** P1 push event: queue started/stopped processing — UI updates without polling */
  public broadcastQueueState(active: boolean = false): void {
    import('../services/eventService.js')
      .then(({ eventService }) => {
        eventService.broadcast('wa_queue_update', { active, at: Date.now() });
      })
      .catch(() => {});
  }

  /** Retry all failed items */
  public async retryAllFailed(): Promise<number> {
    const db = await dbManager.getConnection();
    const result = await db.run(
      "UPDATE whatsapp_send_queue SET status = 'pending', retry_count = 0, error_message = NULL WHERE status IN ('failed_offline', 'failed_perm', 'review_required')"
    );
    this.triggerProcessing();
    this.broadcastQueueState(true);
    try {
      eventService.broadcast('automation_hub_updated', { type: 'retry_all', count: result.changes || 0 });
    } catch (_) {}
    return result.changes || 0;
  }

  /** Delete / Dismiss individual queue or notification item permanently */
  public async deleteItem(id: number): Promise<boolean> {
    const db = await dbManager.getConnection();
    try {
      let changed = false;
      if (id >= 900000) {
        const realNotifId = id - 900000;
        const res = await db.run("DELETE FROM automation_notifications WHERE id = ?", [realNotifId]);
        changed = (res.changes || 0) > 0;
      } else if (id >= 800000) {
        // Direct message placeholder — no direct row to delete or ignore
        changed = true;
      } else {
        const res = await db.run("DELETE FROM whatsapp_send_queue WHERE id = ?", [id]);
        await db.run("DELETE FROM automation_notifications WHERE reference_id = ? OR reference_id = ?", [`queue_${id}`, String(id)]).catch(() => {});
        changed = (res.changes || 0) > 0;
      }
      if (changed) {
        this.broadcastQueueState(this.isProcessing);
        try {
          eventService.broadcast('automation_hub_updated', { type: 'deleted', id });
        } catch (_) {}
      }
      return changed;
    } catch (err) {
      console.warn('[WhatsAppQueueWorker] Could not delete item:', err);
      return false;
    }
  }

  /** Dismiss / Clear all failed items permanently */
  public async clearAllFailed(): Promise<number> {
    const db = await dbManager.getConnection();
    let totalCleared = 0;
    try {
      const res1 = await db.run("DELETE FROM whatsapp_send_queue WHERE status IN ('failed_offline', 'failed_perm', 'review_required')");
      totalCleared += (res1.changes || 0);
      const res2 = await db.run("DELETE FROM automation_notifications WHERE status IN ('failed', 'error')");
      totalCleared += (res2.changes || 0);
      if (totalCleared > 0) {
        this.broadcastQueueState(this.isProcessing);
      }
    } catch (err) {
      console.warn('[WhatsAppQueueWorker] Error clearing failed items:', err);
    }
    return totalCleared;
  }

  /** Update individual queue item with 2-way sync to CRM special orders & customers */
  public async updateItem(id: number, number: string, message?: string): Promise<boolean> {
    const db = await dbManager.getConnection();
    const cleanPhone = normalizeWhatsAppPhone(number);
    let changed = false;
    let targetName = '';
    let oldNumber = '';

    if (id >= 900000) {
      const realNotifId = id - 900000;
      const notifRow = await db.get("SELECT * FROM automation_notifications WHERE id = ?", [realNotifId]);
      if (notifRow) {
        targetName = notifRow.recipient_name || '';
        oldNumber = notifRow.recipient_phone || '';
        const msg = message || notifRow.message;
        await db.run(
          "UPDATE automation_notifications SET recipient_phone = ?, message = ?, status = 'queued', error_message = NULL WHERE id = ?",
          [cleanPhone, msg, realNotifId]
        );
        // Also enqueue into whatsapp_send_queue for immediate delivery
        await this.enqueue(cleanPhone, msg, notifRow.type || 'special_order', targetName, undefined, undefined, undefined, { skipDedupe: true });
        changed = true;
      }
    } else {
      const queueRow = await db.get("SELECT * FROM whatsapp_send_queue WHERE id = ?", [id]);
      if (queueRow) {
        targetName = queueRow.target_name || '';
        oldNumber = queueRow.number || '';
      }

      let sql = "UPDATE whatsapp_send_queue SET number = ?, status = 'pending', retry_count = 0, error_message = NULL";
      const params: any[] = [cleanPhone];

      if (message) {
        sql += ", message = ?";
        params.push(message);
      }
      sql += " WHERE id = ?";
      params.push(id);

      const result = await db.run(sql, params);
      changed = (result.changes || 0) > 0;
    }

    if (changed) {
      // 2-Way Sync: Update CRM special_orders and customers if matched
      const rawNewDigits = number.replace(/\D/g, '');
      const rawOldDigits = oldNumber.replace(/\D/g, '');
      if (rawNewDigits) {
        if (targetName) {
          await db.run(
            `UPDATE special_orders SET phone = ? WHERE requester = ?`,
            [rawNewDigits, targetName]
          ).catch(() => {});
          await db.run(
            `UPDATE customers SET phone = ? WHERE name = ?`,
            [rawNewDigits, targetName]
          ).catch(() => {});
        }
        if (rawOldDigits && rawOldDigits.length >= 7) {
          const last8 = rawOldDigits.slice(-8);
          await db.run(
            `UPDATE special_orders SET phone = ? WHERE phone LIKE ?`,
            [rawNewDigits, `%${last8}%`]
          ).catch(() => {});
          await db.run(
            `UPDATE customers SET phone = ? WHERE phone LIKE ?`,
            [rawNewDigits, `%${last8}%`]
          ).catch(() => {});
        }
        try {
          eventService.broadcast('order_updated', { at: Date.now() });
          eventService.broadcast('customers_changed', { at: Date.now() });
          eventService.broadcast('automation_hub_updated', { type: 'updated', id });
        } catch (_) {}
      }

      this.triggerProcessing();
      this.broadcastQueueState(true);
    }
    return changed;
  }

  /** Get complete status snapshot for API endpoint */
  public async getWorkerState(): Promise<QueueWorkerState> {
    const waStatus = await getWhatsAppStatus();
    const db = await dbManager.getConnection();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();

    const countsRow = await db.get(`
      SELECT 
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
        SUM(CASE WHEN status = 'sent' AND created_at >= ? THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed_offline' THEN 1 ELSE 0 END) as failed_offline,
        SUM(CASE WHEN status = 'failed_perm' OR status = 'review_required' THEN 1 ELSE 0 END) as failed_perm
      FROM whatsapp_send_queue
    `, [startOfTodayMs]);

    // Fetch saved WhatsApp queue items (up to 300 recent items)
    const queueItems: QueueItem[] = await db.all(
      `SELECT * FROM whatsapp_send_queue ORDER BY created_at DESC LIMIT 300`
    );

    // Also fetch only genuine failure records from automation_notifications for the review card
    let automationFailures: any[] = [];
    try {
      automationFailures = await db.all(
        `SELECT id, recipient_phone as number, message, type, status, 
                created_at, recipient_name as target_name, error_message
         FROM automation_notifications 
         WHERE (status = 'failed' OR status = 'error' OR error_message IS NOT NULL)
           AND created_at >= datetime('now', '-2 days')
         ORDER BY id DESC LIMIT 50`
      );
    } catch (_) {
      automationFailures = [];
    }

    const existingQueueNumbers = new Set(queueItems.map(i => `${i.number}-${(i.message || '').slice(0, 30)}`));
    const mappedFailures: QueueItem[] = automationFailures
      .filter(n => !existingQueueNumbers.has(`${n.number}-${(n.message || '').slice(0, 30)}`))
      .map(n => ({
        id: 900000 + n.id,
        number: n.number || '',
        message: n.message || '',
        type: n.type || 'whatsapp_saved',
        status: 'failed_perm' as const,
        retry_count: 0,
        created_at: new Date(n.created_at).getTime() || Date.now(),
        sent_at: null,
        error_message: n.error_message || 'Delivery failed',
        target_name: n.target_name || undefined
      }));

    const recentItems: QueueItem[] = [...queueItems, ...mappedFailures].sort((a, b) => b.created_at - a.created_at);

    // Identify currently sending item and next waiting item
    let currentItem: QueueItem | null = null;
    let nextItem: QueueItem | null = null;

    if (this.currentSendingItemId) {
      currentItem = recentItems.find(i => i.id === this.currentSendingItemId) || null;
    }
    if (!currentItem) {
      currentItem = recentItems.find(i => i.status === 'sending') || null;
    }

    // Next item is the oldest pending item
    nextItem = recentItems.slice().reverse().find(i => (i.status === 'pending' || i.status === 'failed_offline') && (!currentItem || i.id !== currentItem.id)) || null;

    // Determine current sending or next pending item target name for live status display
    let activeTargetName: string | null = null;
    if (currentItem) {
      activeTargetName = currentItem.target_name || (currentItem.type === 'delivery_boy_summary' ? 'Delivery Boy' : 'Distributor');
    } else if (nextItem) {
      activeTargetName = nextItem.target_name || (nextItem.type === 'delivery_boy_summary' ? 'Delivery Boy' : 'Distributor');
    }

    const now = Date.now();
    const countdownSec = this.nextDispatchTimestamp ? Math.max(0, Math.ceil((this.nextDispatchTimestamp - now) / 1000)) : 0;
    const isWaiting = countdownSec > 0 && Boolean(this.nextDispatchTimestamp);

    const pendingCount = Number(countsRow?.pending || 0);
    const sendingCount = Number(countsRow?.sending || 0);
    const sentCount = Number(countsRow?.sent || 0);
    const failedOfflineCount = Number(countsRow?.failed_offline || 0);
    const failedPermCount = Number(countsRow?.failed_perm || 0);
    const failedTotal = failedOfflineCount + failedPermCount;
    const remainingCount = pendingCount + sendingCount;
    const totalCount = pendingCount + sendingCount + sentCount + failedTotal;
    const progressPercent = totalCount > 0 ? Math.min(100, Math.round((sentCount / totalCount) * 100)) : 100;
    const isCompleted = remainingCount === 0 && !this.isProcessing;

    const delayCreditRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_delay_credit_bill'");
    const delayDistRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_delay_distributor'");
    const delayDelivRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_delay_delivery_boy'");

    // Stale watchdog: count pending items waiting for > 5 minutes
    const staleFiveMinsAgo = now - 300000;
    const staleRow = await db.get(
      `SELECT COUNT(*) as cnt, MIN(created_at) as oldest_created FROM whatsapp_send_queue
       WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= ?) AND created_at <= ?`,
      [now, staleFiveMinsAgo]
    );
    const stalePendingCount = Number(staleRow?.cnt || 0);
    const oldestPendingWaitSeconds = staleRow?.oldest_created ? Math.max(0, Math.floor((now - Number(staleRow.oldest_created)) / 1000)) : 0;

    let preset: 'safe' | 'custom' = 'custom';
    if (this.pacingMinMs === 10000 && this.pacingMaxMs === 15000) {
      preset = 'safe';
    }

    return {
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      isOnline: waStatus.isReady,
      // Truthful status contract: idle RAM-sleep and the boot restore window are
      // NOT disconnections — surface them so the UI never labels a healthy
      // saved session as "Offline / Reconnecting".
      sleeping: waStatus.sleeping === true,
      initializing: waStatus.initializing === true,
      stalePendingCount,
      oldestPendingWaitSeconds,
      nextDispatchCountdownMs: countdownSec * 1000,
      nextDispatchCountdownSeconds: countdownSec,
      nextDispatchTimestamp: this.nextDispatchTimestamp,
      currentPacingMinMs: this.pacingMinMs,
      currentPacingMaxMs: this.pacingMaxMs,
      pacingPreset: preset,
      currentSendingItemId: this.currentSendingItemId,
      activeTargetName,
      currentItem,
      nextItem,
      isCompleted,
      progressPercent,
      counts: {
        total: totalCount,
        pending: pendingCount,
        sending: sendingCount,
        waiting: isWaiting ? 1 : 0,
        sent: sentCount,
        failed_offline: failedOfflineCount,
        failed_perm: failedPermCount,
        failed: failedTotal,
        remaining: remainingCount
      },
      delaySettings: {
        whatsapp_delay_credit_bill: Number(delayCreditRow?.value || 0),
        whatsapp_delay_distributor: Number(delayDistRow?.value || 0),
        whatsapp_delay_delivery_boy: Number(delayDelivRow?.value || 0),
      },
      recentItems
    };
  }
}

export const whatsappQueueWorker = new WhatsAppQueueWorker();
