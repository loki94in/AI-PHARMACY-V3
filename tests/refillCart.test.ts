import { jest } from '@jest/globals';

// ── Pharmarack is mocked: every cart/search call is scripted per test ──────────
type Line = { storeId: number; storeName: string; productCode: string; productName: string; qty: number };
let cartLines: Line[] = [];
let searchItems: any[] = [];
let addBehaviour: 'ok' | 'offline' | 'ghost' = 'ok';

const cartSnapshot = () => {
  const byStore = new Map<number, any>();
  for (const l of cartLines) {
    if (!byStore.has(l.storeId)) byStore.set(l.storeId, { storeId: l.storeId, storeName: l.storeName, items: [] });
    byStore.get(l.storeId).items.push({ ...l });
  }
  return { distributors: [...byStore.values()], totalItems: cartLines.length };
};

const mockLoadLiveCartCore = jest.fn(async () => cartSnapshot());
const mockSearch = jest.fn(async (..._args: any[]) => ({ status: 'ok', items: searchItems }));
const mockAdd = jest.fn(async (items: any[]) => {
  if (addBehaviour === 'offline') return { success: true, offline: true, message: 'Item saved to distributor cart (offline mode).' };
  if (addBehaviour === 'ok') {
    for (const it of items) {
      cartLines.push({ storeId: it.storeId, storeName: it.storeName, productCode: it.productCode, productName: it.productName, qty: it.qty });
    }
  }
  return { success: true, mode: 'Live' };
});
const mockAdjust = jest.fn(async (_order: any) => ({ action: 'removed', productName: 'TELMA 40MG TAB', previousQty: 3, deductedQty: 3, remainingQty: 0, storeName: 'ALPHA PHARMA' }));

jest.unstable_mockModule('../src/routes/pharmarack.js', () => ({
  __esModule: true,
  default: (_req: any, _res: any, next: any) => next(),
  loadLiveCartCore: mockLoadLiveCartCore,
  performPharmarackSearch: mockSearch,
  addItemsToPharmarackCart: mockAdd,
  adjustSpecialOrderInLiveCart: mockAdjust,
  invalidatePharmarackCartCache: jest.fn(),
  resolveCommonOrFrequentDistributor: jest.fn(async () => null),
  isItemInStock: (v: any) => {
    if (v === null || v === undefined || v === '') return false;
    const s = String(v).trim().toLowerCase();
    if (['0', 'out of stock', 'oos', 'nil'].includes(s)) return false;
    const n = parseFloat(s);
    return isNaN(n) ? true : n > 0;
  }
}));

// Every export of src/whatsappClient.ts must exist (ESM link check); this suite never sends WhatsApp.
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

import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';
import request from 'supertest';
import { ensureSchema } from '../src/database.js';

const TELMA_ALPHA = { name: 'TELMA 40MG TAB', distributor: 'ALPHA PHARMA', storeId: 11, productCode: 'A-100', productId: 5001, rate: 80, mrp: 120, stock: '50', mapped: true, packaging: '15 TAB', company: 'GLENMARK' };
const TELMA_BETA = { name: 'TELMA 40MG TAB', distributor: 'BETA MEDICOS', storeId: 22, productCode: 'B-200', productId: 5002, rate: 79, mrp: 120, stock: '12', mapped: true, packaging: '15 TAB', company: 'GLENMARK' };
const OFFLINE_ROW = { name: 'TELMA 40', distributor: 'Local Pharmacy', storeId: 1, productCode: '7', stock: 'Offline', isOffline: true, isLocalPharmacy: true, rate: 96 };
const pickOf = (i: any) => ({ storeId: i.storeId, storeName: i.distributor, productCode: i.productCode, productId: i.productId, productName: i.name, mapped: true });
// Cancel-time cart removal runs in the background (setImmediate → DB → cart); poll for its effect.
const waitFor = async (cond: () => boolean | Promise<boolean>, ms = 3000) => {
  const t0 = Date.now();
  while (!(await cond()) && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 20));
};

describe('Refill → Live Cart (saved distributor links, one medicine at a time)', () => {
  let tmpDir: string;
  let db: any;
  let dbManager: any;
  let svc: typeof import('../src/services/refillCartService.js');
  let app: express.Express;
  let medId: number;
  let refillId: number;
  let mockBroadcast: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refill-cart-test-'));
    const dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    dbManager = (await import('../src/database/connection.js')).dbManager;
    db = await dbManager.getConnection();
    svc = await import('../src/services/refillCartService.js');
    const { eventService } = await import('../src/services/eventService.js');
    mockBroadcast = jest.spyOn(eventService, 'broadcast');
    const refillsRouter = (await import('../src/routes/refills.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/refills', refillsRouter);

    const m = await db.run("INSERT INTO medicines (name) VALUES ('TELMA 40MG TAB')");
    medId = m.lastID;
  });

  afterAll(async () => {
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(async () => {
    cartLines = [];
    searchItems = [TELMA_ALPHA, TELMA_BETA, OFFLINE_ROW];
    addBehaviour = 'ok';
    jest.clearAllMocks();
    await db.run('DELETE FROM medicine_distributor_links');
    await db.run('DELETE FROM patient_refills');
    const r = await db.run(
      "INSERT INTO patient_refills (patient_name, patient_phone, medicine_id, quantity_needed, is_active, status) VALUES ('Ravi', '9876501234', ?, 3, 1, 'pending')",
      [medId]
    );
    refillId = r.lastID;
  });

  test('schema: link table + refill cart columns exist on a fresh DB, and a re-run is idempotent', async () => {
    const cols = (await db.all('PRAGMA table_info(medicine_distributor_links)')).map((c: any) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['medicine_id', 'store_id', 'store_name', 'product_code', 'pick_order']));
    const rc = (await db.all('PRAGMA table_info(patient_refills)')).map((c: any) => c.name);
    expect(rc).toEqual(expect.arrayContaining(['cart_store_id', 'cart_store_name', 'cart_product_code', 'cart_product_name', 'cart_qty']));
    const idx = await db.all("PRAGMA index_list('medicine_distributor_links')");
    expect(idx.some((i: any) => Number(i.unique) === 1)).toBe(true);
    await ensureSchema(process.env.DB_PATH as string); // fast-boot path
    const rc2 = (await db.all('PRAGMA table_info(patient_refills)')).map((c: any) => c.name);
    expect(rc2.filter((c: string) => c === 'cart_qty')).toHaveLength(1);
  });

  test('no saved distributor → needs_link with live candidates only (offline rows never offered), nothing added', async () => {
    const res = await svc.processRefillCartItem(refillId, { qty: 3 });
    expect(res.status).toBe('needs_link');
    expect(res.candidates.map(c => c.storeName)).toEqual(['ALPHA PHARMA', 'BETA MEDICOS']);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('ticked distributor is saved, added, confirmed in the re-read cart and recorded on the refill', async () => {
    const res = await svc.processRefillCartItem(refillId, { qty: 3, pick: [pickOf(TELMA_ALPHA)] });
    expect(res.status).toBe('added');
    expect(res.line).toEqual({ storeName: 'ALPHA PHARMA', productName: 'TELMA 40MG TAB', qty: 3 });
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect((mockAdd.mock.calls[0][0] as any[])[0]).toMatchObject({ storeId: 11, productCode: 'A-100', qty: 3 });
    const links = await db.all('SELECT store_id, product_code FROM medicine_distributor_links WHERE medicine_id = ?', [medId]);
    expect(links).toEqual([{ store_id: 11, product_code: 'A-100' }]);
    const row = await db.get('SELECT cart_store_id, cart_product_code, cart_qty FROM patient_refills WHERE id = ?', [refillId]);
    expect(row).toEqual({ cart_store_id: 11, cart_product_code: 'A-100', cart_qty: 3 });
  });

  test('already in the cart → in_cart and never re-added (a second add would overwrite the qty)', async () => {
    await svc.processRefillCartItem(refillId, { qty: 3, pick: [pickOf(TELMA_ALPHA)] });
    mockAdd.mockClear();
    const res = await svc.processRefillCartItem(refillId, { qty: 3 });
    expect(res.status).toBe('in_cart');
    expect(res.message).toMatch(/ALPHA PHARMA/);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('saved distributor out of stock → linked_oos, highlighted, nothing added', async () => {
    searchItems = [{ ...TELMA_ALPHA, stock: '0' }, TELMA_BETA];
    await db.run(
      "INSERT INTO medicine_distributor_links (medicine_id, store_id, store_name, product_code, product_name) VALUES (?, 11, 'ALPHA PHARMA', 'A-100', 'TELMA 40MG TAB')",
      [medId]
    );
    const res = await svc.processRefillCartItem(refillId, { qty: 3 });
    expect(res.status).toBe('linked_oos');
    expect(res.linked[0]).toMatchObject({ storeName: 'ALPHA PHARMA', inStock: false });
    expect(res.candidates.find(c => c.storeName === 'BETA MEDICOS')?.inStock).toBe(true);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('several ticked + in stock → adds to ONE: the distributor already in the cart', async () => {
    cartLines = [{ storeId: 22, storeName: 'BETA MEDICOS', productCode: 'X-1', productName: 'DOLO 650', qty: 2 }];
    const res = await svc.processRefillCartItem(refillId, { qty: 3, pick: [pickOf(TELMA_ALPHA), pickOf(TELMA_BETA)] });
    expect(res.status).toBe('added');
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect((mockAdd.mock.calls[0][0] as any[])[0]).toMatchObject({ storeId: 22, productCode: 'B-200' });
  });

  test('"success + offline" from the cart API is reported as failed, not added', async () => {
    addBehaviour = 'offline';
    const res = await svc.processRefillCartItem(refillId, { qty: 3, pick: [pickOf(TELMA_ALPHA)] });
    expect(res.status).toBe('failed');
    const row = await db.get('SELECT cart_product_code FROM patient_refills WHERE id = ?', [refillId]);
    expect(row.cart_product_code).toBeNull();
  });

  test('add accepted but the line never shows in the cart → failed (no false "Added")', async () => {
    addBehaviour = 'ghost';
    const res = await svc.processRefillCartItem(refillId, { qty: 3, pick: [pickOf(TELMA_ALPHA)] });
    expect(res.status).toBe('failed');
    expect(res.message).toMatch(/not showing in the cart/);
  });

  test('route: POST /:id/add-to-cart returns the outcome; success only when the cart changed', async () => {
    const needs = await request(app).post(`/api/refills/${refillId}/add-to-cart`).send({ qty: 3 });
    expect(needs.status).toBe(200);
    expect(needs.body).toMatchObject({ success: false, status: 'needs_link' });
    const added = await request(app).post(`/api/refills/${refillId}/add-to-cart`).send({ qty: 3, pick: [pickOf(TELMA_ALPHA)] });
    expect(added.body).toMatchObject({ success: true, status: 'added' });
    const missing = await request(app).post('/api/refills/999999/add-to-cart').send({});
    expect(missing.status).toBe(404);
  });

  test('route: cancelling a refill removes exactly its cart line and pushes the real result as a toast', async () => {
    await request(app).post(`/api/refills/${refillId}/add-to-cart`).send({ qty: 3, pick: [pickOf(TELMA_ALPHA)] });
    const res = await request(app).post(`/api/refills/${refillId}/cancel`).send({});
    expect(res.body.success).toBe(true);
    const cleared = async () => (await db.get('SELECT cart_product_code FROM patient_refills WHERE id = ?', [refillId])).cart_product_code === null;
    await waitFor(async () => mockBroadcast.mock.calls.some((c: any[]) => c[0] === 'toast_alert') && await cleared());
    expect(mockAdjust).toHaveBeenCalledWith(expect.objectContaining({ productCode: 'A-100', storeId: 11, qty: 3, exactOnly: true }));
    const toast = mockBroadcast.mock.calls.find((c: any[]) => c[0] === 'toast_alert');
    expect(toast?.[1]).toMatchObject({ type: 'success' });
    const row = await db.get('SELECT cart_product_code FROM patient_refills WHERE id = ?', [refillId]);
    expect(row.cart_product_code).toBeNull();
  });

  test('route: cancelling a refill that added nothing never touches the cart', async () => {
    await request(app).post(`/api/refills/${refillId}/cancel`).send({});
    await new Promise(r => setTimeout(r, 300));
    expect(mockAdjust).not.toHaveBeenCalled();
  });
});
