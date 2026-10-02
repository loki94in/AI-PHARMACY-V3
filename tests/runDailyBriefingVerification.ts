import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';
import { buildDailyOperationalBriefing } from '../src/services/refillService.js';

async function runVerification() {
  console.log('--- Starting Daily Operational Briefing Verification ---');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'briefing-cleanup-verify-'));
  const dbPath = path.join(tmpDir, 'app.db');
  process.env.DB_PATH = dbPath;

  try {
    await ensureSchema(dbPath);
    const db = await dbManager.getConnection();

    // Setup mock data in special_orders
    // 1. In-store order
    await db.run(`
      INSERT INTO special_orders (id, requester, phone, product, qty, status, customer_order_source, date)
      VALUES (101, 'Mr. ATUL WANKHADE', '9999999901', 'DK GEL 30GM', 1, 'Ready', 'in_store', DATE('now', 'localtime'))
    `);

    // 2. WhatsApp order
    await db.run(`
      INSERT INTO special_orders (id, requester, phone, product, qty, status, customer_order_source, date)
      VALUES (102, 'Mr. MOKASHI', '9999999902', 'ISMO 20MG', 2, 'Ready', 'whatsapp', DATE('now', 'localtime'))
    `);

    // 3. Order with blank product but medicine_name present
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

    // 5. Shortage order (>23h pending) with empty product but valid medicine_name
    await db.run(`
      INSERT INTO special_orders (id, requester, phone, product, medicine_name, qty, status, customer_order_source, date, pharmarack_distributor)
      VALUES (106, 'Ratnakar', '9999999903', '', 'TELMA 40', 4, 'Pending', 'whatsapp', datetime('now', '-25 hours'), 'Apollo Distributor')
    `);

    // Test Detailed Template
    const detailed = await buildDailyOperationalBriefing(db, 'detailed');
    console.log('\n[DETAILED BRIEFING OUTPUT]:\n' + detailed.messageText + '\n');

    // Assertions for Detailed Template:
    assert(!detailed.messageText.includes('in_store'), "FAIL: Found raw 'in_store' in briefing!");
    assert(!detailed.messageText.includes('in_store Order'), "FAIL: Found 'in_store Order' in briefing!");
    assert(detailed.messageText.includes('*Mr. ATUL WANKHADE* (1 item):'), "FAIL: Expected clean '(1 item):'");
    assert(detailed.messageText.includes('*Mr. DIPAK KOTHAWALE* (2 items):'), "FAIL: Expected clean '(2 items):'");
    assert(detailed.messageText.includes('*Mr. MOKASHI* (1 item • WhatsApp):'), "FAIL: Expected clean '(1 item • WhatsApp):'");
    assert(detailed.messageText.includes('TELMA 40 × 4 (Pending)'), "FAIL: Blank product did not resolve to medicine_name!");
    assert(!detailed.messageText.match(/-\s+×\s+4/), "FAIL: Found blank medicine line '-  × 4'!");
    assert(detailed.messageText.includes('TELMA 40 × 4 (Apollo Distributor)'), "FAIL: Shortage item did not resolve medicine_name!");

    // Test Compact Template
    const compact = await buildDailyOperationalBriefing(db, 'compact');
    console.log('\n[COMPACT BRIEFING OUTPUT]:\n' + compact.messageText + '\n');

    assert(!compact.messageText.includes('in_store'), "FAIL: Found raw 'in_store' in compact briefing!");
    assert(compact.messageText.includes('*Mr. ATUL WANKHADE* — 1 item (Ready)'), "FAIL: Expected clean compact in-store format!");
    assert(compact.messageText.includes('*Mr. MOKASHI* — 1 item [WhatsApp] (Ready)'), "FAIL: Expected clean compact WhatsApp format!");

    console.log('✅ ALL BRIEFING TESTS PASSED PERFECTLY!');
  } finally {
    try {
      await dbManager.close(true);
    } catch {}
    delete process.env.DB_PATH;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

runVerification().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
