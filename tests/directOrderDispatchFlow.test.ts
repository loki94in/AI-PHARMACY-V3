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

describe('Direct Order Detection, Duplicate-Safe Distributor Reminders & Delivery Boy Dispatch Flow', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-order-dispatch-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    await db.run(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('shop_name', 'Test AI Pharmacy')`);
    await db.run(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('automation_enabled', 'true')`);
    await db.run(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('trigger_dispatch_reminder_enabled', 'true')`);
    await db.run(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('trigger_afternoon_dispatch_reminder_enabled', 'true')`);

    // Create delivery boys
    await db.run(`
      INSERT INTO delivery_boys (id, name, whatsapp_number, is_active)
      VALUES (1, 'Ramesh Delivery', '9876543210', 1),
             (2, 'Suresh Runner', '9876543211', 1)
    `);

    // Create distributors:
    // Dist 1 has explicit delivery boy mapped (Ramesh)
    // Dist 2 has no delivery boy mapped
    await db.run(`
      INSERT INTO distributors (id, name, phone, delivery_boy_id)
      VALUES (10, 'Apollo Medico Wholesale', '9123456789', 1),
             (20, 'Balaji Pharma Agencies', '9123456780', NULL)
    `);

    const dispatchRouter = (await import('../src/routes/dispatch.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/dispatch', dispatchRouter);
  });

  afterAll(async () => {
    try {
      const { dbManager } = await import('../src/database/connection.js');
      await dbManager.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('1. Smart Delivery Boy Resolver: maps explicit delivery boy or falls back to active store boy', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const { resolveDeliveryBoyForDistributor } = await import('../src/services/distributorDispatchReminderWorker.js');

    // For distributor 10 (mapped to Ramesh)
    const boy1 = await resolveDeliveryBoyForDistributor(db, 10, 'Apollo Medico Wholesale');
    expect(boy1.delivery_boy_id).toBe(1);
    expect(boy1.name).toBe('Ramesh Delivery');
    expect(boy1.phone).toBe('9876543210');

    // For distributor 20 (unmapped, should fallback to active store boy Ramesh)
    const boy2 = await resolveDeliveryBoyForDistributor(db, 20, 'Balaji Pharma Agencies');
    expect(boy2.delivery_boy_id).toBe(1);
    expect(boy2.name).toBe('Ramesh Delivery');
  });

  test('2. Strict Today-Only Gate: parses today dates and rejects past/yesterday dates', async () => {
    const { orderDayIso } = await import('../src/services/pharmarackOrderSyncService.js');

    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    // Valid ISO today
    expect(orderDayIso(`${todayIso}T10:30:00`)).toBe(todayIso);

    // Valid DD/MM/YYYY today
    const dmyToday = `${pad(today.getDate())}/${pad(today.getMonth() + 1)}/${today.getFullYear()}`;
    expect(orderDayIso(dmyToday)).toBe(todayIso);

    // Past date (yesterday)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayIso = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
    expect(orderDayIso(yesterdayIso)).toBe(yesterdayIso);
    expect(orderDayIso(yesterdayIso)).not.toBe(todayIso);
  });

  test('3. Auto-Add Direct Order Distributor & Auto-Remind when not sent today', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const { syncTodayActiveDistributors } = await import('../src/services/distributorDispatchReminderWorker.js');
    const { notificationService } = await import('../src/services/notificationService.js');

    const todayStr = new Date().toISOString().split('T')[0];

    // Simulate direct order placed on portal for Apollo Medico Wholesale
    await db.run(
      `INSERT INTO pharmarack_placed_orders (order_date, store_id, store_name, items_json, placed_at, batch_sent)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [todayStr, 10, 'Apollo Medico Wholesale', JSON.stringify([{ productName: 'Dolo 650', qty: 10 }]), Date.now()]
    );

    // Sync active distributors
    const reminders = await syncTodayActiveDistributors();
    const apolloRow = reminders.find((r: any) => r.distributor_name === 'Apollo Medico Wholesale');

    expect(apolloRow).toBeDefined();
    expect(apolloRow.delivery_boy_id).toBe(1);
    expect(apolloRow.status).toBe('Pending');

    // Reminder was NOT sent yet today -> Auto-send reminder to distributor
    const sent = await notificationService.sendDistributorDispatchReminder(apolloRow.id, undefined, undefined, { orderNos: ['PR-1001'] });
    expect(sent).toBe(true);

    // Verify WhatsApp queue has the message
    const queuedItem = await db.get(
      `SELECT * FROM whatsapp_send_queue WHERE type = 'distributor_dispatch_reminder' AND target_name = 'Apollo Medico Wholesale' ORDER BY id DESC LIMIT 1`
    );
    expect(queuedItem).toBeDefined();
    expect(queuedItem.target_name).toBe('Apollo Medico Wholesale');
    expect(queuedItem.message).toContain("today's order");

    // Last reminded timestamp recorded
    const updatedReminder = await db.get("SELECT status, last_reminded_at FROM distributor_dispatch_reminders WHERE id = ?", [apolloRow.id]);
    expect(updatedReminder.last_reminded_at).toBeTruthy();
  });

  test('4. Delivery Boy Consolidated Dispatch: queues updated pickup list with 15m duplicate protection', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const { notificationService } = await import('../src/services/notificationService.js');
    const { syncTodayActiveDistributors } = await import('../src/services/distributorDispatchReminderWorker.js');

    const reminders = await syncTodayActiveDistributors();
    const apolloRow = reminders.find((r: any) => r.distributor_name === 'Apollo Medico Wholesale');

    // Send dispatch to delivery boy
    const res1 = await notificationService.sendConsolidatedDeliveryBoyDispatch([apolloRow]);
    expect(res1.ok).toBe(true);

    const queuedBoyMsg = await db.get(
      `SELECT * FROM whatsapp_send_queue WHERE type = 'afternoon_delivery_boy_dispatch' AND number = '9876543210' ORDER BY id DESC LIMIT 1`
    );
    expect(queuedBoyMsg).toBeDefined();
    expect(queuedBoyMsg.message).toContain('DISPATCH & COLLECTION LIST');
    expect(queuedBoyMsg.message).toContain('Apollo Medico Wholesale');

    // Immediate second call should be safely deduplicated
    const res2 = await notificationService.sendConsolidatedDeliveryBoyDispatch([apolloRow]);
    expect(res2.ok).toBe(true);

    const count = await db.get(
      `SELECT COUNT(*) as total FROM whatsapp_send_queue WHERE type = 'afternoon_delivery_boy_dispatch' AND number = '9876543210'`
    );
    expect(count.total).toBe(1); // deduplicated within 15 minutes!
  });

  test('5. Human-in-the-Loop: Pharmacist can re-assign delivery boy in /dispatch endpoint', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    const reminder = await db.get("SELECT id FROM distributor_dispatch_reminders WHERE distributor_name = 'Apollo Medico Wholesale' LIMIT 1");
    expect(reminder).toBeDefined();

    // Reassign to Suresh Runner (ID 2)
    const res = await request(app)
      .put(`/api/dispatch/distributor-reminders/${reminder.id}/status`)
      .send({ delivery_boy_id: 2, status: 'Dispatched' });

    expect(res.status).toBe(200);

    const updated = await db.get("SELECT delivery_boy_id FROM distributor_dispatch_reminders WHERE id = ?", [reminder.id]);
    expect(updated.delivery_boy_id).toBe(2);
  });
});
