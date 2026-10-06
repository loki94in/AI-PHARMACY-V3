import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve({ sent: true })),
  initClient: jest.fn(() => Promise.resolve(true)),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isConnected: true, isReady: true, status: 'CONNECTED' })),
  shouldRouteToBusiness: jest.fn(() => false),
  hashMessageBody: jest.fn(() => 'mock-hash'),
  normalizeWhatsAppPhone: jest.fn((p: string) => p ? String(p).replace(/\D/g, '') : ''),
  isWhatsAppExplicitlyDisabled: jest.fn(() => Promise.resolve(false)),
  hasSavedSession: jest.fn(() => true),
  waitForWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  markWhatsAppActivity: jest.fn(),
  isPuppeteerDetachedError: jest.fn(() => false),
  setCurrentQr: jest.fn(),
  setIsReady: jest.fn(),
  destroyClient: jest.fn(() => Promise.resolve(undefined)),
  forceReconnect: jest.fn(() => Promise.resolve(undefined)),
  reconnectClient: jest.fn(() => Promise.resolve(undefined)),
  getChats: jest.fn(() => Promise.resolve([])),
  getChatMessages: jest.fn(() => Promise.resolve([])),
  getMessageMedia: jest.fn(() => Promise.resolve({ mimetype: 'image/jpeg', data: '' })),
  downloadMessageMediaById: jest.fn(() => Promise.resolve(undefined)),
  ensureWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  isWhatsAppAutoConnectAllowed: jest.fn(() => Promise.resolve(true)),
  checkPhoneWhatsAppRegistered: jest.fn(() => Promise.resolve('AVAILABLE')),
  ensureSessionHealth: jest.fn(() => Promise.resolve())
}));

jest.unstable_mockModule('../src/telegramBot.js', () => ({
  __esModule: true,
  telegramBotService: {
    sendDefaultNotification: jest.fn(() => Promise.resolve(true))
  }
}));

import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('Unified Mark Ready, Collection Reminders & POS Auto-Stop Flow', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markready-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    await db.run(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('pharmacy_name', 'Test Pharmacy')`);
    await db.run(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('quick_assist_auto_remind_master', 'true')`);
    await db.run(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('collection_reminder_window_start', '00:00')`);
    await db.run(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('collection_reminder_window_end', '23:59')`);

    // Add a medicine
    await db.run(`
      INSERT OR IGNORE INTO medicines (id, name, canonical_name, mrp, pack_size, dosage_form)
      VALUES (101, 'Metformin 500mg', 'metformin 500mg', 50, 10, 'Tablet')
    `);

    // Add inventory
    await db.run(`
      INSERT OR IGNORE INTO inventory_master (id, medicine_id, batch_no, expiry_date, quantity, mrp, unit_price)
      VALUES (201, 101, 'BATCH-M500', '2028-12-31', 100, 50, 5)
    `);

    const refillsRouter = (await import('../src/routes/refills.js')).default;
    const ordersRouter = (await import('../src/routes/orders.js')).default;
    const salesRouter = (await import('../src/routes/sales.js')).default;

    app = express();
    app.use(express.json());
    app.use('/api/refills', refillsRouter);
    app.use('/api/orders', ordersRouter);
    app.use('/api/sales', salesRouter);
  });

  afterAll(async () => {
    try {
      const { dbManager } = await import('../src/database/connection.js');
      await dbManager.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('1. Patient Refill: Mark Ready queues collection WhatsApp, arms auto_remind, and suppresses 60m duplicates', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    // Create a refill
    await db.run(`
      INSERT INTO patient_refills (
        id, patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, status, is_active, is_ready, auto_remind
      ) VALUES (501, 'Ramesh Gupta', '9876543210', 101, 30, date('now'), 'pending', 1, 0, 0)
    `);

    // Call mark-ready endpoint
    const res = await request(app)
      .post('/api/refills/patient/9876543210/mark-ready')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.whatsapp_queued).toBe(true);

    // Verify DB updated
    const updated = await db.get(`SELECT is_ready, auto_remind, reminder_status, last_collection_reminder_at FROM patient_refills WHERE id = 501`);
    expect(updated.is_ready).toBe(1);
    expect(updated.auto_remind).toBe(1);
    expect(updated.reminder_status).toBe('SENT');
    expect(updated.last_collection_reminder_at).toBeTruthy();

    // Immediate second click suppresses duplicate message
    const res2 = await request(app)
      .post('/api/refills/patient/9876543210/mark-ready')
      .expect(200);

    expect(res2.body.success).toBe(true);
    expect(res2.body.whatsapp_queued).toBe(false);
  });

  test('2. Special Order: Status Ready arms auto_remind = 1 and sets same-day reminder timestamp', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    // Create a special order
    const ins = await db.run(`
      INSERT INTO special_orders (
        store_id, product, requester, phone, qty, status, auto_remind
      ) VALUES (1, 'Metformin 500mg', 'Anita Sharma', '9123456780', 2, 'Pending', 0)
    `);
    const orderId = ins.lastID;

    // Transition to Ready
    const res = await request(app)
      .post(`/api/orders/${orderId}/status`)
      .send({ status: 'Ready' })
      .expect(200);

    expect(res.body.success).toBe(true);

    const ord = await db.get(`SELECT status, auto_remind, last_collection_reminder_at FROM special_orders WHERE id = ?`, [orderId]);
    expect(ord.status).toBe('Ready');
    expect(ord.auto_remind).toBe(1);
    expect(ord.last_collection_reminder_at).toBeTruthy();
  });

  test('3. Daily Worker: Skips same-day reminders; sends for yesterday items', async () => {
    const { runCollectionReminderCycle } = await import('../src/services/collectionReminderWorker.js');
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    // Cycle 1: Everything was reminded today, so it should queue 0 reminders
    const cycle1 = await runCollectionReminderCycle(true);
    expect(cycle1.status).toBe('completed');
    expect(cycle1.refillsQueued).toBe(0);
    expect(cycle1.ordersQueued).toBe(0);

    // Now artificially set last_collection_reminder_at to yesterday for refill #501
    await db.run(`UPDATE patient_refills SET last_collection_reminder_at = datetime('now', '-1 day') WHERE id = 501`);

    // Cycle 2: Refill #501 is eligible and should be queued
    const cycle2 = await runCollectionReminderCycle(true);
    expect(cycle2.status).toBe('completed');
    expect(cycle2.refillsQueued).toBe(1);
  });

  test('4. POS Bill Completion: Auto-stops reminders (auto_remind = 0, is_ready = 0, Fulfilled)', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    // Verify refill #501 has auto_remind = 1 before sale
    const beforeRefill = await db.get(`SELECT auto_remind, is_ready FROM patient_refills WHERE id = 501`);
    expect(beforeRefill.auto_remind).toBe(1);
    expect(beforeRefill.is_ready).toBe(1);

    // Bill the refill in POS
    const salePayload = {
      patient_name: 'Ramesh Gupta',
      patient_phone: '9876543210',
      doctor_name: 'Dr. Test Physician',
      items: [
        {
          medicine_id: 101,
          medicine_name: 'Metformin 500mg',
          batch_no: 'BATCH-M500',
          quantity: 1,
          qty: 1,
          unit_price: 5,
          unitPrice: 5,
          mrp: 50,
          inventory_id: 201
        }
      ],
      total: 50,
      paymentMedium: 'CASH',
      refill_ids: [501]
    };

    const res = await request(app)
      .post('/api/sales')
      .send(salePayload)
      .expect(200);

    expect(res.body.success).toBe(true);

    // Check refill #501: auto_remind must be 0 and is_ready must be 0
    const afterRefill = await db.get(`SELECT auto_remind, is_ready, last_collection_reminder_at FROM patient_refills WHERE id = 501`);
    expect(afterRefill.auto_remind).toBe(0);
    expect(afterRefill.is_ready).toBe(0);
    expect(afterRefill.last_collection_reminder_at).toBeNull();
  });
});
