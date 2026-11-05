import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';
import { marketClosureService } from '../src/services/marketClosureService.js';

describe('Market Closure Stock Buffer & Live Cart Integration (P2-146)', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-buffer-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    db = await dbManager.getConnection();
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
    await db.run('DELETE FROM special_orders');
    await db.run('DELETE FROM patient_refills');
    await db.run('DELETE FROM medicines');
    await db.run('DELETE FROM inventory_master');
    await db.run('DELETE FROM medicine_distributor_links');
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmacy_name', 'Test Pharmacy')");
  });

  it('correctly calculates shortfall and recommended order qty in getBufferAnalysis', async () => {
    // 1. Enable market closure
    await marketClosureService.saveConfig({
      enabled: true,
      type: 'market_closed',
      startDate: '2026-11-06',
      endDate: '2026-11-08',
      reason: 'Diwali Market Closure',
      lookaheadDays: 7
    }, db);

    // 2. Insert medicine and inventory
    await db.run(`INSERT INTO medicines (id, name, manufacturer, pack_size, mrp, rate) VALUES (10, 'METOSARTAN LN 25', 'SUNFLOWER', '10', 120, 80)`);
    await db.run(`INSERT INTO inventory_master (store_id, medicine_id, quantity) VALUES (1, 10, 2)`);

    // 3. Insert refill needing 3 strips
    await db.run(`
      INSERT INTO patient_refills (
        id, store_id, patient_name, patient_phone, medicine_id,
        quantity_needed, next_refill_date, is_active, status
      ) VALUES (
        101, 1, 'Mr. Mangal', '9876543210', 10,
        3, '2026-11-07 10:00:00', 1, 'pending'
      )
    `);

    const analysis = await marketClosureService.getBufferAnalysis(db);
    expect(analysis.config.enabled).toBe(true);
    expect(analysis.items.length).toBe(1);

    const item = analysis.items[0];
    expect(item.refill_id).toBe(101);
    expect(item.medicine_name).toBe('METOSARTAN LN 25');
    expect(item.current_stock).toBe(2);
    expect(item.quantity_needed).toBe(3);
    expect(item.shortfall_packs).toBe(1);
    expect(item.recommended_order_qty).toBe(1);
    expect(item.status).toBe('shortfall');
  });

  it('addBufferItemsToCart stages items into special_orders and reports structured outcomes', async () => {
    await marketClosureService.saveConfig({
      enabled: true,
      type: 'market_closed',
      startDate: '2026-11-06',
      endDate: '2026-11-08',
      reason: 'Diwali Market Closure',
      lookaheadDays: 7
    }, db);

    await db.run(`INSERT INTO medicines (id, name, manufacturer) VALUES (20, 'ISMO 20MG STRIP', 'ABBOTT')`);
    await db.run(`
      INSERT INTO patient_refills (
        id, store_id, patient_name, patient_phone, medicine_id,
        quantity_needed, next_refill_date, is_active, status
      ) VALUES (
        201, 1, 'Mr. Mokashi', '9123456780', 20,
        2, '2026-11-07 10:00:00', 1, 'pending'
      )
    `);

    // Call addBufferItemsToCart with refill_id and qty
    const result = await marketClosureService.addBufferItemsToCart([
      {
        refill_id: 201,
        medicine_id: 20,
        medicine_name: 'ISMO 20MG STRIP',
        qty: 3,
        distributor_name: 'BAJAJ PHARMA'
      }
    ], db);

    expect(result).toHaveProperty('results');
    expect(result.results.length).toBe(1);
    expect(result.results[0].medicine_name).toBe('ISMO 20MG STRIP');
    expect(result.results[0].qty).toBe(3);

    // Verify fallback persisted in special_orders for unlinked refill
    const orders = await db.all('SELECT * FROM special_orders WHERE medicine_name = ?', ['ISMO 20MG STRIP']);
    expect(orders.length).toBe(1);
    expect(orders[0].qty).toBe(3);
    expect(orders[0].status).toBe('Pending');
  });
});
