import { jest } from '@jest/globals';

// The purchases router loads whatsappQueueWorker, which imports many whatsappClient exports:
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

// Bug P1-63: deleting a purchase bill must take that bill's stock off the shelf through the
// strip/loose unit pool. The old strips-only `quantity - n` left loose units behind, so POS
// could still sell stock whose only purchase bill had been deleted.
describe('Purchase bill delete removes its stock', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purchase-delete-stock-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { default: purchasesRouter } = await import('../src/routes/purchases.js');

    app = express();
    app.use(express.json());
    app.use('/api/purchases', purchasesRouter);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  const openDb = async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    return open({ filename: dbPath, driver: sqlite3.default.Database });
  };

  test('refuses to delete a bill whose stock was partly sold, and changes nothing', async () => {
    const db = await openDb();
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (801, "PurchaseDeleteMed", 10)');
    await db.run('INSERT INTO purchases (id, invoice_no, total_amount) VALUES (801, "PUR-801", 700)');
    await db.run('INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, quantity, free_qty, cost_price, mrp) VALUES (801, 801, "PD801", 10, 0, 70, 100)');
    // Bought 10 strips, POS sold 3 loose: 9 strips + 7 loose on the shelf.
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp, is_active) VALUES (801, 801, 9, 7, "PD801", "12/2099", 70, 100, 1)');
    await db.close();

    const res = await request(app).delete('/api/purchases/801');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already sold or returned/);

    const dbVerify = await openDb();
    const inv = await dbVerify.get('SELECT quantity, loose_quantity, is_active FROM inventory_master WHERE id = 801');
    const bill = await dbVerify.get('SELECT id FROM purchases WHERE id = 801');
    await dbVerify.close();

    expect(inv).toEqual({ quantity: 9, loose_quantity: 7, is_active: 1 });
    expect(bill).toEqual({ id: 801 });
  });

  test('takes a fully unsold bill off the shelf, loose units included', async () => {
    const db = await openDb();
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (805, "UnsoldDeleteMed", 10)');
    await db.run('INSERT INTO purchases (id, invoice_no, total_amount) VALUES (805, "PUR-805", 700)');
    await db.run('INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, quantity, free_qty, cost_price, mrp) VALUES (805, 805, "PD805", 10, 0, 70, 100)');
    // A strip was opened but nothing sold: 9 strips + 10 loose = the bill's 100 units.
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp, is_active) VALUES (805, 805, 9, 10, "PD805", "12/2099", 70, 100, 1)');
    await db.close();

    const res = await request(app).delete('/api/purchases/805');
    expect(res.status).toBe(200);

    const dbVerify = await openDb();
    const inv = await dbVerify.get('SELECT quantity, loose_quantity, is_active FROM inventory_master WHERE id = 805');
    const ledger = await dbVerify.all("SELECT quantity, loose_quantity FROM stock_ledger WHERE transaction_type = 'purchase_delete' AND transaction_id = '805'");
    await dbVerify.close();

    expect(inv).toEqual({ quantity: 0, loose_quantity: 0, is_active: 0 });
    expect(ledger).toEqual([{ quantity: -10, loose_quantity: 0 }]);
  });

  test('keeps stock that came from another bill of the same batch', async () => {
    const db = await openDb();
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (802, "SharedBatchMed", 10)');
    await db.run('INSERT INTO purchases (id, invoice_no, total_amount) VALUES (802, "PUR-802", 700)');
    await db.run('INSERT INTO purchases (id, invoice_no, total_amount) VALUES (803, "PUR-803", 350)');
    await db.run('INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, quantity, free_qty, cost_price, mrp) VALUES (802, 802, "PD802", 8, 2, 70, 100)');
    await db.run('INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, quantity, free_qty, cost_price, mrp) VALUES (803, 802, "PD802", 5, 0, 70, 100)');
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp, is_active) VALUES (802, 802, 15, 0, "PD802", "12/2099", 70, 100, 1)');
    await db.close();

    const res = await request(app).delete('/api/purchases/802');
    expect(res.status).toBe(200);

    const dbVerify = await openDb();
    const inv = await dbVerify.get('SELECT quantity, loose_quantity, is_active FROM inventory_master WHERE id = 802');
    await dbVerify.close();

    // 8 billed + 2 free leave; the other bill's 5 strips stay sellable.
    expect(inv.quantity).toBe(5);
    expect(inv.loose_quantity).toBe(0);
    expect(inv.is_active).toBe(1);
  });

  test('a delete of a missing bill does not leave the connection inside a transaction', async () => {
    const missing = await request(app).delete('/api/purchases/999999');
    expect(missing.status).toBe(404);

    const db = await openDb();
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (804, "AfterMissingMed", 10)');
    await db.run('INSERT INTO purchases (id, invoice_no, total_amount) VALUES (804, "PUR-804", 70)');
    await db.run('INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, quantity, free_qty, cost_price, mrp) VALUES (804, 804, "PD804", 1, 0, 70, 100)');
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp, is_active) VALUES (804, 804, 1, 0, "PD804", "12/2099", 70, 100, 1)');
    await db.close();

    const res = await request(app).delete('/api/purchases/804');
    expect(res.status).toBe(200);
  });
});
