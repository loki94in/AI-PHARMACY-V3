/**
 * waSmartReplyScheduler.ts
 * T4: WhatsApp Smart Reply Scheduler - human-like tiered delays, dedup, and read-gate.
 *
 * Flow:
 *   inbound message -> scheduleReply() -> delay timer
 *     -> on fire: re-check pharmacist_opened_at -> if not read -> handleInbound()
 *
 * Delay tiers (all configurable via app_settings):
 *   Cold / new user     -> rand(wa_bot_cold_delay_min_sec .. wa_bot_cold_delay_max_sec)  [35-60s]
 *   Warm / active convo -> rand(wa_bot_warm_delay_min_sec .. wa_bot_warm_delay_max_sec)  [10-17s]
 *
 * Warm window: last_pharmacist_message_at < wa_bot_warm_window_minutes ago             [20 min]
 */

import { dbManager } from '../database/connection.js';

interface PendingReply {
  timer: ReturnType<typeof setTimeout>;
  msg: any;
  scheduledAt: number;
  phone: string;
}

class WaSmartReplyScheduler {
  private pending: Map<string, PendingReply> = new Map();

  private static readonly DEFAULT_COLD_MIN = 35;
  private static readonly DEFAULT_COLD_MAX = 60;
  private static readonly DEFAULT_WARM_MIN = 10;
  private static readonly DEFAULT_WARM_MAX = 17;
  private static readonly DEFAULT_WARM_WINDOW_MIN = 20;

  private static phoneKey(chatId: string): string {
    const raw = chatId.split('@')[0] || chatId;
    const digits = raw.replace(/\D/g, '');
    return digits.slice(-10) || chatId;
  }

  private async loadSettings(): Promise<{
    botEnabled: boolean;
    speedMode: string;
    coldMin: number; coldMax: number;
    warmMin: number; warmMax: number;
    warmWindowMs: number;
    bundlingMs: number;
    humanReviewMode: boolean;
  }> {
    try {
      const db = await dbManager.getConnection();
      const keys = [
        'wa_bot_enabled',
        'wa_bot_speed_mode',
        'wa_bot_cold_delay_min_sec',
        'wa_bot_cold_delay_max_sec',
        'wa_bot_warm_delay_min_sec',
        'wa_bot_warm_delay_max_sec',
        'wa_bot_warm_window_minutes',
        'wa_bot_message_bundling_sec',
        'wa_bot_human_review_mode',
      ];
      const rows: { key: string; value: string }[] = await db.all(
        `SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => '?').join(',')})`,
        keys
      );
      const strMap = new Map(rows.map((r: { key: string; value: string }) => [r.key, r.value]));
      const botEnabled = strMap.get('wa_bot_enabled') !== 'false';
      const speedMode = strMap.get('wa_bot_speed_mode') || 'fast';
      const humanReviewMode = strMap.get('wa_bot_human_review_mode') === 'true';

      let coldMin = Number(strMap.get('wa_bot_cold_delay_min_sec')) || 5;
      let coldMax = Number(strMap.get('wa_bot_cold_delay_max_sec')) || 10;
      let warmMin = Number(strMap.get('wa_bot_warm_delay_min_sec')) || 3;
      let warmMax = Number(strMap.get('wa_bot_warm_delay_max_sec')) || 5;
      const warmWindowMin = Number(strMap.get('wa_bot_warm_window_minutes')) || 20;
      const bundlingSec = Number(strMap.get('wa_bot_message_bundling_sec')) || 3;

      if (speedMode === 'instant') {
        coldMin = 1;
        coldMax = 3;
        warmMin = 1;
        warmMax = 2;
      } else if (speedMode === 'fast') {
        coldMin = Math.min(coldMin, 5);
        coldMax = Math.min(coldMax, 10);
        warmMin = Math.min(warmMin, 3);
        warmMax = Math.min(warmMax, 5);
      } else if (speedMode === 'safe') {
        coldMin = 20;
        coldMax = 45;
        warmMin = 10;
        warmMax = 17;
      }

      return {
        botEnabled,
        speedMode,
        coldMin,
        coldMax,
        warmMin,
        warmMax,
        warmWindowMs: warmWindowMin * 60 * 1000,
        bundlingMs: bundlingSec * 1000,
        humanReviewMode,
      };
    } catch {
      return {
        botEnabled: true,
        speedMode: 'fast',
        coldMin: 5,
        coldMax: 10,
        warmMin: 3,
        warmMax: 5,
        warmWindowMs: 20 * 60 * 1000,
        bundlingMs: 3000,
        humanReviewMode: false,
      };
    }
  }

  private async isWarmConvo(chatId: string, warmWindowMs: number): Promise<boolean> {
    try {
      const db = await dbManager.getConnection();
      const key = `%${WaSmartReplyScheduler.phoneKey(chatId)}%`;
      const row = await db.get(
        `SELECT last_pharmacist_message_at FROM whatsapp_chats
         WHERE id = ? OR resolved_number LIKE ?
         ORDER BY last_pharmacist_message_at DESC LIMIT 1`,
        [chatId, key]
      );
      const lastPharmacistAt = Number(row?.last_pharmacist_message_at || 0);
      return lastPharmacistAt > 0 && (Date.now() - lastPharmacistAt) < warmWindowMs;
    } catch {
      return false;
    }
  }

  private async isAlreadyReadByPharmacist(chatId: string): Promise<boolean> {
    try {
      const db = await dbManager.getConnection();
      const row = await db.get(
        `SELECT id FROM whatsapp_messages
         WHERE chat_id = ? AND from_me = 0 AND pharmacist_opened_at IS NOT NULL
         ORDER BY pharmacist_opened_at DESC LIMIT 1`,
        [chatId]
      );
      return !!row;
    } catch {
      return false;
    }
  }

  private static randMs(minSec: number, maxSec: number): number {
    const span = Math.max(1, maxSec - minSec);
    return Math.round((minSec + Math.random() * span) * 1000);
  }

  public scheduleReply(msg: any, opts?: { forceCold?: boolean }): void {
    const chatId: string = msg?.from || msg?.chat?.id?._serialized || '';
    if (!chatId) return;

    const phoneKey = WaSmartReplyScheduler.phoneKey(chatId);

    const existing = this.pending.get(phoneKey);
    if (existing) {
      clearTimeout(existing.timer);
      this.pending.delete(phoneKey);
      console.log(`[SmartReplyScheduler] Collapsed pending reply for ${phoneKey} - replaced with latest message.`);
    }

    (async () => {
      try {
        const settings = await this.loadSettings();
        if (!settings.botEnabled) {
          console.log(`[SmartReplyScheduler] AI Auto-Reply Bot is paused/disabled in Settings. Skipping reply for ${phoneKey}.`);
          return;
        }

        if (await this.isAlreadyReadByPharmacist(chatId)) {
          console.log(`[SmartReplyScheduler] Suppressed reply for ${phoneKey} - already read by pharmacist.`);
          return;
        }

        let delayMs: number;
        if (opts?.forceCold) {
          delayMs = WaSmartReplyScheduler.randMs(settings.coldMin, settings.coldMax);
        } else {
          const warm = await this.isWarmConvo(chatId, settings.warmWindowMs);
          delayMs = warm
            ? WaSmartReplyScheduler.randMs(settings.warmMin, settings.warmMax)
            : WaSmartReplyScheduler.randMs(settings.coldMin, settings.coldMax);
          console.log(`[SmartReplyScheduler] Scheduling reply for ${phoneKey} in ${Math.round(delayMs / 1000)}s (${warm ? 'warm/continuous' : 'cold/idle'} window, mode=${settings.speedMode}).`);
        }

        const timer = setTimeout(async () => {
          this.pending.delete(phoneKey);
          try {
            if (await this.isAlreadyReadByPharmacist(chatId)) {
              console.log(`[SmartReplyScheduler] Reply suppressed on fire for ${phoneKey} - pharmacist read while waiting.`);
              return;
            }
            const { whatsappIntentService } = await import('./whatsappIntentService.js');
            await whatsappIntentService.handleInbound(msg);
          } catch (err: any) {
            console.error(`[SmartReplyScheduler] Error firing reply for ${phoneKey}:`, err?.message || err);
          }
        }, delayMs);

        if (typeof (timer as any).unref === 'function') (timer as any).unref();

        this.pending.set(phoneKey, { timer, msg, scheduledAt: Date.now() + delayMs, phone: phoneKey });
      } catch (err: any) {
        console.error(`[SmartReplyScheduler] Setup error for ${phoneKey}:`, err?.message || err);
      }
    })();
  }

  public cancelReplyFor(chatId: string): void {
    const phoneKey = WaSmartReplyScheduler.phoneKey(chatId);
    const existing = this.pending.get(phoneKey);
    if (existing) {
      clearTimeout(existing.timer);
      this.pending.delete(phoneKey);
      console.log(`[SmartReplyScheduler] Cancelled pending reply for ${phoneKey} - pharmacist opened chat.`);
    }
  }

  public isReplyPending(chatId: string): boolean {
    return this.pending.has(WaSmartReplyScheduler.phoneKey(chatId));
  }

  public async processOfflineBatch(
    confirm: boolean,
    outageInterval?: { start: number; end: number }
  ): Promise<{ processed: number; skipped_read: number; skipped_replied: number }> {
    let processed = 0;
    let skipped_read = 0;
    let skipped_replied = 0;

    try {
      const db = await dbManager.getConnection();

      const windowEnd = outageInterval?.end ?? Date.now();
      const windowStart = outageInterval?.start ?? (windowEnd - 24 * 60 * 60 * 1000);
      const startSec = Math.floor(windowStart / 1000);
      const endSec = Math.floor(windowEnd / 1000);

      const rows: { chat_id: string; latest_ts: number; latest_id: string; body: string }[] = await db.all(
        `SELECT chat_id,
                MAX(timestamp) as latest_ts,
                id             as latest_id,
                body
         FROM whatsapp_messages
         WHERE from_me = 0
           AND timestamp >= ? AND timestamp <= ?
         GROUP BY chat_id`,
        [startSec, endSec]
      );

      for (const row of rows) {
        const readRow = await db.get(
          `SELECT pharmacist_opened_at FROM whatsapp_messages WHERE id = ?`,
          [row.latest_id]
        ).catch(() => null);

        if (readRow?.pharmacist_opened_at) {
          skipped_read++;
          continue;
        }

        const repliedRow = await db.get(
          `SELECT id FROM whatsapp_messages
           WHERE chat_id = ? AND from_me = 1 AND timestamp > ?
           LIMIT 1`,
          [row.chat_id, row.latest_ts]
        ).catch(() => null);

        if (repliedRow) {
          skipped_replied++;
          continue;
        }

        processed++;

        if (confirm) {
          const phoneKey = WaSmartReplyScheduler.phoneKey(row.chat_id);
          const syntheticMsg = {
            from: row.chat_id,
            body: row.body || '',
            fromMe: false,
            timestamp: row.latest_ts,
            id: { _serialized: row.latest_id, id: row.latest_id },
            type: 'chat',
            hasMedia: false,
            getChat: async () => ({ id: { _serialized: row.chat_id }, name: '' }),
            getContact: async () => ({ number: phoneKey, name: '' }),
            downloadMedia: async () => undefined,
          };
          this.scheduleReply(syntheticMsg, { forceCold: true });
        }
      }
    } catch (err: any) {
      console.error('[SmartReplyScheduler] processOfflineBatch error:', err?.message || err);
    }

    return { processed, skipped_read, skipped_replied };
  }
}

export const waSmartReplyScheduler = new WaSmartReplyScheduler();
export default waSmartReplyScheduler;
