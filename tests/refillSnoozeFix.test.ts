import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve({ sent: true })),
  initClient: jest.fn(() => Promise.resolve(true)),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isConnected: true, status: 'CONNECTED' })),
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

import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('Refill Snooze Date Fix Integration Tests', () => {
  jest.setTimeout(60000);
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snooze-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    db = await dbManager.getConnection();

    // Seed test medicine
    await db.run(
      `INSERT OR IGNORE INTO medicines (id, name, sell_price, mrp, packaging, pack_size) 
       VALUES (99901, 'TELMISARTAN 40MG', 50.0, 60.0, '10 Tablets', '10')`
    );

    app = express();
    app.use(express.json());

    const { default: automationRouter } = await import('../src/routes/automation.js');
    const { default: refillsRouter } = await import('../src/routes/refills.js');
    app.use('/api/automation', automationRouter);
    app.use('/api/refills', refillsRouter);
  });

  afterAll(async () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { }
  });

  test('snooze-patient postpones future next_refill_date by +1 day instead of clobbering to tomorrow', async () => {
    // 1. Insert patient with future due date (e.g. 2026-11-20)
    await db.run(
      `INSERT INTO patient_refills (patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, reminder_status, is_active)
       VALUES ('Future Patient', '9888888881', 99901, 30, '2026-11-20', 'NOT_SENT', 1)`
    );

    // 2. Call snooze-patient with days: 1
    const res = await request(app)
      .post('/api/automation/notifications/snooze-patient')
      .send({ patient_name: 'Future Patient', patient_phone: '9888888881', days: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 3. Verify next_refill_date advanced to 2026-11-21
    const row = await db.get(
      'SELECT next_refill_date, reminder_status FROM patient_refills WHERE patient_phone = ?',
      ['9888888881']
    );
    expect(row.next_refill_date.slice(0, 10)).toBe('2026-11-21');
    expect(row.reminder_status).toBe('SNOOZED');

    // 4. Verify a snoozed record exists in automation_notifications
    const notif = await db.get(
      'SELECT status, snoozed_until FROM automation_notifications WHERE recipient_phone = ?',
      ['9888888881']
    );
    expect(notif).toBeDefined();
    expect(notif.status).toBe('snoozed');
  });

  test('snooze-patient on overdue patient sets date to tomorrow', async () => {
    // 1. Insert patient with overdue due date (2026-10-01)
    await db.run(
      `INSERT INTO patient_refills (patient_name, patient_phone, medicine_id, refill_interval_days, next_refill_date, reminder_status, is_active)
       VALUES ('Overdue Patient', '9888888882', 99901, 30, '2026-10-01', 'NOT_SENT', 1)`
    );

    // 2. Call snooze-patient with days: 1
    const res = await request(app)
      .post('/api/automation/notifications/snooze-patient')
      .send({ patient_name: 'Overdue Patient', patient_phone: '9888888882', days: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 3. Verify date is set to tomorrow
    const expectedTomorrow = await db.get("SELECT DATE('now', 'localtime', '+1 day') as d");
    const row = await db.get(
      'SELECT next_refill_date, reminder_status FROM patient_refills WHERE patient_phone = ?',
      ['9888888882']
    );
    expect(row.next_refill_date.slice(0, 10)).toBe(expectedTomorrow.d);
    expect(row.reminder_status).toBe('SNOOZED');
  });

  test('/refills/panel returns group.reminder_status as SNOOZED', async () => {
    const res = await request(app).get('/api/refills/panel');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const snoozedPat = res.body.find((p: any) => p.patient_phone === '9888888881' || p.patient_phone === '9888888882');
    expect(snoozedPat).toBeDefined();
    expect(snoozedPat.reminder_status).toBe('SNOOZED');
  });
});
