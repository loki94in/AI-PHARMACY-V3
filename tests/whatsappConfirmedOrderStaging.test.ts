import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate the WhatsApp auth dir BEFORE any app import, same as whatsappRouting.test.ts.
process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-staging-auth-'));

// Mock the outbound send layer so no real WhatsApp network call is attempted.
// This is the ONLY point through which whatsappIntentService transmits messages
// (whatsappQueueWorker.enqueue), so mocking it here lets us assert exactly which
// messages the fixed code paths attempt to send directly vs. stage in the DB.
const enqueueMock = jest.fn(() => Promise.resolve({ id: 1 }));
jest.unstable_mockModule('../src/services/whatsappQueueWorker.js', () => ({
  __esModule: true,
  whatsappQueueWorker: {
    enqueue: enqueueMock,
    forceNext: jest.fn(() => Promise.resolve())
  }
}));

// Pharmarack Live Cart add is mocked to always succeed — this suite verifies the
// customer-messaging staging behavior, not Pharmarack integration itself.
jest.unstable_mockModule('../src/routes/pharmarack.js', () => ({
  __esModule: true,
  addItemsToPharmarackCart: jest.fn(() => Promise.resolve({ success: true, mode: 'Live' })),
  isItemInStock: (v: any) => Number(v) > 0,
  resolveCommonOrFrequentDistributor: jest.fn((_db: any, candidates: any[]) => Promise.resolve(candidates?.[0] ?? null))
}));

import { ensureSchema } from '../src/database.js';

describe('WhatsApp Confirmed Order — customer message staging (WhatsApp Confirmed Order.md)', () => {
  let tmpDir: string;
  let dbPath: string;
  let handleInbound: any;

  const OWNER_PHONE = '919999999999';
  const CUSTOMER_PHONE = '918888888888';

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-staging-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    // Owner number the admin-detection logic (checkIsOwnerPhone -> resolveAdminWhatsappNumber) resolves against.
    // ensureSchema() may already seed a default settings row, so upsert rather than plain INSERT.
    await db.run(
      "INSERT INTO app_settings (key, value) VALUES ('admin_whatsapp', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [OWNER_PHONE]
    );

    handleInbound = (await import('../src/services/whatsappIntentService.js')).handleInbound;
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(async () => {
    enqueueMock.mockClear();
  });

  test('CONFIRM SO-xxxx: final customer message is staged in automation_notifications, not sent directly; owner is notified', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    // In real production use, wa_owner_pending_requests always exists by the time an owner can
    // reply "CONFIRM SO-xxxx" (the owner must first have received the numbered Pharmarack
    // options message, which lazily creates this table). Mirror that precondition here.
    const { ensureOwnerPendingRequestsTable } = await import('../src/services/waAdminEscalationService.js');
    await ensureOwnerPendingRequestsTable(db);

    // wa_pending_clarifications is likewise lazily created by whatsappIntentService's internal
    // (non-exported) ensureClarificationsTable(), which real customer traffic always triggers
    // long before an owner reaches CONFIRM SO-xxxx. Mirror that precondition directly here
    // (same DDL as whatsappIntentService.ts's ensureClarificationsTable).
    await db.run(`CREATE TABLE IF NOT EXISTS wa_pending_clarifications (
      phone TEXT PRIMARY KEY,
      suggested_name TEXT NOT NULL,
      original_query TEXT,
      options_json TEXT,
      selected_option TEXT,
      quantity INTEGER DEFAULT 1,
      unit TEXT DEFAULT 'strip',
      step TEXT DEFAULT 'awaiting_confirmation',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      items_json TEXT DEFAULT NULL,
      raw_qty_given INTEGER DEFAULT 0,
      special_order_id INTEGER DEFAULT NULL,
      so_code TEXT DEFAULT NULL
    )`);

    // Seed a special_orders row in the exact pre-CONFIRM state handleOwnerInteractiveReply expects:
    // payment_status = 'SCREENSHOT_RECEIVED' (set after customer sends the payment screenshot).
    const insertRes = await db.run(
      `INSERT INTO special_orders (
         store_id, requester, phone, medicine_name, product, qty, priority, status,
         payment_status, pharmarack_distributor, pharmarack_rate, pharmarack_mrp
       ) VALUES (1, 'Rahul', ?, 'Zifi 200mg Tablet', 'Zifi 200mg Tablet', 2, 'Normal', 'Pending',
                 'SCREENSHOT_RECEIVED', 'Apex Healthcare', 120, 180)`,
      [CUSTOMER_PHONE]
    );
    const orderId = insertRes.lastID;
    const soCode = `SO-${orderId}`;

    // Act: owner sends "CONFIRM SO-<id>" from the configured owner number.
    await handleInbound({ from: `${OWNER_PHONE}@c.us`, body: `CONFIRM ${soCode}` });

    // Assert: special_orders flipped to VERIFIED/Confirmed.
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    expect(order.payment_status).toBe('VERIFIED');
    expect(order.status).toBe('Confirmed');

    // Assert: the customer-facing final confirmation is STAGED in automation_notifications...
    const staged = await db.get(
      `SELECT * FROM automation_notifications WHERE reference_id = ? AND type = 'whatsapp_order'`,
      [String(orderId)]
    );
    expect(staged).toBeTruthy();
    expect(staged.status).toBe('staged');
    expect(staged.needs_confirmation).toBe(1);
    expect(staged.message).toContain(soCode);
    expect(staged.message).toContain('Your medicine has been added to your Live Cart');
    expect(staged.recipient_phone).toBe(CUSTOMER_PHONE.slice(-10));

    // ...and NOT sent directly to the customer: no enqueue() call targets the customer's number.
    const customerDirectSends = enqueueMock.mock.calls.filter(
      (call: any[]) => String(call[0] || '').replace(/\D/g, '').slice(-10) === CUSTOMER_PHONE.slice(-10)
    );
    expect(customerDirectSends.length).toBe(0);

    // Owner DOES get an automatic notification (via the reused notifyAdminOfLiveCartAdd),
    // confirming success and that the customer message is staged.
    const ownerSends = enqueueMock.mock.calls.filter(
      (call: any[]) => String(call[0] || '').replace(/\D/g, '').slice(-10) === OWNER_PHONE.slice(-10)
    );
    expect(ownerSends.length).toBeGreaterThan(0);
    const ownerMessages = ownerSends.map((call: any[]) => String(call[1] || ''));
    expect(ownerMessages.some(m => m.includes('STAGED') || m.includes('Live Cart'))).toBe(true);
  });

  test('Auto-confirm flow (executeConfirmedProcurementFlow): stages customer message, does not send a direct courtesy ack', async () => {
    const { executeConfirmedProcurementFlow } = await import('../src/services/whatsappIntentService.js');
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    const phone = '917777777777';
    await executeConfirmedProcurementFlow({
      phone: `${phone}@c.us`,
      chatId: `${phone}@c.us`,
      confirmedMedicine: 'Pan 40mg Tablet',
      quantity: 2,
      unit: 'strip',
      customer: { name: 'Priya', phone }
    } as any);

    const order = await db.get(
      `SELECT * FROM special_orders WHERE phone = ? ORDER BY id DESC LIMIT 1`,
      [phone.slice(-10)]
    );
    expect(order).toBeTruthy();
    expect(order.status).toBe('Confirmed');

    const staged = await db.get(
      `SELECT * FROM automation_notifications WHERE reference_id = ? AND type = 'whatsapp_order'`,
      [String(order.id)]
    );
    expect(staged).toBeTruthy();
    expect(staged.status).toBe('staged');

    // No direct send to this customer's number (the removed step-10 courtesy ack).
    const customerDirectSends = enqueueMock.mock.calls.filter(
      (call: any[]) => String(call[0] || '').replace(/\D/g, '').slice(-10) === phone.slice(-10)
    );
    expect(customerDirectSends.length).toBe(0);
  });
});
