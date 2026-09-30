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

// Bug P1-62: deleting a sale bill must put the sold stock back on the shelf AND make the
// batch sellable again. A POS sale that empties a batch sets is_active = 0, and POS search /
// the Inventory "in stock" filter only show is_active = 1 rows.
describe('Sale bill delete restores stock', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sale-delete-restore-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { default: salesRouter } = await import('../src/routes/sales.js');

    app = express();
    app.use(express.json());
    app.use('/api/sales', salesRouter);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('restores every line of a sold-out batch and makes it sellable again', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (701, "DeleteRestoreMed", 10)');
    // Shelf after the sale sold the whole batch: 0 strips, 0 loose, deactivated.
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp, is_active) VALUES (701, 701, 0, 0, "DR701", "12/2099", 70, 100, 0)');
    await db.run('INSERT INTO sales_invoices (id, invoice_no, total_amount) VALUES (701, "INV-701", 230)');
    // Two lines on the same batch: 2 strips, then 3 loose.
    await db.run('INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty) VALUES (701, 701, 2, 100, 0)');
    await db.run('INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty) VALUES (701, 701, 0, 100, 3)');
    await db.close();

    const res = await request(app).delete('/api/sales/701');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dbVerify = await open({ filename: dbPath, driver: sqlite3.default.Database });
    const inv = await dbVerify.get('SELECT quantity, loose_quantity, is_active FROM inventory_master WHERE id = 701');
    const invoice = await dbVerify.get('SELECT id FROM sales_invoices WHERE id = 701');
    const lines = await dbVerify.get('SELECT COUNT(*) AS c FROM sale_items WHERE invoice_id = 701');
    const ledger = await dbVerify.all("SELECT quantity, loose_quantity FROM stock_ledger WHERE transaction_type = 'sale_delete_restore' AND transaction_id = '701'");
    await dbVerify.close();

    expect(inv.quantity).toBe(2);
    expect(inv.loose_quantity).toBe(3);
    expect(inv.is_active).toBe(1);
    expect(invoice).toBeUndefined();
    expect(lines.c).toBe(0);
    expect(ledger.length).toBe(2);
  });
});
