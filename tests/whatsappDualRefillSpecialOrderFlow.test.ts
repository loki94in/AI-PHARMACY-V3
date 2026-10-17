import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate WhatsApp auth dir
process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-dual-order-auth-'));

const enqueueMock = jest.fn((..._args: any[]) => Promise.resolve({ id: 1 }));
jest.unstable_mockModule('../src/services/whatsappQueueWorker.js', () => ({
  __esModule: true,
  whatsappQueueWorker: {
    enqueue: enqueueMock,
    forceNext: jest.fn(() => Promise.resolve())
  }
}));

jest.unstable_mockModule('../src/services/pharmarackCatalogCache.js', () => ({
  __esModule: true,
  searchCatalog: jest.fn(() => Promise.resolve([])),
  scoreProductName: jest.fn(() => 0),
  pharmarackCatalogCache: {
    syncCatalog: jest.fn(() => Promise.resolve({ synced: 0, errors: 0 })),
    searchCatalog: jest.fn(() => Promise.resolve([]))
  },
  ensureCatalogSyncCron: jest.fn(),
  stopCatalogSyncCron: jest.fn()
}));

jest.unstable_mockModule('../src/services/scispacyClient.js', () => ({
  __esModule: true,
  queryScispacy: jest.fn(() => Promise.resolve(null)),
  startScispacySidecar: jest.fn(),
  stopScispacySidecar: jest.fn()
}));

jest.unstable_mockModule('../src/services/refillCartService.js', () => ({
  __esModule: true,
  processRefillCartItem: jest.fn(() => Promise.resolve({ status: 'added', line: { storeName: 'AI Pharmacy' }, qty: 1 })),
  sendRefillCartSummary: jest.fn(() => Promise.resolve())
}));

import { ensureSchema } from '../src/database.js';

describe('WhatsApp Dual Refill & Special Order Disambiguation Flow', () => {
  let tmpDir: string;
  let dbPath: string;
  let handleInbound: any;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-dual-order-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    db = await dbManager.getConnection();

    handleInbound = (await import('../src/services/whatsappIntentService.js')).handleInbound;
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  beforeEach(() => {
    enqueueMock.mockClear();
  });

  test('1. Dynamic Greeting includes Special Order (Option 4) when customer has past special orders', async () => {
    const phone = '919100000001';
    const cleanDigits = '9100000001';

    await db.run(
      `INSERT INTO customers (name, phone) VALUES (?, ?)`,
      ['Vikas Shinde', cleanDigits]
    );

    // Seed past special order for this customer
    await db.run(
      `INSERT INTO special_orders (store_id, requester, phone, product, qty, status, date)
       VALUES (1, 'Vikas Shinde', ?, 'Telma 40', 2, 'Pending', '2026-10-17')`,
      [cleanDigits]
    );

    // Inbound greeting
    await handleInbound({
      from: `${phone}@c.us`,
      body: 'Hi',
      hasMedia: false,
      timestamp: Date.now()
    });

    expect(enqueueMock).toHaveBeenCalled();
    const sentMsg = enqueueMock.mock.calls[0][1] as string;
    expect(sentMsg).toContain('Special Order');
    expect(sentMsg).toContain('Telma 40');
    expect(sentMsg).toContain('4️⃣');
  });

  test('2. Replying 4 for customer with special orders presents special order reorder choices', async () => {
    const phone = '919100000001';
    const cleanDigits = '9100000001';

    // Send 4 (Special Order)
    await handleInbound({
      from: `${phone}@c.us`,
      body: '4',
      hasMedia: false,
      timestamp: Date.now()
    });

    expect(enqueueMock).toHaveBeenCalled();
    const sentMsg = enqueueMock.mock.calls[0][1] as string;
    expect(sentMsg).toContain('Special Orders on record');
    expect(sentMsg).toContain('Telma 40');
  });

  test('3. When customer confirms refill, it confirms directly without special order prompt or new special_orders entry', async () => {
    const phone = '919100000002';
    const cleanDigits = '9100000002';

    // Seed customer
    await db.run(
      `INSERT INTO customers (name, phone) VALUES (?, ?)`,
      ['Pooja Sharma', cleanDigits]
    );

    // Seed medicine and refill
    const medRes = await db.run(
      `INSERT INTO medicines (name, mrp) VALUES ('Metformin 500', 45.0)`
    );
    const medId = medRes.lastID;

    await db.run(
      `INSERT INTO patient_refills (customer_id, patient_name, patient_phone, medicine_id, quantity_needed, is_active, status)
       VALUES (2, 'Pooja Sharma', ?, ?, 2, 1, 'pending')`,
      [cleanDigits, medId]
    );

    // Seed existing special order
    await db.run(
      `INSERT INTO special_orders (store_id, requester, phone, product, qty, status, date)
       VALUES (1, 'Pooja Sharma', ?, 'Augmentin 625', 1, 'Pending', '2026-10-17')`,
      [cleanDigits]
    );

    const initialSoCount = (await db.get(`SELECT COUNT(*) as cnt FROM special_orders WHERE phone LIKE ?`, ['%9100000002'])).cnt;

    // Inbound confirmation: "yes" / "confirm"
    await handleInbound({
      from: `${phone}@c.us`,
      body: 'confirm',
      hasMedia: false,
      timestamp: Date.now()
    });

    expect(enqueueMock).toHaveBeenCalled();
    const sentMsg = enqueueMock.mock.calls[0][1] as string;
    // Must directly confirm the Refill
    expect(sentMsg).toContain('Refill Confirmed');
    expect(sentMsg).not.toContain('Order Options');
    expect(sentMsg).not.toContain('Special Order Only');

    // Verify DB states: Refill marked confirmed
    const refill = await db.get(`SELECT patient_confirmed FROM patient_refills WHERE patient_phone LIKE ?`, ['%9100000002']);
    expect(refill.patient_confirmed).toBe(1);

    // Verify no new special orders were created by confirming the refill
    const afterSoCount = (await db.get(`SELECT COUNT(*) as cnt FROM special_orders WHERE phone LIKE ?`, ['%9100000002'])).cnt;
    expect(afterSoCount).toBe(initialSoCount);
  });

  test('4. Selecting Option 3 (Refill) lists ONLY chronic refills, never past special orders', async () => {
    const phone = '919100000002';
    const cleanDigits = '9100000002';

    // Clear queue mocks
    enqueueMock.mockClear();

    // Customer receives greeting and is awaiting order type choice
    await db.run(
      `INSERT INTO wa_pending_clarifications (phone, suggested_name, original_query, step, customer_name, created_at)
       VALUES (?, '', 'hi', 'awaiting_order_type', 'Pooja Sharma', CURRENT_TIMESTAMP)
       ON CONFLICT(phone) DO UPDATE SET step = 'awaiting_order_type'`,
      [cleanDigits]
    );

    // Customer sends '3' (Refill)
    await handleInbound({
      from: `${phone}@c.us`,
      body: '3',
      hasMedia: false,
      timestamp: Date.now()
    });

    expect(enqueueMock).toHaveBeenCalled();
    const sentMsg = enqueueMock.mock.calls[0][1] as string;
    expect(sentMsg).toContain('Metformin 500');
    expect(sentMsg).not.toContain('Augmentin 625');
    expect(sentMsg).not.toContain('Past Request');
  });

  test('5. Refill opt-out: Customer replies "without [Med Name]" excludes that item', async () => {
    const phone = '919100000003';
    const cleanDigits = '9100000003';

    // Seed clarification in awaiting_refill_choice with 2 medicines
    const bundle = [
      { medicine_name: 'Metformin 500', quantity_needed: 1 },
      { medicine_name: 'Atorvastatin 10', quantity_needed: 1 }
    ];

    await db.run(
      `INSERT INTO wa_pending_clarifications (phone, suggested_name, original_query, step, items_json, created_at)
       VALUES (?, '', '3', 'awaiting_refill_choice', ?, CURRENT_TIMESTAMP)`,
      [cleanDigits, JSON.stringify(bundle)]
    );

    // Customer replies: "without Atorvastatin"
    await handleInbound({
      from: `${phone}@c.us`,
      body: 'without Atorvastatin',
      hasMedia: false,
      timestamp: Date.now()
    });

    expect(enqueueMock).toHaveBeenCalled();
    const sentMsg = enqueueMock.mock.calls[0][1] as string;
    expect(sentMsg).toContain('Updated Order (excluding Atorvastatin)');
    expect(sentMsg).toContain('Metformin 500');
    expect(sentMsg).not.toContain('Atorvastatin 10');
  });
});
