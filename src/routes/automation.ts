import express from 'express';
import { dbManager } from '../database/connection.js';

import { AUTOMATION_CATALOG, getAutomationToggleStates } from '../services/automationCatalog.js';

const router = express.Router();

// List every known WhatsApp automation type with its current enabled state
router.get('/catalog', async (_req, res) => {
  try {
    const states = await getAutomationToggleStates();
    const result = AUTOMATION_CATALOG.map(entry => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      enabled: states[entry.id],
    }));
    res.json(result);
  } catch (err: any) {
    console.error('Failed to fetch automation catalog:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Toggle a single automation type on/off
router.post('/catalog/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body || {};
  const entry = AUTOMATION_CATALOG.find(e => e.id === id);
  if (!entry) {
    return res.status(404).json({ error: `Unknown automation id: ${id}` });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) is required' });
  }
  try {
    const db = await dbManager.getConnection();
    await db.run(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [entry.appSettingsKey, String(enabled)]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to toggle automation:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Merged live/recent WhatsApp send status for the Automation Hub header badge + popover
router.get('/hub-summary', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();

    const queueRows = await db.all(
      `SELECT id, type, target_name, number, message, status, error_message, sent_at, created_at, acknowledged, resolved_at
       FROM whatsapp_send_queue
       ORDER BY created_at DESC LIMIT 30`
    );
    const notificationRows = await db.all(
      `SELECT id, type, recipient_name, recipient_phone, message, status, error_message, created_at, reference_id, acknowledged, resolved_at
       FROM automation_notifications
       WHERE type = 'whatsapp' OR type LIKE 'whatsapp%' OR type LIKE '%whatsapp%' OR type LIKE '%order%' OR type LIKE '%refill%' OR type LIKE '%invoice%' OR type LIKE '%credit%'
       ORDER BY created_at DESC LIMIT 30`
    );

    const activity = [
      ...queueRows.map((r: any) => ({
        id: `q_${r.id}`,
        rawId: r.id,
        source: 'queue',
        automationType: r.type,
        targetName: r.target_name || null,
        phone: r.number || null,
        message: r.message || null,
        status: r.status,
        errorMessage: r.error_message || null,
        sentAt: r.sent_at || null,
        createdAt: r.created_at,
        acknowledged: Number(r.acknowledged || 0),
        resolvedAt: r.resolved_at || null,
      })),
      ...notificationRows.map((r: any) => ({
        id: `n_${r.id}`,
        rawId: r.id,
        source: 'notification',
        automationType: r.type,
        targetName: r.recipient_name || null,
        phone: r.recipient_phone || null,
        message: r.message || null,
        status: r.status,
        errorMessage: r.error_message || null,
        sentAt: null,
        createdAt: r.created_at,
        acknowledged: Number(r.acknowledged || 0),
        resolvedAt: r.resolved_at || null,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const sendingRow = queueRows.find((r: any) => r.status === 'sending');
    const pendingRow = [...queueRows].reverse().find((r: any) => ['pending', 'waiting'].includes(r.status));
    const activeSendingRow = sendingRow || pendingRow;
    const hasActiveSend = Boolean(activeSendingRow);
    
    // Count unacknowledged/unresolved failed messages
    const unresolvedFailures = activity.filter(a => String(a.status).startsWith('failed') && a.acknowledged === 0);
    const unresolvedFailuresCount = unresolvedFailures.length;

    let headline: 'sending' | 'failed' | 'idle' = 'idle';
    if (hasActiveSend) {
      headline = 'sending';
    } else if (unresolvedFailuresCount > 0) {
      headline = 'failed';
    }

    const activeSendingItem = activeSendingRow ? {
      id: activeSendingRow.id,
      targetName: activeSendingRow.target_name || activeSendingRow.number || 'Recipient',
      type: activeSendingRow.type,
      status: activeSendingRow.status,
      createdAt: activeSendingRow.created_at,
    } : null;

    res.json({
      headline,
      unresolvedFailuresCount,
      activeSendingItem,
      activity: activity.slice(0, 30)
    });
  } catch (err: any) {
    console.error('Failed to build automation hub summary:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Resolve / acknowledge failed WhatsApp automation(s) to dismiss persistent red failure badges
router.post('/resolve-failure', async (req, res) => {
  const { id, rawId, source, resolveAll } = req.body || {};
  try {
    const db = await dbManager.getConnection();
    const now = Date.now();

    if (resolveAll) {
      await db.run("UPDATE whatsapp_send_queue SET acknowledged = 1, resolved_at = ? WHERE status LIKE 'failed%' OR status LIKE 'skipped%' OR status = 'review_required'", [now]);
      await db.run("UPDATE automation_notifications SET acknowledged = 1, resolved_at = ? WHERE status LIKE 'failed%' OR status = 'error'", [now]);
    } else if (source === 'queue' || (typeof id === 'string' && id.startsWith('q_'))) {
      const qId = rawId || (typeof id === 'string' ? id.replace('q_', '') : id);
      await db.run("UPDATE whatsapp_send_queue SET acknowledged = 1, resolved_at = ? WHERE id = ?", [now, qId]);
      await db.run(
        "UPDATE automation_notifications SET acknowledged = 1, resolved_at = ? WHERE reference_id = ? OR reference_id = ? OR reference_id = ?",
        [now, `queue-${qId}`, `queue_${qId}`, String(qId)]
      );
    } else if (source === 'notification' || (typeof id === 'string' && id.startsWith('n_'))) {
      const nId = rawId || (typeof id === 'string' ? id.replace('n_', '') : id);
      const notifRow = await db.get("SELECT reference_id FROM automation_notifications WHERE id = ?", [nId]);
      await db.run("UPDATE automation_notifications SET acknowledged = 1, resolved_at = ? WHERE id = ?", [now, nId]);
      if (notifRow?.reference_id) {
        const refStr = String(notifRow.reference_id);
        const qId = refStr.startsWith('queue-') ? refStr.replace('queue-', '') : (refStr.startsWith('queue_') ? refStr.replace('queue_', '') : refStr);
        if (/^\d+$/.test(qId)) {
          await db.run("UPDATE whatsapp_send_queue SET acknowledged = 1, resolved_at = ? WHERE id = ?", [now, Number(qId)]).catch(() => {});
        }
      }
    } else if (rawId) {
      await db.run("UPDATE whatsapp_send_queue SET acknowledged = 1, resolved_at = ? WHERE id = ?", [now, rawId]);
      await db.run(
        "UPDATE automation_notifications SET acknowledged = 1, resolved_at = ? WHERE reference_id = ? OR reference_id = ? OR reference_id = ? OR id = ?",
        [now, `queue-${rawId}`, `queue_${rawId}`, String(rawId), rawId]
      );
    }

    const { eventService } = await import('../services/eventService.js');
    eventService.broadcast('automation_hub_updated', { type: 'resolved' });
    eventService.broadcast('wa_queue_updated', { type: 'resolved' });

    res.json({ success: true, message: 'Failure marked as resolved' });
  } catch (err: any) {
    console.error('Failed to resolve automation failure:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// List all automation notifications
router.get('/notifications', async (req, res) => {
  const { type, status, search, limit = 100 } = req.query;
  let db;
  try {
    db = await dbManager.getConnection();
    let query = 'SELECT * FROM automation_notifications WHERE 1=1';
    const params: any[] = [];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (recipient_name LIKE ? OR recipient_phone LIKE ? OR message LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Number(limit));

    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err: any) {
    console.error('Failed to fetch automation notifications:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

const SENT_STATUSES = ['sent', 'sent_manually', 'delivered'];
const phoneKey = (p: unknown) => String(p || '').replace(/\D/g, '').slice(-10);

// Daily notification summary. Without `days` it is the lean Quick Assist payload
// (counts + phones sent today). With `days=N` it also returns `log`: every row
// active in the last N local days plus all staged/snoozed rows, for the
// Daily Communications modal's day-grouped history.
router.get('/notifications/daily-summary', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const wantsLog = req.query.days !== undefined;
    const days = Math.min(30, Math.max(1, parseInt(String(req.query.days || '1'), 10) || 1));
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const windowStart = todayStart.getTime() - (days - 1) * 86400000;

    // created_at is UTC (CURRENT_TIMESTAMP or ISO 'Z'); resolved_at is either
    // Date.now() ms or a datetime('now','localtime') string. Normalise both to
    // epoch ms so day boundaries follow the shop's local calendar.
    const rows: Array<{
      id: number; type: string; recipient_name: string; recipient_phone: string; message: string;
      status: string; reference_id: string | null; error_message: string | null; activity_ms: number;
    }> = await db.all(`
      SELECT id, type, recipient_name, recipient_phone, message, status, reference_id, error_message,
             COALESCE(resolved_ms, created_ms) AS activity_ms
      FROM (
        SELECT *,
          CASE WHEN typeof(created_at) IN ('integer', 'real') THEN CAST(created_at AS INTEGER)
               ELSE CAST(strftime('%s', created_at) AS INTEGER) * 1000 END AS created_ms,
          CASE WHEN typeof(resolved_at) IN ('integer', 'real') THEN CAST(resolved_at AS INTEGER)
               WHEN resolved_at IS NOT NULL THEN CAST(strftime('%s', resolved_at, 'utc') AS INTEGER) * 1000 END AS resolved_ms
        FROM automation_notifications
      )
      WHERE COALESCE(resolved_ms, created_ms) >= ? OR status IN ('staged', 'snoozed')
      ORDER BY activity_ms DESC
      LIMIT 2000
    `, [windowStart]);

    // Identical text to the same number counts once — re-sends are not new messages.
    const sentToday = rows.filter(r => SENT_STATUSES.includes(r.status) && r.activity_ms >= todayStart.getTime());
    const sentTodayCount = new Set(sentToday.map(r => `${phoneKey(r.recipient_phone)}|${(r.message || '').trim()}`)).size;
    const phoneMap = new Map<string, { recipient_phone: string; recipient_name?: string; last_sent_at: string; message?: string; type?: string }>();
    for (const r of sentToday) {
      const key = phoneKey(r.recipient_phone);
      if (!key || phoneMap.has(key)) continue; // rows are newest-first
      phoneMap.set(key, {
        recipient_phone: r.recipient_phone,
        recipient_name: r.recipient_name,
        last_sent_at: new Date(r.activity_ms).toISOString(),
        message: r.message,
        type: r.type,
      });
    }

    res.json({
      success: true,
      sentTodayCount,
      stagedCount: rows.filter(r => r.status === 'staged').length,
      sentPhones: [...phoneMap.values()],
      ...(wantsLog ? { log: rows } : {})
    });
  } catch (err: any) {
    console.error('Failed to get daily notification summary:', err);
    res.status(500).json({ error: 'Failed to get daily notification summary: ' + err.message });
  }
});

// Snooze single notification by days (default +1 day)
router.post('/notifications/:id/snooze', async (req, res) => {
  const { id } = req.params;
  const days = Math.max(1, parseInt(req.body?.days || '1', 10));
  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT * FROM automation_notifications WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const snoozeUntilDate = new Date();
    snoozeUntilDate.setDate(snoozeUntilDate.getDate() + days);
    const snoozedUntilStr = snoozeUntilDate.toISOString().slice(0, 10);

    await db.run(
      `UPDATE automation_notifications 
       SET status = 'snoozed', 
           lifecycle_status = 'snoozed',
           snoozed_until = ?,
           error_message = ? 
       WHERE id = ?`,
      [snoozedUntilStr, `Snoozed for ${days} day(s) until ${snoozedUntilStr}`, id]
    );

    // If associated with patient_refills, shift next_refill_date by +days
    if (existing.reference_id && (existing.type === 'refill_collection' || existing.type === 'refill_reminder')) {
      const refIds = String(existing.reference_id).split(',').map((s: string) => Number(s.trim())).filter(Boolean);
      for (const refId of refIds) {
        await db.run(
          `UPDATE patient_refills 
           SET next_refill_date = DATE(COALESCE(next_refill_date, 'now'), ?),
               reminder_status = 'NOT_SENT'
           WHERE id = ?`,
          [`+${days} day`, refId]
        ).catch(() => {});
      }
    }

    const { eventService } = await import('../services/eventService.js');
    eventService.broadcast('automation_hub_updated', { type: 'snoozed', id });
    eventService.broadcast('refill_updated', { type: 'snoozed', id });

    res.json({ success: true, message: `Notification snoozed for ${days} day(s) until ${snoozedUntilStr}` });
  } catch (err: any) {
    console.error('Failed to snooze notification:', err);
    res.status(500).json({ error: 'Failed to snooze notification: ' + err.message });
  }
});

// Snooze group of notifications
router.post('/notifications/group/snooze', async (req, res) => {
  const { ids, days = 1 } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required' });
  }
  const snoozeDays = Math.max(1, parseInt(String(days), 10));

  try {
    const db = await dbManager.getConnection();
    const snoozeUntilDate = new Date();
    snoozeUntilDate.setDate(snoozeUntilDate.getDate() + snoozeDays);
    const snoozedUntilStr = snoozeUntilDate.toISOString().slice(0, 10);

    for (const notifId of ids) {
      const existing = await db.get('SELECT * FROM automation_notifications WHERE id = ?', [notifId]);
      if (!existing) continue;

      await db.run(
        `UPDATE automation_notifications 
         SET status = 'snoozed', 
             lifecycle_status = 'snoozed',
             snoozed_until = ?,
             error_message = ? 
         WHERE id = ?`,
        [snoozedUntilStr, `Snoozed for ${snoozeDays} day(s) until ${snoozedUntilStr}`, notifId]
      );

      if (existing.reference_id && (existing.type === 'refill_collection' || existing.type === 'refill_reminder')) {
        const refIds = String(existing.reference_id).split(',').map((s: string) => Number(s.trim())).filter(Boolean);
        for (const refId of refIds) {
          await db.run(
            `UPDATE patient_refills 
             SET next_refill_date = DATE(COALESCE(next_refill_date, 'now'), ?),
                 reminder_status = 'NOT_SENT'
             WHERE id = ?`,
            [`+${snoozeDays} day`, refId]
          ).catch(() => {});
        }
      }
    }

    const { eventService } = await import('../services/eventService.js');
    eventService.broadcast('automation_hub_updated', { type: 'group_snoozed', count: ids.length });
    eventService.broadcast('refill_updated', { type: 'group_snoozed', count: ids.length });

    res.json({ success: true, message: `Snoozed ${ids.length} notification(s) for ${snoozeDays} day(s) until ${snoozedUntilStr}` });
  } catch (err: any) {
    console.error('Failed to batch snooze notifications:', err);
    res.status(500).json({ error: 'Failed to batch snooze: ' + err.message });
  }
});

// Snooze all reminders for a specific patient phone/name (from CRM / Quick Assist)
router.post('/notifications/snooze-patient', async (req, res) => {
  const { patient_phone, patient_name, days = 1 } = req.body;
  const snoozeDays = Math.max(1, parseInt(String(days), 10));

  if (!patient_phone && !patient_name) {
    return res.status(400).json({ error: 'patient_phone or patient_name is required' });
  }

  try {
    const db = await dbManager.getConnection();
    const snoozeUntilDate = new Date();
    snoozeUntilDate.setDate(snoozeUntilDate.getDate() + snoozeDays);
    const snoozedUntilStr = snoozeUntilDate.toISOString().slice(0, 10);

    // Update notifications
    await db.run(
      `UPDATE automation_notifications 
       SET status = 'snoozed', 
           lifecycle_status = 'snoozed',
           snoozed_until = ?,
           error_message = ? 
       WHERE (recipient_phone = ? OR recipient_name = ?) AND status IN ('staged', 'snoozed')`,
      [snoozedUntilStr, `Snoozed for ${snoozeDays} day(s) until ${snoozedUntilStr}`, patient_phone || '', patient_name || '']
    );

    // Shift next_refill_date on patient_refills
    await db.run(
      `UPDATE patient_refills 
       SET next_refill_date = DATE(COALESCE(next_refill_date, 'now'), ?),
           reminder_status = 'NOT_SENT'
       WHERE (patient_phone = ? OR patient_name = ?) AND is_active = 1`,
      [`+${snoozeDays} day`, patient_phone || '', patient_name || '']
    );

    const { eventService } = await import('../services/eventService.js');
    eventService.broadcast('automation_hub_updated', { type: 'patient_snoozed', patient_phone });
    eventService.broadcast('refill_updated', { type: 'patient_snoozed', patient_phone });

    res.json({ success: true, message: `Refill reminder snoozed for ${snoozeDays} day(s) until ${snoozedUntilStr}` });
  } catch (err: any) {
    console.error('Failed to snooze patient refills:', err);
    res.status(500).json({ error: 'Failed to snooze patient refills: ' + err.message });
  }
});

// Retry sending a notification
router.post('/notifications/:id/retry', async (req, res) => {
  const { id } = req.params;
  try {
    const { messagingQueue } = await import('../services/messagingQueue.js');
    const success = await messagingQueue.retryMessage(Number(id));
    if (success) {
      res.json({ success: true, message: 'Notification marked for retry in background queue' });
    } else {
      res.status(400).json({ error: 'Failed to queue message for retry. Message might not be in failed status.' });
    }
  } catch (err: any) {
    console.error('Failed to retry notification:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Cancel / dismiss a notification in queue or staged
router.post('/notifications/:id/cancel', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT * FROM automation_notifications WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await db.run(
      'UPDATE automation_notifications SET status = "cancelled", lifecycle_status = "cancelled" WHERE id = ?',
      [id]
    );

    // If this was a refill staged notification, mark the referenced refills as notified so background sync does not immediately re-stage them
    if (existing.reference_id && (existing.type === 'refill_collection' || existing.type === 'refill_reminder')) {
      const refIds = String(existing.reference_id).split(',').map((s: string) => Number(s.trim())).filter(Boolean);
      for (const refId of refIds) {
        await db.run(
          "UPDATE patient_refills SET status = 'notified', reminder_status = 'SENT', reminder_sent_at = datetime('now') WHERE id = ?",
          [refId]
        ).catch(() => {});
      }
    }

    try {
      const { messagingQueue } = await import('../services/messagingQueue.js');
      await messagingQueue.cancelMessage(Number(id));
    } catch (_) {}

    res.json({ success: true, message: 'Notification successfully cancelled / dismissed' });
  } catch (err: any) {
    console.error('Failed to cancel notification:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Mark notification as sent manually
router.post('/notifications/:id/manual', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    const existing = await db.get('SELECT * FROM automation_notifications WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await db.run(
      'UPDATE automation_notifications SET status = "sent_manually", resolved_at = datetime("now", "localtime"), error_message = NULL WHERE id = ?',
      [id]
    );

    // If this was a refill staged notification, mark the referenced refills as notified so background sync does not immediately re-stage them
    if (existing.reference_id && (existing.type === 'refill_collection' || existing.type === 'refill_reminder')) {
      const refIds = String(existing.reference_id).split(',').map((s: string) => Number(s.trim())).filter(Boolean);
      for (const refId of refIds) {
        await db.run(
          "UPDATE patient_refills SET status = 'notified', reminder_status = 'SENT', reminder_sent_at = datetime('now') WHERE id = ?",
          [refId]
        ).catch(() => {});
      }
    }

    res.json({ success: true, message: 'Notification marked as sent manually' });
  } catch (err: any) {
    console.error('Failed to mark manual status:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// User-clicked Send / Re-send (optionally edited) from the Daily Communications
// log. Manual-only patient messaging: nothing but a pharmacist's click calls this.
// The row goes to 'queued'; the queue worker flips it to 'sent' on real delivery.
router.post('/notifications/:id/send', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT * FROM automation_notifications WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Notification not found' });

    const { normalizeWhatsAppPhone } = await import('../whatsappClient.js');
    const { whatsappQueueWorker } = await import('../services/whatsappQueueWorker.js');
    const message = String(req.body?.message ?? row.message ?? '').trim();
    const phone = normalizeWhatsAppPhone(String(req.body?.phone ?? row.recipient_phone ?? ''));
    if (!message) return res.status(400).json({ error: 'Message text is empty' });
    if (!phone || phone.length < 10) return res.status(400).json({ error: 'A valid 10-digit WhatsApp number is required' });

    const queueId = await whatsappQueueWorker.enqueue(
      phone, message, row.type || 'crm_notification', row.recipient_name || undefined,
      undefined, undefined, undefined, { skipDedupe: true }
    );

    const edited = message !== String(row.message || '').trim() || phoneKey(phone) !== phoneKey(row.recipient_phone);
    let notificationId = row.id;
    if (edited && SENT_STATUSES.includes(row.status)) {
      // The original send stays in the log; edited text is a new message.
      const ins = await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id, lifecycle_status, resolved_at)
         VALUES (?, ?, ?, ?, 'queued', ?, 'sent', ?)`,
        [row.type, row.recipient_name, phone, message, row.reference_id, Date.now()]
      );
      notificationId = ins.lastID;
    } else {
      await db.run(
        `UPDATE automation_notifications
         SET recipient_phone = ?, message = ?, status = 'queued', lifecycle_status = 'sent', error_message = NULL, resolved_at = ?
         WHERE id = ?`,
        [phone, message, Date.now(), row.id]
      );
    }

    // Same refill hand-off as /manual so background sync does not re-stage it
    if ((row.status === 'staged' || row.status === 'snoozed') && row.reference_id && (row.type === 'refill_collection' || row.type === 'refill_reminder')) {
      const refIds = String(row.reference_id).split(',').map((s: string) => Number(s.trim())).filter(Boolean);
      for (const refId of refIds) {
        await db.run(
          "UPDATE patient_refills SET status = 'notified', reminder_status = 'SENT', reminder_sent_at = datetime('now') WHERE id = ?",
          [refId]
        ).catch(() => {});
      }
    }

    res.json({ success: true, queueId, notificationId, edited });
  } catch (err: any) {
    console.error('Failed to send notification:', err);
    res.status(500).json({ error: 'Failed to send notification: ' + err.message });
  }
});

// Convert special order to recurring refill
router.post('/convert-to-refill', async (req, res) => {
  const { orderId, refillIntervalDays } = req.body;
  if (!orderId || !refillIntervalDays) {
    return res.status(400).json({ error: 'orderId and refillIntervalDays are required' });
  }
  try {
    const { orderFulfillmentService } = await import('../services/orderFulfillmentService.js');
    const result = await orderFulfillmentService.convertToRecurringRefill(
      Number(orderId),
      Number(refillIntervalDays)
    );
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to convert to refill: ' + err.message });
  }
});

export default router;
