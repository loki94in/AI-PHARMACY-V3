/**
 * nonWaFallbackService.ts
 *
 * When a patient or credit customer is NOT on WhatsApp, this service:
 * 1. Creates a call task entry in patient_call_tasks (in-app call board).
 * 2. Sends a call-alert message to the pharmacy owner's WhatsApp.
 *
 * Fallback modes (non_wa_fallback_mode setting):
 *   'both'   - create task + send owner WA alert  (default)
 *   'owner'  - owner WA alert only
 *   'board'  - in-app call board only
 *   'off'    - disabled
 */

import { dbManager } from '../database/connection.js';
import { sendMessage, normalizeWhatsAppPhone } from '../whatsappClient.js';
import { resolveAdminWhatsappNumber } from './waAdminEscalationService.js';
import { eventService } from './eventService.js';

export interface FallbackContext {
  taskType: 'refill' | 'credit';
  patientName: string;
  patientPhone: string;
  referenceId?: string;
  details: string;
  detailsJson?: Record<string, unknown>;
}

export interface FallbackResult {
  taskId: number | null;
  ownerWaSent: boolean;
  mode: string;
}

export class NonWaFallbackService {

  private async getFallbackMode(db: any): Promise<string> {
    const enabledRow = await db.get("SELECT value FROM app_settings WHERE key = 'non_wa_fallback_enabled'");
    if (enabledRow?.value === 'false') return 'off';
    const modeRow = await db.get("SELECT value FROM app_settings WHERE key = 'non_wa_fallback_mode'");
    return modeRow?.value || 'both';
  }

  private async getAlertPhone(db: any): Promise<string> {
    const alertPhoneRow = await db.get("SELECT value FROM app_settings WHERE key = 'non_wa_fallback_alert_phone'");
    if (alertPhoneRow?.value && alertPhoneRow.value.trim() !== '') return alertPhoneRow.value.trim();
    return resolveAdminWhatsappNumber(db);
  }

  private buildOwnerAlertMessage(ctx: FallbackContext, storeName: string): string {
    const typeEmoji = ctx.taskType === 'refill' ? '\u{1F48A}' : '\u{1F4B0}';
    const typeLabel = ctx.taskType === 'refill' ? 'REFILL DUE' : 'CREDIT REMINDER';
    return (
      '\u{1F4DE} *CALL TASK: ' + typeLabel + ' (Patient Not on WhatsApp)*\n\n' +
      typeEmoji + ' *Patient:* ' + ctx.patientName + '\n' +
      '\u{1F4F1} *Phone:* ' + (ctx.patientPhone || 'N/A') + '\n' +
      '\u{1F4CB} *Details:* ' + ctx.details + '\n\n' +
      '\u26A0\uFE0F This patient does not have WhatsApp — automatic message was not delivered.\n' +
      'Please call them directly to confirm ' + (ctx.taskType === 'refill' ? 'their refill & collection' : 'payment for outstanding dues') + '.\n\n' +
      '\u2014 ' + storeName
    );
  }

  async handleFallback(ctx: FallbackContext, dbInstance?: any): Promise<FallbackResult> {
    const db = dbInstance || (await dbManager.getConnection());
    const mode = await this.getFallbackMode(db);
    if (mode === 'off') return { taskId: null, ownerWaSent: false, mode };

    const storeRow = await db.get(
      "SELECT value FROM app_settings WHERE key IN ('shop_name', 'pharmacy_name', 'store_name') AND value IS NOT NULL LIMIT 1"
    ).catch(() => null);
    const storeName = storeRow?.value || 'AI Pharmacy';

    // Dedup: don't create duplicate pending task for same patient+type within 24h
    const recentTask = await db.get(
      `SELECT id FROM patient_call_tasks
       WHERE task_type = ? AND patient_phone = ?
         AND status = 'pending'
         AND created_at > datetime('now', '-24 hours')
       LIMIT 1`,
      [ctx.taskType, ctx.patientPhone]
    ).catch(() => null);

    let taskId: number | null = recentTask?.id ?? null;

    if (!recentTask && (mode === 'both' || mode === 'board')) {
      try {
        const result = await db.run(
          `INSERT INTO patient_call_tasks
             (task_type, patient_name, patient_phone, reference_id, details_json, status, owner_wa_sent)
           VALUES (?, ?, ?, ?, ?, 'pending', 0)`,
          [
            ctx.taskType,
            ctx.patientName,
            ctx.patientPhone,
            ctx.referenceId || null,
            JSON.stringify(ctx.detailsJson ?? { details: ctx.details })
          ]
        );
        taskId = result?.lastID ?? null;
        console.log('[NonWaFallback] Created call task #' + taskId + ' for ' + ctx.patientName + ' (' + ctx.taskType + ')');
      } catch (err) {
        console.warn('[NonWaFallback] Failed to create call task:', err);
      }
    }

    let ownerWaSent = false;
    if (mode === 'both' || mode === 'owner') {
      try {
        const alertPhone = await this.getAlertPhone(db);
        if (alertPhone) {
          const cleanAlert = normalizeWhatsAppPhone(alertPhone);
          if (cleanAlert && cleanAlert.length >= 10) {
            const alertMsg = this.buildOwnerAlertMessage(ctx, storeName);
            await sendMessage(cleanAlert, undefined, alertMsg);
            ownerWaSent = true;
            if (taskId) {
              await db.run(
                'UPDATE patient_call_tasks SET owner_wa_sent = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [taskId]
              ).catch(() => {});
            }
            console.log('[NonWaFallback] Owner alert sent to ' + cleanAlert + ' for patient ' + ctx.patientName);
          }
        }
      } catch (err) {
        console.warn('[NonWaFallback] Failed to send owner WhatsApp alert:', err);
      }
    }

    try {
      eventService.broadcast('call_tasks_updated', { taskId, taskType: ctx.taskType, patientName: ctx.patientName });
    } catch (_) {}

    return { taskId, ownerWaSent, mode };
  }

  async processDueRescheduledTasks(dbInstance?: any): Promise<number> {
    const db = dbInstance || (await dbManager.getConnection());
    const today = new Date().toISOString().slice(0, 10);
    const dueTasks = await db.all(
      `SELECT * FROM patient_call_tasks
       WHERE status = 'rescheduled'
         AND reschedule_date IS NOT NULL
         AND reschedule_date <= ?`,
      [today]
    ).catch(() => []);

    let triggered = 0;
    for (const task of dueTasks) {
      await db.run(
        `UPDATE patient_call_tasks
         SET status = 'pending', updated_at = CURRENT_TIMESTAMP, reschedule_date = NULL
         WHERE id = ?`,
        [task.id]
      ).catch(() => {});
      triggered++;
    }
    if (triggered > 0) {
      try { eventService.broadcast('call_tasks_updated', { rescheduled: triggered }); } catch (_) {}
      console.log('[NonWaFallback] Reactivated ' + triggered + ' rescheduled call tasks.');
    }
    return triggered;
  }
}

export const nonWaFallbackService = new NonWaFallbackService();