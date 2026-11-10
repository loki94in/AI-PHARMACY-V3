import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import express from 'express';
import request from 'supertest';

type CartLine = { storeId: number; storeName: string; productCode: string; productName: string; qty: number };
let cartLines: CartLine[] = [];

const mockLoadLiveCartCore = jest.fn(async () => {
  const byStore = new Map<number, { storeId: number; storeName: string; items: CartLine[] }>();
  for (const l of cartLines) {
    if (!byStore.has(l.storeId)) byStore.set(l.storeId, { storeId: l.storeId, storeName: l.storeName, items: [] });
    byStore.get(l.storeId)!.items.push({ ...l });
  }
  return { distributors: [...byStore.values()], totalItems: cartLines.length };
});

const mockSearch = jest.fn(async () => ({
  status: 'ok',
  items: [
    { name: 'TELMA 40MG TAB', distributor: 'ALPHA PHARMA', storeId: 11, productCode: 'A-100', productId: 5001, rate: 80, mrp: 120, stock: '50', mapped: true },
    { name: 'DOLO 650MG TAB', distributor: 'ALPHA PHARMA', storeId: 11, productCode: 'A-200', productId: 5002, rate: 30, mrp: 45, stock: '50', mapped: true },
    { name: 'ECOSPRIN 75MG TAB', distributor: 'ALPHA PHARMA', storeId: 11, productCode: 'A-300', productId: 5003, rate: 10, mrp: 15, stock: '50', mapped: true },
    { name: 'ROSUVAS 10MG TAB', distributor: 'ALPHA PHARMA', storeId: 11, productCode: 'A-400', productId: 5004, rate: 90, mrp: 130, stock: '50', mapped: true },
    { name: 'PAN 40MG TAB', distributor: 'ALPHA PHARMA', storeId: 11, productCode: 'A-500', productId: 5005, rate: 60, mrp: 90, stock: '50', mapped: true }
  ]
}));

const mockAdd = jest.fn(async (items: Array<{ storeId: number; storeName: string; productCode: string; productName?: string; qty: number }>) => {
  for (const it of items) {
    const cur = cartLines.find(l => l.storeId === it.storeId && l.productCode === it.productCode);
    if (cur) cur.qty = it.qty;
    else cartLines.push({ storeId: it.storeId, storeName: it.storeName, productCode: it.productCode, productName: it.productName || it.productCode, qty: it.qty });
  }
  return { success: true, mode: 'Live' };
});

jest.unstable_mockModule('../src/routes/pharmarack.js', () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  loadLiveCartCore: mockLoadLiveCartCore,
  performPharmarackSearch: mockSearch,
  addItemsToPharmarackCart: mockAdd,
  adjustSpecialOrderInLiveCart: jest.fn(async () => ({ action: 'none' })),
  invalidatePharmarackCartCache: jest.fn(),
  getCachedCartLines: jest.fn(() => cartLines),
  resolveCommonOrFrequentDistributor: jest.fn(async () => null),
  isItemInStock: (v: any) => {
    const n = parseFloat(String(v ?? '0'));
    return !isNaN(n) && n > 0;
  }
}));

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

jest.unstable_mockModule('../src/services/whatsappQueueWorker.js', () => ({
  __esModule: true,
  whatsappQueueWorker: {
    enqueue: jest.fn(async () => 101),
    setPaused: jest.fn()
  }
}));

jest.unstable_mockModule('../src/telegramBot.js', () => ({
  __esModule: true,
  telegramBotService: { sendDefaultNotification: jest.fn(async () => true) }
}));

import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';
import refillsRouter from '../src/routes/refills.js';
import { toLocalSqlDate } from '../src/utils/localTime.js';

function addDaysSql(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalSqlDate(d);
}

describe('CRM -> QA Selective Refill Flow & Cycle Truthfulness', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;
  let app: express.Express;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-qa-selective-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    db = await dbManager.getConnection();

    app = express();
    app.use(express.json());
    app.use('/api/refills', refillsRouter);
  });

  afterAll(async () => {
    try {
      await dbManager.close(true);
    } catch {}
    delete process.env.DB_PATH;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(async () => {
    cartLines = [];
    mockAdd.mockClear();
    await db.run('DELETE FROM refill_fulfillments');
    await db.run('DELETE FROM patient_refills');
    await db.run('DELETE FROM medicine_distributor_links');
    await db.run('DELETE FROM distributor_priority');
    await db.run('DELETE FROM medicines');
    await db.run('DELETE FROM customers');

    await db.run(`INSERT INTO medicines (id, name, mrp, sell_price) VALUES
      (1, 'TELMA 40MG TAB', 120, 110),
      (2, 'DOLO 650MG TAB', 45, 40),
      (3, 'ECOSPRIN 75MG TAB', 15, 14),
      (4, 'ROSUVAS 10MG TAB', 130, 120),
      (5, 'PAN 40MG TAB', 90, 85)`);

    await db.run(`INSERT INTO distributor_priority (name_key, store_name, priority) VALUES ('alphapharma', 'ALPHA PHARMA', 1)`);
    await db.run(`INSERT INTO medicine_distributor_links (medicine_id, store_id, store_name, product_code, product_name, mapped, pick_order) VALUES
      (1, 11, 'ALPHA PHARMA', 'A-100', 'TELMA 40MG TAB', 1, 0),
      (2, 11, 'ALPHA PHARMA', 'A-200', 'DOLO 650MG TAB', 1, 0),
      (3, 11, 'ALPHA PHARMA', 'A-300', 'ECOSPRIN 75MG TAB', 1, 0),
      (4, 11, 'ALPHA PHARMA', 'A-400', 'ROSUVAS 10MG TAB', 1, 0),
      (5, 11, 'ALPHA PHARMA', 'A-500', 'PAN 40MG TAB', 1, 0)`);
  });

  it('Rules 1, 2, 3, 5, 6: stages only selected 3 of 5 from CRM, never writes cart until QA approval, and preserves state on reopen', async () => {
    await db.run(`INSERT INTO customers (id, name, phone) VALUES (28306, 'Mr. NIDGE', '9096610977')`);
    const dueToday = addDaysSql(0);
    await db.run(`INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, quantity_needed, refill_interval_days, last_refill_date, next_refill_date, is_active, status) VALUES
      (166, 28306, 1, 'Mr. NIDGE', '9096610977', 3, 30, NULL, ?, 1, 'pending'),
      (167, 28306, 2, 'Mr. NIDGE', '9096610977', 2, 30, NULL, ?, 1, 'pending'),
      (168, 28306, 3, 'Mr. NIDGE', '9096610977', 1, 30, NULL, ?, 1, 'pending'),
      (180, 28306, 4, 'Mr. NIDGE', '9096610977', 4, 30, NULL, ?, 1, 'pending'),
      (181, 28306, 5, 'Mr. NIDGE', '9096610977', 2, 30, NULL, ?, 1, 'pending')`,
      [dueToday, dueToday, dueToday, dueToday, dueToday]
    );

    // Rule 1 & 2 & 6: Stage 3 of 5 from CRM with edited quantities -> ZERO Pharmarack calls yet
    const stageRes = await request(app)
      .post('/api/refills/qa-stage')
      .send({
        items: [
          { refill_id: 166, qty: 5 },
          { refill_id: 167, qty: 4 },
          { refill_id: 168, qty: 2 }
        ]
      });
    expect(stageRes.status).toBe(200);
    expect(stageRes.body.staged_count).toBe(3);
    expect(mockAdd).not.toHaveBeenCalled();

    // Panel shows all 5 medicines, with ONLY the 3 selected marked qa_queued
    const panelRes = await request(app).get('/api/refills/panel?upcoming_days=7');
    expect(panelRes.status).toBe(200);
    expect(panelRes.body).toHaveLength(1);
    const meds = panelRes.body[0].medicines;
    expect(meds.find((m: any) => m.id === 166).qa_cart_qty).toBe(5);
    expect(meds.find((m: any) => m.id === 167).qa_cart_qty).toBe(4);
    expect(meds.find((m: any) => m.id === 168).qa_cart_qty).toBe(2);
    expect(meds.find((m: any) => m.id === 180).qa_cart_qty).toBeNull();
    expect(meds.find((m: any) => m.id === 181).qa_cart_qty).toBeNull();

    // Rule 6: QA approves Add to Cart ONLY for those 3 staged items
    for (const stagedId of [166, 167, 168]) {
      const addRes = await request(app).post(`/api/refills/${stagedId}/add-to-cart`).send({});
      expect(addRes.status).toBe(200);
      expect(addRes.body.status).toBe('added');
    }
    expect(mockAdd).toHaveBeenCalledTimes(3);

    // Unselected 180 & 181 were NEVER touched or added
    const afterPanel = await request(app).get('/api/refills/panel');
    const afterMeds = afterPanel.body[0].medicines;
    expect(afterMeds.find((m: any) => m.id === 166).cart_qty).toBe(5);
    expect(afterMeds.find((m: any) => m.id === 166).qa_cart_qty).toBeNull();
    expect(afterMeds.find((m: any) => m.id === 166).cart_status).toBe('added');
    expect(afterMeds.find((m: any) => m.id === 180).cart_store_name).toBeNull();
    expect(afterMeds.find((m: any) => m.id === 180).status).toBe('pending');

    // Rule 3: User returns to CRM later and selects medicine #4 (180), adds in QA, then cancels QA on #5 (181)
    await request(app).post('/api/refills/qa-stage').send({ items: [{ refill_id: 180, qty: 6 }] }).expect(200);
    await request(app).post('/api/refills/qa-stage').send({ items: [{ refill_id: 181, qty: 3 }] }).expect(200);
    await request(app).post('/api/refills/qa-unstage').send({ refill_ids: [181] }).expect(200);

    const checkUnstaged = await db.get('SELECT qa_cart_qty, cart_status FROM patient_refills WHERE id = 181');
    expect(checkUnstaged.qa_cart_qty).toBeNull();
    expect(checkUnstaged.cart_status).toBe('pending');
  });

  it('Rule 4 & 5: Isolates two patients sharing identical medicine & phone without bleeding into each other or overwriting manual cart qty', async () => {
    await db.run(`INSERT INTO customers (id, name, phone) VALUES
      (101, 'Patient Alpha', '9999900001'),
      (102, 'Patient Beta', '9999900002')`);
    // Same medicine (TELMA 40MG TAB) for both, plus pre-existing manual cart line of qty 2!
    cartLines.push({ storeId: 11, storeName: 'ALPHA PHARMA', productCode: 'A-100', productName: 'TELMA 40MG TAB', qty: 2 });

    const dueToday = addDaysSql(0);
    const farFuture = addDaysSql(20);
    await db.run(`INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, quantity_needed, refill_interval_days, last_refill_date, next_refill_date, is_active, status) VALUES
      (501, 101, 1, 'Patient Alpha', '9999900001', 3, 30, NULL, ?, 1, 'pending'),
      (502, 102, 1, 'Patient Beta',  '9999900002', 4, 30, NULL, ?, 1, 'pending'),
      (503, 101, 2, 'Patient Alpha', '9999900001', 1, 30, NULL, ?, 1, 'pending')`,
      [dueToday, dueToday, farFuture]
    );

    // Stage & add Patient Alpha's TELMA (qty 3) -> live cart becomes 2 (manual) + 3 (Alpha) = 5, while Alpha row records ONLY cart_qty = 3
    await request(app).post('/api/refills/qa-stage').send({ items: [{ refill_id: 501, qty: 3 }] }).expect(200);
    const alphaRes = await request(app).post('/api/refills/501/add-to-cart').send({});
    expect(alphaRes.status).toBe(200);
    expect(cartLines.find(c => c.productCode === 'A-100')!.qty).toBe(5);

    const alphaRow = await db.get('SELECT cart_qty, cart_cycle_due_date FROM patient_refills WHERE id = 501');
    expect(alphaRow.cart_qty).toBe(3);
    expect(alphaRow.cart_cycle_due_date).toBe(dueToday);

    // Patient Beta's TELMA must stay untouched and unselected
    const panelRes = await request(app).get('/api/refills/panel?upcoming_days=7');
    const alphaGroup = panelRes.body.find((g: any) => Number(g.customer_id) === 101);
    const betaGroup = panelRes.body.find((g: any) => Number(g.customer_id) === 102);
    expect(alphaGroup).toBeDefined();
    expect(betaGroup).toBeDefined();
    // Un-due medicine #503 for Alpha (due in +20d) must NOT be dragged into 7-day QA feed just because #501 was added
    expect(alphaGroup.medicines.map((m: any) => m.id)).toEqual([501]);
    expect(betaGroup.medicines[0].cart_store_name).toBeNull();
    expect(betaGroup.medicines[0].qa_cart_qty).toBeNull();
    expect(betaGroup.medicines[0].status).toBe('pending');
  });

  it('Mr. NIDGE 8-day cycle bug: fulfilled yesterday with next_refill_date in 7 days stays OUT of upcoming_days=7 feed until 2-day lead window', async () => {
    await db.run(`INSERT INTO customers (id, name, phone) VALUES (28306, 'Mr. NIDGE', '9096610977')`);
    const yesterday = `${addDaysSql(-1)} 12:07:01`;
    const nextDueIn7Days = `${addDaysSql(7)} 12:07:01`;
    await db.run(`INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, quantity_needed, refill_interval_days, last_refill_date, next_refill_date, is_active, status) VALUES
      (166, 28306, 1, 'Mr. NIDGE', '9096610977', 3, 8, ?, ?, 1, 'pending'),
      (167, 28306, 2, 'Mr. NIDGE', '9096610977', 2, 8, ?, ?, 1, 'pending')`,
      [yesterday, nextDueIn7Days, yesterday, nextDueIn7Days]
    );

    const qaFeed = await request(app).get('/api/refills/panel?upcoming_days=7');
    expect(qaFeed.status).toBe(200);
    expect(qaFeed.body.find((g: any) => Number(g.customer_id) === 28306)).toBeUndefined();

    // Verify partial fulfill-all honors refill_ids strictly (only 166 fulfilled, 167 untouched)
    const dueToday = addDaysSql(0);
    await db.run(`UPDATE patient_refills SET last_refill_date = NULL, next_refill_date = ?, qa_cart_qty = 2, cart_status = 'qa_queued' WHERE id IN (166, 167)`, [dueToday]);
    const fulfillRes = await request(app)
      .post('/api/refills/patient/9096610977/fulfill-all')
      .send({ refill_ids: [166], customer_id: 28306, fulfilled_via: 'quick_assist_complete' });
    expect(fulfillRes.status).toBe(200);

    const row166 = await db.get('SELECT last_refill_date, qa_cart_qty, cart_status FROM patient_refills WHERE id = 166');
    const row167 = await db.get('SELECT last_refill_date, qa_cart_qty, cart_status FROM patient_refills WHERE id = 167');
    expect(row166.last_refill_date).toBeTruthy();
    expect(row166.qa_cart_qty).toBeNull();
    expect(row166.cart_status).toBe('pending');
    expect(row167.last_refill_date).toBeNull();
    expect(row167.qa_cart_qty).toBe(2);
  });

  it('Early CRM Addition (17 days ahead): allowed into QA without advancing refill date, visible in QA as early_crm_addition, and prevents duplicates when due date arrives', async () => {
    await db.run(`INSERT INTO customers (id, name, phone) VALUES (707, 'Early Patient', '9111122222')`);
    const dueNov27 = addDaysSql(17);
    await db.run(
      `INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, quantity_needed, refill_interval_days, last_refill_date, next_refill_date, is_active, status) VALUES
       (701, 707, 1, 'Early Patient', '9111122222', 3, 30, NULL, ?, 1, 'pending'),
       (702, 707, 2, 'Early Patient', '9111122222', 2, 30, NULL, ?, 1, 'pending')`,
      [dueNov27, dueNov27]
    );

    // 1. Pharmacist explicitly selects #701 early from CRM -> allowed immediately even though 17 days away
    const stageEarly = await request(app)
      .post('/api/refills/qa-stage')
      .send({ items: [{ refill_id: 701, qty: 4 }] });
    expect(stageEarly.status).toBe(200);
    expect(stageEarly.body.staged_count).toBe(1);
    expect(stageEarly.body.staged_items[0]).toMatchObject({
      refill_id: 701,
      qty: 4,
      selection_type: 'early_crm_addition',
      scheduled_due_date: dueNov27
    });
    expect(mockAdd).not.toHaveBeenCalled();

    // Staging did NOT advance next_refill_date or set last_refill_date
    const rowAfterStage = await db.get('SELECT next_refill_date, last_refill_date, status, qa_cart_qty FROM patient_refills WHERE id = 701');
    expect(rowAfterStage.next_refill_date).toBe(dueNov27);
    expect(rowAfterStage.last_refill_date).toBeNull();
    expect(rowAfterStage.status).toBe('pending');
    expect(rowAfterStage.qa_cart_qty).toBe(4);

    // 2. QA Panel displays ONLY #701 (with patient/refill identity, medicine, qty, due date, and is_early_crm_addition = true); unselected #702 stays out of QA while far away
    const qaPanel = await request(app).get('/api/refills/panel?upcoming_days=7');
    expect(qaPanel.status).toBe(200);
    const earlyGroup = qaPanel.body.find((g: any) => Number(g.customer_id) === 707);
    expect(earlyGroup).toBeDefined();
    expect(earlyGroup.medicines).toHaveLength(1);
    expect(earlyGroup.medicines[0]).toMatchObject({
      id: 701,
      medicine_name: 'TELMA 40MG TAB',
      qa_cart_qty: 4,
      next_refill_date: dueNov27,
      is_early_crm_addition: true
    });

    // 3. QA approves Add to Cart -> writes Pharmarack Live Cart cleanly, STILL keeps next_refill_date = dueNov27 & last_refill_date = NULL (separate from fulfillment)
    const addRes = await request(app).post('/api/refills/701/add-to-cart').send({});
    expect(addRes.status).toBe(200);
    expect(addRes.body.status).toBe('added');

    const rowAfterCart = await db.get('SELECT next_refill_date, last_refill_date, cart_cycle_due_date, qa_staged_at, cart_status, status FROM patient_refills WHERE id = 701');
    expect(rowAfterCart.next_refill_date).toBe(dueNov27);
    expect(rowAfterCart.last_refill_date).toBeNull();
    expect(rowAfterCart.cart_cycle_due_date).toBe(dueNov27);
    expect(rowAfterCart.qa_staged_at).toBeTruthy();
    expect(rowAfterCart.cart_status).toBe('added');
    expect(rowAfterCart.status).toBe('ordered');

    // 4. Attempting to re-stage #701 in this same cycle (e.g. when 27 Nov due date arrives) prevents duplicates, while sibling #702 remains eligible
    const dupStageRes = await request(app)
      .post('/api/refills/qa-stage')
      .send({ items: [{ refill_id: 701, qty: 4 }, { refill_id: 702, qty: 2 }] });
    expect(dupStageRes.status).toBe(200);
    expect(dupStageRes.body.staged_ids).toEqual([702]);
    expect(dupStageRes.body.skipped_duplicates).toEqual([
      expect.objectContaining({ refill_id: 701, reason: 'already_in_live_cart', existing_status: 'in_live_cart' })
    ]);
  });

  it('Schema Safety: migrates legacy pre-v86 DB cleanly and builds idx_patient_refills_qa_staged index', async () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-qa-legacy-v85-'));
    const legacyDbPath = path.join(legacyDir, 'legacy.db');
    const rawDb = await open({ filename: legacyDbPath, driver: sqlite3.Database });
    await rawDb.exec(`
      CREATE TABLE schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);
      INSERT INTO schema_version (id, version) VALUES (1, 85);
      CREATE TABLE patient_refills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        medicine_id INTEGER,
        patient_name TEXT,
        patient_phone TEXT,
        refill_interval_days INTEGER DEFAULT 30,
        last_refill_date DATETIME,
        next_refill_date DATETIME,
        is_active INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending'
      );
      INSERT INTO patient_refills (customer_id, medicine_id, patient_name, patient_phone) VALUES (1, 1, 'Legacy Patient', '9000000001');
    `);
    await rawDb.close();

    // Run ensureSchema against legacy DB without losing existing row
    await dbManager.close(true);
    process.env.DB_PATH = legacyDbPath;
    await ensureSchema(legacyDbPath);
    const migratedDb = await dbManager.getConnection();
    const cols: Array<{ name: string }> = await migratedDb.all('PRAGMA table_info(patient_refills)');
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('qa_cart_qty');
    expect(colNames).toContain('qa_staged_at');
    expect(colNames).toContain('cart_cycle_due_date');
    expect(colNames).toContain('updated_at');

    const idx = await migratedDb.get(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_patient_refills_qa_staged'`);
    expect(idx?.name).toBe('idx_patient_refills_qa_staged');

    const legacyRow = await migratedDb.get(`SELECT patient_name FROM patient_refills WHERE patient_phone = '9000000001'`);
    expect(legacyRow?.patient_name).toBe('Legacy Patient');

    await dbManager.close(true);
    process.env.DB_PATH = dbPath;
    db = await dbManager.getConnection();
    fs.rmSync(legacyDir, { recursive: true, force: true });
  });
});
