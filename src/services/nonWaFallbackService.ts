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
  taskType: 'refill' | 'credit' | 'special_order';
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

  private async resolveDisplayPhone(db: any, phone: string | undefined): Promise<string> {
    if (!phone) return 'N/A';
    let raw = String(phone).trim();
    if (raw.includes('@lid')) {
      const chatRow = await db.get('SELECT resolved_number FROM whatsapp_chats WHERE id = ?', [raw]).catch(() => null);
      if (chatRow?.resolved_number) {
        raw = String(chatRow.resolved_number);
      }
    }
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length >= 10) return digits.slice(-10);
    return raw || phone;
  }

  private buildOwnerAlertMessage(ctx: FallbackContext, storeName: string): string {
    const typeEmoji = ctx.taskType === 'refill' ? '\u{1F48A}' : (ctx.taskType === 'special_order' ? '\u{1F4E6}' : '\u{1F4B0}');
    const typeLabel = ctx.taskType === 'refill' ? 'REFILL DUE' : (ctx.taskType === 'special_order' ? 'SPECIAL ORDER READY' : 'CREDIT REMINDER');
    const actionLabel = ctx.taskType === 'refill'
      ? 'their refill & collection'
      : (ctx.taskType === 'special_order' ? 'order arrival & collection' : 'payment for outstanding dues');
    return (
      '\u{1F4DE} *CALL TASK: ' + typeLabel + ' (Patient Not on WhatsApp)*\n\n' +
      typeEmoji + ' *Patient:* ' + ctx.patientName + '\n' +
      '\u{1F4F1} *Phone:* ' + (ctx.patientPhone || 'N/A') + '\n\n' +
      '\u{1F4CB} *Details:*\n' + ctx.details + '\n\n' +
      '\u26A0\uFE0F This patient does not have WhatsApp — automatic message was not delivered.\n' +
      'Please call them directly to confirm ' + actionLabel + '.\n\n' +
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

    const cleanDisplayPhone = await this.resolveDisplayPhone(db, ctx.patientPhone);
    const resolvedCtx: FallbackContext = { ...ctx, patientPhone: cleanDisplayPhone };

    // Auto-enrich details with all medicines for this patient
    let enrichedDetails = resolvedCtx.details;
    let medicinesList: Array<{ name: string; qty: number; date?: string }> = [];

    if (resolvedCtx.taskType === 'refill') {
      try {
        const refillRows = await db.all(
          `SELECT pr.id, pr.medicine_name, pr.quantity_needed, pr.next_refill_date, m.name as m_name
           FROM patient_refills pr
           LEFT JOIN medicines m ON pr.medicine_id = m.id
           WHERE (
             (pr.patient_phone IS NOT NULL AND (pr.patient_phone LIKE ? OR pr.patient_phone = ?))
             OR (pr.patient_name IS NOT NULL AND LOWER(TRIM(pr.patient_name)) = LOWER(TRIM(?)))
           )
           AND pr.is_active = 1
           AND pr.status IN ('pending', 'notified', 'staged')
           ORDER BY pr.id ASC`,
          [`%${resolvedCtx.patientPhone.slice(-10)}`, resolvedCtx.patientPhone, resolvedCtx.patientName]
        );

        if (refillRows && refillRows.length > 0) {
          medicinesList = refillRows.map((r: any) => ({
            name: r.medicine_name || r.m_name || 'Medicine',
            qty: Number(r.quantity_needed || 1),
            date: r.next_refill_date
          }));
          const medLines = medicinesList.map((m, idx) => `${idx + 1}. ${m.name} × ${m.qty}`).join('\n');
          enrichedDetails = `Medicines Due (${medicinesList.length}):\n${medLines}`;
        }
      } catch (rErr) {
        console.warn('[NonWaFallback] Refill enrichment error:', rErr);
      }
    } else if (resolvedCtx.taskType === 'special_order' || resolvedCtx.detailsJson?.type === 'special_order') {
      try {
        const orderRows = await db.all(
          `SELECT id, product, medicine_name, qty, status
           FROM special_orders
           WHERE (
             (phone IS NOT NULL AND (phone LIKE ? OR phone = ?))
             OR (requester IS NOT NULL AND LOWER(TRIM(requester)) = LOWER(TRIM(?)))
           )
           AND status IN ('Ready', 'ORDER_READY_FOR_PICKUP', 'Pending', 'Confirmed')
           ORDER BY id ASC`,
          [`%${resolvedCtx.patientPhone.slice(-10)}`, resolvedCtx.patientPhone, resolvedCtx.patientName]
        );

        if (orderRows && orderRows.length > 0) {
          medicinesList = orderRows.map((r: any) => ({
            name: r.product || r.medicine_name || 'Special Order Item',
            qty: Number(r.qty || 1)
          }));
          const medLines = medicinesList.map((m, idx) => `${idx + 1}. ${m.name} × ${m.qty}`).join('\n');
          enrichedDetails = `Special Order Items (${medicinesList.length}):\n${medLines}`;
        }
      } catch (oErr) {
        console.warn('[NonWaFallback] Special order enrichment error:', oErr);
      }
    }

    resolvedCtx.details = enrichedDetails;
    if (medicinesList.length > 0) {
      resolvedCtx.detailsJson = {
        ...(resolvedCtx.detailsJson || {}),
        medicines: medicinesList,
        totalMeds: medicinesList.length
      };
    }

    // Dedup: don't create duplicate pending task for same patient+type within 24h
    const recentTask = await db.get(
      `SELECT id FROM patient_call_tasks
       WHERE task_type = ? AND patient_phone = ?
         AND status = 'pending'
         AND created_at > datetime('now', '-24 hours')
       LIMIT 1`,
      [resolvedCtx.taskType, resolvedCtx.patientPhone]
    ).catch(() => null);

    let taskId: number | null = recentTask?.id ?? null;

    if (!recentTask && (mode === 'both' || mode === 'board')) {
      try {
        const result = await db.run(
          `INSERT INTO patient_call_tasks
             (task_type, patient_name, patient_phone, reference_id, details_json, status, owner_wa_sent)
           VALUES (?, ?, ?, ?, ?, 'pending', 0)`,
          [
            resolvedCtx.taskType,
            resolvedCtx.patientName,
            resolvedCtx.patientPhone,
            resolvedCtx.referenceId || null,
            JSON.stringify(resolvedCtx.detailsJson ?? { details: resolvedCtx.details })
          ]
        );
        taskId = result?.lastID ?? null;
        console.log('[NonWaFallback] Created call task #' + taskId + ' for ' + resolvedCtx.patientName + ' (' + resolvedCtx.taskType + ')');
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
            const alertMsg = this.buildOwnerAlertMessage(resolvedCtx, storeName);
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