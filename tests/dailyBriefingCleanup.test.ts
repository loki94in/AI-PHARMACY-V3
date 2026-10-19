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

  it('Excludes refills fulfilled today or within last 24h from the Daily Briefing', async () => {
    // Insert a medicine
    await db.run(`INSERT OR IGNORE INTO medicines (id, name) VALUES (901, 'AZITHRAL 500')`);
    await db.run(`INSERT OR IGNORE INTO medicines (id, name) VALUES (902, 'PARACETAMOL 650')`);

    // 1. Refill fulfilled today: last_refill_date = today, next_refill_date = tomorrow
    await db.run(`
      INSERT INTO patient_refills (id, patient_name, patient_phone, medicine_id, refill_interval_days, last_refill_date, next_refill_date, status, is_active)
      VALUES (801, 'Mr. FULFILLED TODAY', '9999999801', 901, 30, datetime('now', 'localtime'), date('now', 'localtime', '+1 day'), 'pending', 1)
    `);

    // 2. Refill truly pending (not fulfilled): last_refill_date = 20 days ago, next_refill_date = today
    await db.run(`
      INSERT INTO patient_refills (id, patient_name, patient_phone, medicine_id, refill_interval_days, last_refill_date, next_refill_date, status, is_active)
      VALUES (802, 'Mr. GENUINE PENDING', '9999999802', 902, 30, date('now', 'localtime', '-20 days'), date('now', 'localtime'), 'pending', 1)
    `);

    const { messageText } = await buildDailyOperationalBriefing(db, 'detailed');

    // Fulfilled today must NOT be in the briefing
    expect(messageText).not.toContain('Mr. FULFILLED TODAY');
    expect(messageText).not.toContain('AZITHRAL 500');

    // Genuine pending MUST be in the briefing
    expect(messageText).toContain('Mr. GENUINE PENDING');
    expect(messageText).toContain('PARACETAMOL 650');
  });

  it('autoHealRefillIntervalsAndTasks cures short intervals and advances prematurely triggered next dates', async () => {
    const { autoHealRefillIntervalsAndTasks } = await import('../src/database.js');

    // Insert patient with 1-day interval fulfilled 2 hours ago with next date set to today
    await db.run(`
      INSERT INTO patient_refills (id, patient_name, patient_phone, medicine_id, refill_interval_days, last_refill_date, next_refill_date, status, is_active)
      VALUES (803, 'Mr. SHORT CYCLE', '9999999803', 901, 1, datetime('now', 'localtime', '-2 hours'), date('now', 'localtime'), 'pending', 1)
    `);

    await autoHealRefillIntervalsAndTasks(db);

    const cured = await db.get('SELECT refill_interval_days, next_refill_date FROM patient_refills WHERE id = 803');
    expect(cured.refill_interval_days).toBe(30);
    // next_refill_date should be advanced to +30 days, not today
    expect(cured.next_refill_date).not.toMatch(new RegExp(`^${new Date().toISOString().slice(0, 10)}`));
  });
});
