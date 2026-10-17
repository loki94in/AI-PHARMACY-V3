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

  test('3. When customer has BOTH active Refills and Special Orders, affirmative reply triggers 3-way disambiguation', async () => {
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

    // Seed special order
    await db.run(
      `INSERT INTO special_orders (store_id, requester, phone, product, qty, status, date)
       VALUES (1, 'Pooja Sharma', ?, 'Augmentin 625', 1, 'Pending', '2026-10-17')`,
      [cleanDigits]
    );

    // Inbound confirmation: "yes" / "confirm"
    await handleInbound({
      from: `${phone}@c.us`,
      body: 'confirm',
      hasMedia: false,
      timestamp: Date.now()
    });

    expect(enqueueMock).toHaveBeenCalled();
    const sentMsg = enqueueMock.mock.calls[0][1] as string;
    expect(sentMsg).toContain('Order Options');
    expect(sentMsg).toContain('Refill Only');
    expect(sentMsg).toContain('Special Order Only');
    expect(sentMsg).toContain('Combine Both');
    expect(sentMsg).toContain('Metformin 500');
    expect(sentMsg).toContain('Augmentin 625');
  });

  test('4. Disambiguation selection: Reply "3" combines both Refill and Special Order into cart', async () => {
    const phone = '919100000002';

    // Customer replies '3' (Combine Both)
    await handleInbound({
      from: `${phone}@c.us`,
      body: '3',
      hasMedia: false,
      timestamp: Date.now()
    });

    expect(enqueueMock).toHaveBeenCalled();
    const sentMsg = enqueueMock.mock.calls[0][1] as string;
    expect(sentMsg).toContain('Combined Order Confirmed');

    // Verify DB states: Refill marked confirmed
    const refill = await db.get(`SELECT patient_confirmed FROM patient_refills WHERE patient_phone LIKE ?`, ['%9100000002']);
    expect(refill.patient_confirmed).toBe(1);

    // Verify DB states: Special order marked Confirmed and tagged whatsapp_combined
    const so = await db.get(`SELECT status, customer_order_source FROM special_orders WHERE phone LIKE ?`, ['%9100000002']);
    expect(so.status).toBe('Confirmed');
    expect(so.customer_order_source).toBe('whatsapp_combined');
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
