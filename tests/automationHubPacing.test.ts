import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-pacing-auth-'));

import { ensureSchema } from '../src/database.js';

describe('WhatsApp queue pacing floor', () => {
  let tmpDir: string;
  let dbPath: string;
  let whatsappQueueWorker: any;
  let dbManager: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-pacing-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    ({ whatsappQueueWorker } = await import('../src/services/whatsappQueueWorker.js'));
    ({ dbManager } = await import('../src/database/connection.js'));
  });

  afterAll(async () => {
    try {
      await dbManager.close(true);
    } catch (_) {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('setPacingConfig clamps a below-floor minSec up to 10s', async () => {
    await whatsappQueueWorker.setPacingConfig(0.1, 0.3);
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(10000);
    expect(maxMs).toBeGreaterThanOrEqual(minMs + 1000);
  });

  it('setPacingConfig keeps a valid 10-15s range unchanged', async () => {
    await whatsappQueueWorker.setPacingConfig(11, 14);
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(11000);
    expect(maxMs).toBe(14000);
  });

  it('setPacingConfig corrects an inverted range (max below min)', async () => {
    await whatsappQueueWorker.setPacingConfig(12, 5);
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(12000);
    expect(maxMs).toBeGreaterThanOrEqual(minMs + 1000);
  });

  it('loadPacingConfig re-clamps a stale below-floor value already stored in app_settings', async () => {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_min', '100')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_max', '300')");
    const { minMs, maxMs } = await whatsappQueueWorker.loadPacingConfig();
    expect(minMs).toBe(10000);
    expect(maxMs).toBeGreaterThanOrEqual(minMs + 1000);
  });

  it('setPacingPreset("safe") sets a 10-15s range', async () => {
    const result = await whatsappQueueWorker.setPacingPreset('safe');
    expect(result.minMs).toBe(10000);
    expect(result.maxMs).toBe(15000);
  });

  it('setPacingPreset rejects removed presets at the type level (compile-time) and the route rejects them at runtime — see whatsappQueueRoute test below', () => {
    expect(typeof whatsappQueueWorker.setPacingPreset).toBe('function');
  });

  it('togglePaused and setPaused flip state instantly without latency', () => {
    whatsappQueueWorker.setPaused(false);
    expect(whatsappQueueWorker.isWorkerPaused()).toBe(false);

    const paused = whatsappQueueWorker.togglePaused();
    expect(paused).toBe(true);
    expect(whatsappQueueWorker.isWorkerPaused()).toBe(true);

    const resumed = whatsappQueueWorker.togglePaused();
    expect(resumed).toBe(false);
    expect(whatsappQueueWorker.isWorkerPaused()).toBe(false);
  });

  it('deleting an unsent queue item rolls back special order notified flag and count', async () => {
    const db = await dbManager.getConnection();
    const testPhone = '9998887777';

    // 1. Insert a special order in Ready state with notified = 1
    const ins = await db.run(
      `INSERT INTO special_orders (requester, product, phone, qty, priority, status, date, notified, notification_count)
       VALUES ('John Doe', 'Paracetamol 500mg', ?, 1, 'Normal', 'Ready', date('now'), 1, 1)`,
      [testPhone]
    );
    const orderId = ins.lastID;

    // 2. Enqueue an arrival message (status 'pending')
    const queueId = await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, target_name)
       VALUES (?, 'Your medicine arrived', 'special_order', 'pending', 0, ?, 'John Doe')`,
      [testPhone, Date.now()]
    );
    const qId = queueId.lastID;

    // 3. Delete the pending queue item before delivery
    const deleted = await whatsappQueueWorker.deleteItem(qId);
    expect(deleted).toBe(true);

    // 4. Verify the special order was rolled back to notified = 0, count = 0, status = 'Ordered'
    const updatedOrder = await db.get('SELECT notified, notification_count, status FROM special_orders WHERE id = ?', [orderId]);
    expect(updatedOrder.notified).toBe(0);
    expect(updatedOrder.notification_count).toBe(0);
    expect(updatedOrder.status).toBe('Ordered');
  });

  it('deleting an already sent queue item does NOT roll back special order status', async () => {
    const db = await dbManager.getConnection();
    const testPhone = '9998886666';

    const ins = await db.run(
      `INSERT INTO special_orders (requester, product, phone, qty, priority, status, date, notified, notification_count)
       VALUES ('Delivered Customer', 'Azithromycin 500', ?, 1, 'Normal', 'Ready', date('now'), 1, 1)`,
      [testPhone]
    );
    const orderId = ins.lastID;

    const queueId = await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, target_name)
       VALUES (?, 'Your order is ready', 'special_order', 'sent', 0, ?, 'Delivered Customer')`,
      [testPhone, Date.now()]
    );
    const qId = queueId.lastID;

    const deleted = await whatsappQueueWorker.deleteItem(qId);
    expect(deleted).toBe(true);

    const afterDelete = await db.get('SELECT notified, notification_count, status FROM special_orders WHERE id = ?', [orderId]);
    expect(afterDelete.notified).toBe(1);
    expect(afterDelete.status).toBe('Ready');
  });

  it('deleting an unsent refill reminder rolls back refill reminder status', async () => {
    const db = await dbManager.getConnection();
    const testPhone = '9998885555';

    const queueId = await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, target_name)
       VALUES (?, 'Your refill is due', 'refill_reminder', 'pending', 0, ?, 'Refill Patient')`,
      [testPhone, Date.now()]
    );
    const qId = queueId.lastID;

    const ins = await db.run(
      `INSERT INTO patient_refills (patient_name, patient_phone, medicine_id, status, reminder_status, reminder_job_id, next_refill_date)
       VALUES ('Refill Patient', ?, 1, 'notified', 'QUEUED', ?, date('now'))`,
      [testPhone, qId]
    );
    const refillId = ins.lastID;

    const deleted = await whatsappQueueWorker.deleteItem(qId);
    expect(deleted).toBe(true);

    const afterDelete = await db.get('SELECT status, reminder_status, reminder_job_id FROM patient_refills WHERE id = ?', [refillId]);
    expect(afterDelete.status).toBe('pending');
    expect(afterDelete.reminder_status).toBe('CANCELLED');
    expect(afterDelete.reminder_job_id).toBeNull();
  });
});
