import { jest } from '@jest/globals';

// The sales router loads whatsappQueueWorker, which imports many whatsappClient exports:
// mock every one (same pattern as tests/refillCart.test.ts) so nothing launches Chrome.
jest.unstable_mockModule('../src/whatsappClient.js', () => {
  const m: Record<string, unknown> = { __esModule: true, currentQr: null, isReady: false };
  for (const fn of ['hasSavedSession', 'isProductionAppRunning', 'isWhatsAppAutoConnectAllowed', 'isPuppeteerDetachedError',
    'setLifecycleProgress', 'getWhatsAppReadiness', 'setLoginWindowActive', 'isWhatsAppLoginWindowActive', 'markWhatsAppActivity',
    'setCurrentQr', 'setIsReady', 'shouldRouteToBusiness', 'patchWWebJSInternals']) m[fn] = jest.fn(() => false);
  for (const fn of ['isWhatsAppExplicitlyDisabled', 'getWhatsAppStatus', 'waitForWhatsAppReady', 'ensureWhatsAppReady',
    'ensureSessionHealth', 'waitForChatStoreReady', 'initClient', 'prewarmWhatsApp', 'destroyClient', 'forceReconnect',
    'reconnectClient', 'sendMessage', 'getChats', 'getChatMessages', 'getMessageMedia', 'downloadMessageMediaById',
    'downloadMessageMediaReliably', 'checkPhoneWhatsAppRegistered', 'resolveChatSession']) m[fn] = jest.fn(async () => undefined);
  m.normalizeWhatsAppPhone = jest.fn((p: string) => (p ? String(p).replace(/\D/g, '') : ''));
  m.hashMessageBody = jest.fn(() => 'mock-hash');
  return m;
});

jest.unstable_mockModule('../src/telegramBot.js', () => ({
  __esModule: true,
  telegramBotService: { sendDefaultNotification: jest.fn(() => Promise.resolve(true)) }
}));

import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { normalizeToLocalSqlDateTime, toLocalSqlDateTime } from '../src/utils/localTime.js';

// Bugs P1-71/P1-72: every bill date is shop local time and is read with no time-zone
// conversion, so a bill saved in the evening shows on its own day on every page.
describe('Bill dates are shop local time everywhere', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-dates-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    const { default: salesRouter } = await import('../src/routes/sales.js');
    const { default: returnsRouter } = await import('../src/routes/returns.js');
    const { default: customerReturnsRouter } = await import('../src/routes/customerReturns.js');
    app = express();
    app.use(express.json());
    app.use('/api/sales', salesRouter);
    app.use('/api/returns', returnsRouter);
    app.use('/api/customer-returns', customerReturnsRouter);
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  const openDb = async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    return open({ filename: dbPath, driver: sqlite3.default.Database });
  };

  test('client dates: local text is kept, UTC ISO becomes the same moment in shop time, junk is null', () => {
    expect(normalizeToLocalSqlDateTime('2026-09-22 21:43:10')).toBe('2026-09-22 21:43:10');
    expect(normalizeToLocalSqlDateTime('2026-09-22 21:43')).toBe('2026-09-22 21:43:00');
    const iso = '2026-09-25T20:15:00.000Z';
    expect(normalizeToLocalSqlDateTime(iso)).toBe(toLocalSqlDateTime(new Date(iso)));
    expect(normalizeToLocalSqlDateTime('not a date')).toBeNull();
    expect(normalizeToLocalSqlDateTime('')).toBeNull();
  });

  test('sale dates saved as UTC ISO are moved once to shop time; a second pass changes nothing', async () => {
    const { normalizeBillDatesToLocalTime } = await import('../src/database.js');
    const iso = '2026-09-25T20:15:00.000Z';
    const db = await openDb();
    await db.run("INSERT INTO sales_invoices (id, invoice_no, total_amount, date) VALUES (7001, 'ISO-1', 10, ?)", [iso]);
    await normalizeBillDatesToLocalTime(db);
    const once = await db.get('SELECT date FROM sales_invoices WHERE id = 7001');
    await normalizeBillDatesToLocalTime(db);
    const twice = await db.get('SELECT date FROM sales_invoices WHERE id = 7001');
    await db.close();
    expect(once.date).toBe(toLocalSqlDateTime(new Date(iso)));
    expect(twice.date).toBe(once.date);
  });

  test('an evening sale and returns list under their own day, not the next one', async () => {
    const db = await openDb();
    await db.run("INSERT INTO sales_invoices (id, invoice_no, total_amount, subtotal, date, store_id) VALUES (7002, 'EVE-S', 10, 10, '2026-09-22 21:43:10', 1)");
    await db.run("INSERT INTO returns (id, return_no, type, total_amount, date) VALUES (7003, 'EVE-R', 'purchase', 10, '2026-09-22 21:43:10')");
    await db.run("INSERT INTO returns (id, return_no, type, total_amount, date) VALUES (7004, 'EVE-C', 'sale', 10, '2026-09-22 21:43:10')");
    await db.close();

    const sells = (from: string) => request(app).get('/api/sales/list').query({ date_from: from, date_to: from, limit: 100 });
    const onDay = await sells('2026-09-22');
    const nextDay = await sells('2026-09-23');
    const nos = (r: any) => (r.body.invoices || r.body.data || r.body || []).map((i: any) => i.invoice_no);
    expect(nos(onDay)).toContain('EVE-S');
    expect(nos(nextDay)).not.toContain('EVE-S');

    const supplierReturns = await request(app).get('/api/returns').query({ date_from: '2026-09-22', date_to: '2026-09-22' });
    expect(JSON.stringify(supplierReturns.body)).toContain('EVE-R');

    const customerReturns = await request(app).get('/api/customer-returns/history').query({ start: '2026-09-22', end: '2026-09-22' });
    expect(JSON.stringify(customerReturns.body)).toContain('EVE-C');
  });
});
