import { jest } from '@jest/globals';

// Mock WhatsApp dependency BEFORE importing any internal modules
const mockSendMessage = jest.fn((..._args: any[]) => Promise.resolve(true));
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: mockSendMessage,
  initClient: jest.fn(() => Promise.resolve(true)),
  destroyClient: jest.fn(() => Promise.resolve()),
  reconnectClient: jest.fn(() => Promise.resolve()),
  forceReconnect: jest.fn(() => Promise.resolve()),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isConnected: true, isReady: true, status: 'CONNECTED' })),
  normalizeWhatsAppPhone: jest.fn((p: string) => p ? String(p).replace(/\D/g, '') : ''),
  shouldRouteToBusiness: jest.fn(() => false),
  hashMessageBody: jest.fn((b: string) => b.length),
  hasSavedSession: jest.fn(() => true),
  isWhatsAppExplicitlyDisabled: jest.fn(() => Promise.resolve(false)),
  markWhatsAppActivity: jest.fn(),
  waitForWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  getChats: jest.fn(() => Promise.resolve([])),
  getChatMessages: jest.fn(() => Promise.resolve([])),
  getMessageMedia: jest.fn(() => Promise.resolve({ mimetype: 'image/jpeg', data: '' })),
  currentQr: null,
  isReady: true,
  setCurrentQr: jest.fn(),
  setIsReady: jest.fn(),
  checkPhoneWhatsAppRegistered: jest.fn(() => Promise.resolve('AVAILABLE')),
  ensureWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  isWhatsAppAutoConnectAllowed: jest.fn(() => true),
  ensureSessionHealth: jest.fn(() => Promise.resolve(true)),
  downloadMessageMediaReliably: jest.fn(() => Promise.resolve(null))
}));

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { ensureSchema } from '../src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbManager: any;
let notificationService: any;

describe('Pharmarack Cart Notifications Tests', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cart-notif-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    notificationService = (await import('../src/services/notificationService.js')).notificationService;
    dbManager = (await import('../src/database/connection.js')).dbManager;
  });

  afterAll(async () => {
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM distributors');
    await db.run('DELETE FROM delivery_boys');
    await db.run('DELETE FROM automation_notifications');
    await db.run('DELETE FROM pharmarack_cart_snapshots');
  });

  test('notifyAboutCartOrder successfully routes messages to distributor and delivery boy', async () => {
    const db = await dbManager.getConnection();

    // 1. Setup distributor
    await db.run(
      "INSERT INTO distributors (name, phone) VALUES (?, ?)",
      ["Test Dist", "9876543210"]
    );

    // 2. Setup active delivery boy
    await db.run(
      "INSERT INTO delivery_boys (name, whatsapp_number, is_active) VALUES (?, ?, ?)",
      ["Delivery Boy John", "8888888888", 1]
    );

    const items = [
      { productName: "Aspirin", qty: 2, packaging: "15's" },
      { productName: "Ibuprofen", qty: 5, packaging: "100 ml" }
    ];

    const deliveryPersons = [
      { name: "Delivery Boy John", code: "DBJ01" }
    ];

    const result = await notificationService.notifyAboutCartOrder("Test Dist", 123, deliveryPersons, items);
    expect(result).toBe(true);

    // Verify distributor notification was enqueued
    const notifs = await db.all("SELECT * FROM automation_notifications WHERE type = 'distributor_cart_order' ORDER BY id ASC");
    expect(notifs.length).toBe(1);
    expect(notifs[0].recipient_phone).toBe("919876543210");

    // Verify distributor message content: concise PO dispatch reminder
    // (official-PO contract — distributor gets Order ID + pickup staff, never the item dump)
    const msg = notifs[0].message;
    expect(msg).toContain("Pharmarack Order");
    expect(msg).toContain("Delivery Boy John");
    expect(msg).not.toContain("Medicines List:");
    expect(msg).not.toContain("Aspirin");

    // Verify placed order was recorded for debounced/batch delivery boy summary
    const placedOrders = await db.all("SELECT * FROM pharmarack_placed_orders WHERE store_name = 'Test Dist'");
    expect(placedOrders.length).toBe(1);

    // Verify notifyDeliveryBoysBatch sends strictly ONE summary message to delivery boy
    const batchOrders = [
      { storeName: "Test Dist", phone: "9876543210", items }
    ];
    const batchRes = await notificationService.notifyDeliveryBoysBatch(batchOrders);
    expect(batchRes).toBe(true);

    const boyNotifs = await db.all("SELECT * FROM automation_notifications WHERE type = 'delivery_boy_batch_summary'");
    expect(boyNotifs.length).toBe(1);
    expect(boyNotifs[0].recipient_phone).toBe("918888888888");
    expect(boyNotifs[0].message).toContain("TODAY DISTRIBUTOR SUMMARY & TOTALS");
    expect(boyNotifs[0].message).toContain("Test Dist");
    expect(boyNotifs[0].message).toContain("Total Today Distributors:* 1");
    expect(boyNotifs[0].message).toContain("Total Today Order Items:* 2");

    // Ensure NO raw itemized medicine breakdown messages were sent to the delivery boy
    const rawBoyNotifs = await db.all("SELECT * FROM automation_notifications WHERE type = 'delivery_boy_batch_order'");
    expect(rawBoyNotifs.length).toBe(0);
  });

  test('notifyDistributorCartOrder lists ALL same-day order numbers in one reminder', async () => {
    const db = await dbManager.getConnection();

    await db.run(
      "INSERT INTO distributors (name, phone) VALUES (?, ?)",
      ["Test Dist Multi", "9876501234"]
    );
    await db.run(
      "INSERT INTO delivery_boys (name, whatsapp_number, is_active) VALUES (?, ?, ?)",
      ["Delivery Boy Jane", "8888801234", 1]
    );

    // Two same-day Pharmarack orders for the same distributor (old + re-placed new)
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    await db.run('DELETE FROM pharmarack_synced_orders WHERE store_name = ?', ['Test Dist Multi']);
    await db.run(
      `INSERT INTO pharmarack_synced_orders (order_no, pharmarack_order_id, store_id, store_name, order_amount, order_date, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['784512', 1, 456, 'Test Dist Multi', 100, todayLocal, Date.now()]
    );
    await db.run(
      `INSERT INTO pharmarack_synced_orders (order_no, pharmarack_order_id, store_id, store_name, order_amount, order_date, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['784519', 2, 456, 'Test Dist Multi', 200, todayLocal, Date.now() + 1]
    );

    const items = [
      { productName: "Aspirin", qty: 2, packaging: "15's" }
    ];
    const result = await notificationService.notifyDistributorCartOrder(
      "Test Dist Multi", 456, items, [{ name: "Delivery Boy Jane", code: "DBJ02" }]
    );
    expect(result.ok).toBe(true);

    const notifs = await db.all(
      "SELECT * FROM automation_notifications WHERE type = 'distributor_cart_order' AND recipient_name = 'Test Dist Multi' ORDER BY id ASC"
    );
    expect(notifs.length).toBe(1);

    // One message carries both IDs, each with its own # prefix
    const msg = notifs[0].message;
    expect(msg).toContain("#784512");
    expect(msg).toContain("#784519");
    expect(msg).toContain("Pharmarack Order");
    // Distributor reminder carries no item dump
    expect(msg).not.toContain("Medicines List:");
    expect(msg).not.toContain("Aspirin");
  });
});
