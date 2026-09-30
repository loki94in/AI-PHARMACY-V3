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

// Edit-an-old-sale-bill contract (AGENT_DATA_FLOW_TREE.md section 4): stock moves only by
// the net change per batch, totals use the POS tax-inclusive math with the database pack
// size, saved line copies are kept, and every refusal leaves the bill and shelf untouched.
describe('Editing a saved sale bill', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sale-bill-edit-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    const { default: salesRouter } = await import('../src/routes/sales.js');
    const { default: investigationRouter } = await import('../src/routes/investigation.js');
    app = express();
    app.use(express.json());
    app.use('/api/sales', salesRouter);
    app.use('/api/investigation', investigationRouter);
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  const openDb = async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    return open({ filename: dbPath, driver: sqlite3.default.Database });
  };

  // One medicine (pack of 10), one batch, one bill selling `soldStrips` strips of it.
  const seed = async (n: number, opts: { shelf: [number, number]; expiry?: string; soldStrips?: number; soldLoose?: number; discountPer?: number }) => {
    const db = await openDb();
    await db.run('INSERT INTO medicines (id, name, pack_size, cgst_per, sgst_per) VALUES (?, ?, 10, 6, 6)', [n, `EditMed${n}`]);
    await db.run(
      'INSERT INTO inventory_master (id, medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp, is_active) VALUES (?, ?, ?, ?, ?, ?, 70, 100, 1)',
      [n, n, opts.shelf[0], opts.shelf[1], `B${n}`, opts.expiry || '12/2099']
    );
    const cust = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [`Patient ${n}`, '9876543210']);
    await db.run(
      "INSERT INTO sales_invoices (id, invoice_no, total_amount, subtotal, discount, customer_id, customer_name_snapshot, customer_phone_snapshot, payment_medium) VALUES (?, ?, 200, 200, 0, ?, ?, '+91 98765 43210', 'CASH')",
      [n, `INV-${n}`, cust.lastID, `Patient ${n}`]
    );
    await db.run(
      'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per, medicine_name_snapshot, batch_no_snapshot, mrp_snapshot) VALUES (?, ?, ?, 100, ?, ?, ?, ?, 100)',
      [n, n, opts.soldStrips ?? 2, opts.soldLoose ?? 0, opts.discountPer ?? 0, `EditMed${n} (as sold)`, `B${n}`]
    );
    await db.close();
  };

  const shelfOf = async (n: number) => {
    const db = await openDb();
    const row = await db.get('SELECT quantity, loose_quantity, is_active FROM inventory_master WHERE id = ?', [n]);
    await db.close();
    return row;
  };

  const line = (n: number, quantity: number, loose = 0, discount_per = 0) =>
    ({ inventory_id: n, quantity, loose_qty: loose, unit_price: 100, discount_per });

  test('an unchanged line on an expired, sold-out batch can still be re-saved', async () => {
    await seed(901, { shelf: [0, 0], expiry: '01/2020' });
    const res = await request(app).put('/api/sales/901').send({
      items: [line(901, 2)], patient_name: 'Patient 901', patient_phone: '9876543210', paymentMedium: 'UPI'
    });
    expect(res.status).toBe(200);
    expect(await shelfOf(901)).toMatchObject({ quantity: 0, loose_quantity: 0 });
    const db = await openDb();
    const bill = await db.get('SELECT customer_id, payment_medium FROM sales_invoices WHERE id = 901');
    const dupes = await db.get("SELECT COUNT(*) AS c, MIN(id) AS id FROM customers WHERE name = 'Patient 901'");
    await db.close();
    expect(bill).toEqual({ customer_id: dupes.id, payment_medium: 'UPI' }); // same patient, no duplicate
    expect(dupes.c).toBe(1);
  });

  test('selling more of an expired batch is refused and nothing changes', async () => {
    await seed(902, { shelf: [5, 0], expiry: '01/2020' });
    const res = await request(app).put('/api/sales/902').send({ items: [line(902, 3)] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
    expect(await shelfOf(902)).toMatchObject({ quantity: 5, loose_quantity: 0 });
    const db = await openDb();
    const kept = await db.get('SELECT quantity FROM sale_items WHERE invoice_id = 902');
    await db.close();
    expect(kept.quantity).toBe(2);
  });

  test('selling more than the shelf holds is refused with what is on the shelf', async () => {
    await seed(903, { shelf: [1, 0] });
    const res = await request(app).put('/api/sales/903').send({ items: [line(903, 4)] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Not enough EditMed903/);
    expect(await shelfOf(903)).toMatchObject({ quantity: 1, loose_quantity: 0 });
  });

  test('lowering a line puts only the difference back and re-activates the batch', async () => {
    await seed(904, { shelf: [0, 0], soldStrips: 3 });
    const db = await openDb();
    await db.run('UPDATE inventory_master SET is_active = 0 WHERE id = 904');
    await db.close();
    const res = await request(app).put('/api/sales/904').send({ items: [line(904, 1, 4)] });
    expect(res.status).toBe(200);
    // 30 units sold -> 14 units now: 16 units (1 strip + 6 loose) come back.
    expect(await shelfOf(904)).toEqual({ quantity: 1, loose_quantity: 6, is_active: 1 });
  });

  test('loose units are priced by the database pack size and the line discount is kept', async () => {
    await seed(905, { shelf: [5, 0], soldStrips: 1, discountPer: 10 });
    // Sells sends no pack_size. 1 strip + 5 loose at 100/strip, 10% off: (100 + 50) * 0.9 = 135.
    const res = await request(app).put('/api/sales/905').send({ items: [line(905, 1, 5, 10)], discount: 0 });
    expect(res.status).toBe(200);
    const db = await openDb();
    const bill = await db.get('SELECT subtotal, total_amount FROM sales_invoices WHERE id = 905');
    const item = await db.get('SELECT discount_per, medicine_name_snapshot, batch_no_snapshot, mrp_snapshot FROM sale_items WHERE invoice_id = 905');
    await db.close();
    expect(bill.subtotal).toBeCloseTo(135);
    expect(bill.total_amount).toBe(135); // GST is inside the price, never added on top
    expect(item).toEqual({ discount_per: 10, medicine_name_snapshot: 'EditMed905 (as sold)', batch_no_snapshot: 'B905', mrp_snapshot: 100 });
  });

  test('an old bill with no doctor saves from Sells; a POS edit that clears the doctor is refused cleanly', async () => {
    await seed(906, { shelf: [5, 0] });
    const ok = await request(app).put('/api/sales/906').send({ items: [line(906, 2)] });
    expect(ok.status).toBe(200);

    const refused = await request(app).put('/api/sales/906').send({ items: [line(906, 2)], doctor_name: '' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/Doctor name is required/);

    // The refusal must not leave the connection inside a transaction.
    const next = await request(app).put('/api/sales/906').send({ items: [line(906, 3)] });
    expect(next.status).toBe(200);
    expect(await shelfOf(906)).toMatchObject({ quantity: 4 });
  });

  test('a bill cannot be emptied by an edit', async () => {
    await seed(907, { shelf: [5, 0] });
    const res = await request(app).put('/api/sales/907').send({ items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/delete the bill instead/i);
  });

  test('changing the patient name updates the saved copy shown on the bill', async () => {
    await seed(908, { shelf: [5, 0] });
    const res = await request(app).put('/api/sales/908').send({ items: [line(908, 2)], patient_name: 'Corrected Name', patient_phone: '9876543210' });
    expect(res.status).toBe(200);
    const db = await openDb();
    const bill = await db.get('SELECT customer_name_snapshot, customer_id FROM sales_invoices WHERE id = 908');
    const corrected = await db.get("SELECT id FROM customers WHERE name = 'Corrected Name'");
    await db.close();
    expect(bill.customer_name_snapshot).toBe('Corrected Name');
    expect(bill.customer_id).toBe(corrected.id);
  });

  test('the Investigation correction follows the same rules and POS totals', async () => {
    await seed(909, { shelf: [1, 0], expiry: '01/2020' });
    const refused = await request(app).put('/api/investigation/sales/909').send({ items: [line(909, 3)] });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/expired/i);

    const ok = await request(app).put('/api/investigation/sales/909').send({ items: [line(909, 1)] });
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBe(100); // no 5% added on top
    expect(await shelfOf(909)).toMatchObject({ quantity: 2, loose_quantity: 0 });
  });
});
