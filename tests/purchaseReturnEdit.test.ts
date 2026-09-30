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
  telegramBotService: { sendDefaultNotification: jest.fn(() => Promise.resolve(true)) }
}));

import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

// Edit-an-old-purchase-bill and supplier-return contract (AGENT_DATA_FLOW_TREE.md section 4):
// the shelf moves by the net change through the strip/loose pool, stock that was already
// sold can't be un-bought, medicines are never auto-created, and a return edit/delete moves
// exactly what that return recorded in the stock ledger.
describe('Editing saved purchase bills and supplier returns', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purchase-return-edit-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    const { default: purchasesRouter } = await import('../src/routes/purchases.js');
    const { default: investigationRouter } = await import('../src/routes/investigation.js');
    const { default: returnsRouter } = await import('../src/routes/returns.js');
    app = express();
    app.use(express.json());
    app.use('/api/purchases', purchasesRouter);
    app.use('/api/investigation', investigationRouter);
    app.use('/api/returns', returnsRouter);
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  const openDb = async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    return open({ filename: dbPath, driver: sqlite3.default.Database });
  };

  const shelfOf = async (n: number) => {
    const db = await openDb();
    const row = await db.get('SELECT quantity, loose_quantity, is_active, mrp, expiry_date FROM inventory_master WHERE id = ?', [n]);
    await db.close();
    return row;
  };

  // A 10-strip purchase bill of one batch (pack of 10) with `shelf` still on the shelf.
  const seedPurchase = async (n: number, shelf: [number, number]) => {
    const db = await openDb();
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (?, ?, 10)', [n, `BuyMed${n}`]);
    await db.run('INSERT OR IGNORE INTO distributors (id, name) VALUES (1, "Alpha Pharma")');
    await db.run('INSERT INTO purchases (id, invoice_no, distributor_id, date, total_amount) VALUES (?, ?, 1, "2026-09-01 10:00:00", 500)', [n, `P-${n}`]);
    await db.run('INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, free_qty, cost_price, mrp) VALUES (?, ?, ?, "12/99", 10, 0, 50, 100)', [n, n, `PB${n}`]);
    await db.run(
      'INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp, is_active) VALUES (?, ?, ?, ?, ?, "12/99", 50, 100, 1)',
      [n, n, shelf[0], shelf[1], `PB${n}`]
    );
    await db.close();
  };

  const fullEdit = (n: number, qty: number, extra: Record<string, unknown> = {}) =>
    request(app).put(`/api/purchases/${n}/full`).send({
      distributor: 'Alpha Pharma',
      invoice_no: `P-${n}`,
      date: '2026-09-01',
      items: [{ medicine_id: n, medicine: `BuyMed${n}`, batch: `PB${n}`, expiry: '12/99', qty, free_qty: 0, rate: 50, mrp: 100, cgst: 6, sgst: 6, ...extra }]
    });

  test('re-saving a partly sold bill unchanged adds no stock (was P1-64 phantom stock)', async () => {
    await seedPurchase(1001, [3, 0]);
    const res = await fullEdit(1001, 10);
    expect(res.status).toBe(200);
    expect(await shelfOf(1001)).toMatchObject({ quantity: 3, loose_quantity: 0 });
  });

  test('lowering a bill below what was already sold is refused and nothing changes', async () => {
    await seedPurchase(1002, [3, 0]);
    const res = await fullEdit(1002, 5);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already sold or returned/);
    expect(await shelfOf(1002)).toMatchObject({ quantity: 3, loose_quantity: 0 });
    const db = await openDb();
    const line = await db.get('SELECT quantity FROM purchase_items WHERE purchase_id = 1002');
    await db.close();
    expect(line.quantity).toBe(10);
  });

  test('lowering takes only the difference, through strips and loose', async () => {
    await seedPurchase(1003, [2, 5]);
    const res = await fullEdit(1003, 8);
    expect(res.status).toBe(200);
    expect(await shelfOf(1003)).toMatchObject({ quantity: 0, loose_quantity: 5 });
  });

  test('raising adds the difference and the batch takes the bill line MRP', async () => {
    await seedPurchase(1004, [3, 0]);
    const res = await fullEdit(1004, 12, { mrp: 110 });
    expect(res.status).toBe(200);
    expect(await shelfOf(1004)).toMatchObject({ quantity: 5, mrp: 110 });
  });

  test('a line that is not a known medicine blocks the edit; no medicine is created', async () => {
    await seedPurchase(1005, [10, 0]);
    const db = await openDb();
    const before = await db.get('SELECT COUNT(*) AS c FROM medicines');
    await db.close();
    const res = await request(app).put('/api/purchases/1005/full').send({
      distributor: 'Alpha Pharma', invoice_no: 'P-1005', date: '2026-09-01',
      items: [{ medicine: 'Zzqx Unknown Tablet 999', batch: 'X1', expiry: '12/99', qty: 1, rate: 5, mrp: 10 }]
    });
    expect(res.status).toBe(400);
    expect(res.body.unresolved_items).toEqual([{ name: 'Zzqx Unknown Tablet 999' }]);
    const dbAfter = await openDb();
    const after = await dbAfter.get('SELECT COUNT(*) AS c FROM medicines');
    await dbAfter.close();
    expect(after.c).toBe(before.c);
    expect(await shelfOf(1005)).toMatchObject({ quantity: 10 });
  });

  test('the Investigation purchase correction follows the same rules', async () => {
    await seedPurchase(1006, [3, 0]);
    const line = (quantity: number) => ({ medicine_id: 1006, medicine_name: 'BuyMed1006', batch_no: 'PB1006', expiry_date: '12/99', quantity, free_qty: 0, cost_price: 50, mrp: 100 });
    const refused = await request(app).put('/api/investigation/purchases/1006').send({ items: [line(5)] });
    expect(refused.status).toBe(400);
    const empty = await request(app).put('/api/investigation/purchases/1006').send({ items: [] });
    expect(empty.status).toBe(400);
    const ok = await request(app).put('/api/investigation/purchases/1006').send({ items: [line(8)] });
    expect(ok.status).toBe(200);
    expect(await shelfOf(1006)).toMatchObject({ quantity: 1 });
  });

  const manualSave = (n: number, date: string, qty: number) =>
    request(app).post('/api/purchases/manual').send({
      distributor: 'Alpha Pharma', invoice_no: `P-${n}`, date,
      items: [{ medicine_id: n, medicine_name: `BuyMed${n}`, batch_no: `PB${n}`, expiry: '12/99', qty, free_qty: 0, rate: 50, mrp: 100 }]
    });

  test('re-saving the same bill (same number and date) updates it; no copy is stored', async () => {
    await seedPurchase(1007, [10, 0]);
    const res = await manualSave(1007, '2026-09-01', 10);
    expect(res.status).toBe(200);
    const db = await openDb();
    const bills = await db.get("SELECT COUNT(*) AS c FROM purchases WHERE invoice_no = 'P-1007'");
    await db.close();
    expect(bills.c).toBe(1);
    expect(await shelfOf(1007)).toMatchObject({ quantity: 10 });
  });

  test('a reused invoice number on another date is a new bill and never overwrites the old one', async () => {
    await seedPurchase(1008, [3, 0]); // old bill: 10 bought, 7 sold
    const res = await manualSave(1008, '2027-01-15', 4);
    expect(res.status).toBe(200);
    const db = await openDb();
    const bills = await db.all("SELECT id, substr(date, 1, 10) AS day FROM purchases WHERE invoice_no = 'P-1008' ORDER BY id");
    const oldLine = await db.get('SELECT quantity FROM purchase_items WHERE purchase_id = 1008');
    await db.close();
    expect(bills.map((b: { day: string }) => b.day)).toEqual(['2026-09-01', '2027-01-15']);
    expect(oldLine.quantity).toBe(10);
    expect(await shelfOf(1008)).toMatchObject({ quantity: 7 }); // 3 left + 4 new
  });

  test('editing a bill that was already deleted is refused and recreates nothing', async () => {
    await seedPurchase(1050, [10, 0]);
    expect((await request(app).delete('/api/purchases/1050')).status).toBe(200);
    const res = await fullEdit(1050, 10);
    expect(res.status).toBe(404);
    const db = await openDb();
    const lines = await db.get('SELECT COUNT(*) AS c FROM purchase_items WHERE purchase_id = 1050');
    await db.close();
    expect(lines.c).toBe(0);
    expect(await shelfOf(1050)).toMatchObject({ quantity: 0, loose_quantity: 0 });
  });

  test('a bill saved in the evening lists under its own day in Purchase History, like Reports', async () => {
    const db = await openDb();
    await db.run('INSERT OR IGNORE INTO distributors (id, name) VALUES (1, "Alpha Pharma")');
    await db.run('INSERT INTO purchases (id, invoice_no, distributor_id, date, total_amount) VALUES (1060, "EVE-1", 1, "2026-09-22 21:43:10", 100)');
    await db.close();
    const onDay = await request(app).get('/api/purchases').query({ start: '2026-09-22', end: '2026-09-22', page: 1 });
    const nextDay = await request(app).get('/api/purchases').query({ start: '2026-09-23', end: '2026-09-23', page: 1 });
    expect(onDay.body.data.map((p: { invoice_no: string }) => p.invoice_no)).toContain('EVE-1');
    expect(nextDay.body.data.map((p: { invoice_no: string }) => p.invoice_no)).not.toContain('EVE-1');
  });

  // Supplier return 'R<n>' that took `taken` strips off a shelf now holding `shelf`.
  const seedReturn = async (n: number, taken: number, shelf: number, withLedger = true) => {
    const db = await openDb();
    await db.run('INSERT INTO medicines (id, name, pack_size) VALUES (?, ?, 10)', [n, `RetMed${n}`]);
    await db.run('INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp, is_active) VALUES (?, ?, ?, 0, ?, "12/99", 50, 100, 1)', [n, n, shelf, `RB${n}`]);
    await db.run("INSERT INTO returns (id, return_no, type, total_amount) VALUES (?, ?, 'purchase', ?)", [n, `R-${n}`, taken * 50]);
    await db.run('INSERT INTO return_items (return_id, medicine_id, batch_no, quantity, cost_price, mrp, total_price) VALUES (?, ?, ?, ?, 50, 100, ?)', [n, n, `RB${n}`, taken, taken * 50]);
    if (withLedger) {
      await db.run("INSERT INTO stock_ledger (medicine_id, batch_no, quantity, loose_quantity, transaction_type, transaction_id) VALUES (?, ?, ?, 0, 'return_to_distributor', ?)", [n, `RB${n}`, -taken, String(n)]);
    }
    await db.close();
  };
  const returnLine = (n: number, quantity: number) => ({ medicine_id: n, batch_no: `RB${n}`, quantity, cost_price: 50, mrp: 100 });

  test('a supplier return edit and delete move exactly the recorded stock', async () => {
    await seedReturn(1101, 5, 5);
    expect((await request(app).put('/api/returns/1101').send({ items: [returnLine(1101, 2)] })).status).toBe(200);
    expect(await shelfOf(1101)).toMatchObject({ quantity: 8 }); // 3 put back

    const tooMany = await request(app).put('/api/returns/1101').send({ items: [returnLine(1101, 11)] });
    expect(tooMany.status).toBe(400); // needs 9 more, shelf has 8
    expect(await shelfOf(1101)).toMatchObject({ quantity: 8 });

    expect((await request(app).put('/api/returns/1101').send({ items: [returnLine(1101, 9)] })).status).toBe(200);
    expect(await shelfOf(1101)).toMatchObject({ quantity: 1 });

    expect((await request(app).delete('/api/returns/1101')).status).toBe(200);
    expect(await shelfOf(1101)).toMatchObject({ quantity: 10 }); // all 9 back
  });

  test('a return that never moved stock (credit note only) moves none on delete', async () => {
    await seedReturn(1102, 4, 6, false);
    expect((await request(app).delete('/api/returns/1102')).status).toBe(200);
    expect(await shelfOf(1102)).toMatchObject({ quantity: 6 });
  });
});
