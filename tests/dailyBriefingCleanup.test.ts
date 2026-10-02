import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';
import { buildDailyOperationalBriefing } from '../src/services/refillService.js';

describe('Daily Operational Briefing Clean Formatting & Fallbacks', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'briefing-cleanup-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    db = await dbManager.getConnection();

    // Insert mock special orders:
    // 1. In-store order (should NOT have 'in_store Order' badge)
    await db.run(`
      INSERT INTO special_orders (id, requester, phone, product, qty, status, customer_order_source, date)
      VALUES (101, 'Mr. ATUL WANKHADE', '9999999901', 'DK GEL 30GM', 1, 'Ready', 'in_store', DATE('now', 'localtime'))
    `);

    // 2. WhatsApp order (should show 'WhatsApp', without redundant 'Order')
    await db.run(`
      INSERT INTO special_orders (id, requester, phone, product, qty, status, customer_order_source, date)
      VALUES (102, 'Mr. MOKASHI', '9999999902', 'ISMO 20MG', 2, 'Ready', 'whatsapp', DATE('now', 'localtime'))
    `);

    // 3. Order with empty product but valid medicine_name (should resolve medicine_name)
    await db.run(`
      INSERT INTO special_orders (id, requester, phone, product, medicine_name, qty, status, customer_order_source, date)
      VALUES (103, 'Ratnakar', '9999999903', '', 'TELMA 40', 4, 'Pending', 'whatsapp', DATE('now', 'localtime'))
    `);

    // 4. In-store order with 2 items
    await db.run(`
      INSERT INTO special_orders (id, requester, phone, product, qty, status, customer_order_source, date)
      VALUES (104, 'Mr. DIPAK KOTHAWALE', '9999999904', 'AGOTY TAB 10S', 1, 'Ordered', 'in_store', DATE('now', 'localtime'))
    `);
    await db.run(`
      INSERT INTO special_orders (id, requester, phone, product, qty, status, customer_order_source, date)
      VALUES (105, 'Mr. DIPAK KOTHAWALE', '9999999904', 'BENFOMET FORTE', 1, 'Ready', 'in_store', DATE('now', 'localtime'))
    `);
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

  it('Detailed template omits in_store Order badge and formats clean WhatsApp badge', async () => {
    const { messageText } = await buildDailyOperationalBriefing(db, 'detailed');

    // In-store orders should not contain 'in_store' or 'in_store Order'
    expect(messageText).not.toContain('in_store');
    expect(messageText).not.toContain('in_store Order');

    // In-store orders should be formatted as (1 item) or (2 items)
    expect(messageText).toContain('*Mr. ATUL WANKHADE* (1 item):');
    expect(messageText).toContain('*Mr. DIPAK KOTHAWALE* (2 items):');

    // External WhatsApp order should show clean 'WhatsApp' badge
    expect(messageText).toContain('*Mr. MOKASHI* (1 item • WhatsApp):');

    // Order with blank product should resolve to medicine_name ('TELMA 40')
    expect(messageText).toContain('TELMA 40 × 4 (Pending)');
    expect(messageText).not.toMatch(/-\s+×\s+4/);
  });

  it('Compact template formats clean source tags without in_store noise', async () => {
    const { messageText } = await buildDailyOperationalBriefing(db, 'compact');

    // Should not have raw in_store
    expect(messageText).not.toContain('in_store');

    // In-store should just have item count
    expect(messageText).toContain('*Mr. ATUL WANKHADE* — 1 item (Ready)');

    // WhatsApp should have [WhatsApp] tag
    expect(messageText).toContain('*Mr. MOKASHI* — 1 item [WhatsApp] (Ready)');
  });
});
