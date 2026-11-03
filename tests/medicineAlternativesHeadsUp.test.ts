import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { pharmacyToolRegistry } from '../src/services/localAi/pharmacyToolRegistry.js';
import { conversationalAgentEngine } from '../src/services/localAi/conversationalAgentEngine.js';

describe('Medicine Alternatives RAG Heads-Up Suite', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    process.env.LOCAL_AI_ENABLED = 'false';
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alts-rag-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    db = await dbManager.getConnection();

    // Seed medicines with common salt: "Amoxicillin and Clavulanic Acid"
    await db.run(`
      INSERT OR REPLACE INTO medicines (id, name, generic_name, dosage_form, mrp, sell_price, total_stock, manufacturer, rack)
      VALUES 
        (101, 'Augmentin 625 Duo Tablet', 'Amoxicillin and Clavulanic Acid', 'Tablet', 220.0, 220.0, 0, 'GSK', 'Rack A-1'),
        (102, 'Moxikind-CV 625 Tablet', 'Amoxicillin and Clavulanic Acid', 'Tablet', 195.0, 195.0, 15, 'Mankind', 'Rack B-04'),
        (103, 'Clavam 625 Tablet', 'Amoxicillin and Clavulanic Acid', 'Tablet', 205.0, 205.0, 0, 'Alkem', 'Rack A-12')
    `);

    // Seed inventory_master for Moxikind-CV 625
    await db.run(`
      INSERT OR REPLACE INTO inventory_master (id, medicine_id, batch_no, expiry_date, quantity, mrp, unit_price, rack_location, is_active)
      VALUES (201, 102, 'MK123', '2027-12-31', 15, 195.0, 195.0, 'Rack B-04', 1)
    `);
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  it('partitions alternatives into in-stock and out-of-stock buckets accurately', async () => {
    const result = await pharmacyToolRegistry.findAlternatives('Augmentin 625 Duo Tablet', db);

    expect(result.sourceMedicine).toContain('Augmentin 625');
    expect(result.sourceInStock).toBe(false);

    // Verify inStockCandidates
    expect(result.inStockCandidates).toBeDefined();
    expect(result.inStockCandidates!.length).toBe(1);
    expect(result.inStockCandidates![0].name).toBe('Moxikind-CV 625 Tablet');
    expect(result.inStockCandidates![0].stockQuantity).toBe(15);
    expect(result.inStockCandidates![0].rackLocation).toBe('Rack B-04');

    // Verify outOfStockCandidates
    expect(result.outOfStockCandidates).toBeDefined();
    expect(result.outOfStockCandidates!.length).toBe(1);
    expect(result.outOfStockCandidates![0].name).toBe('Clavam 625 Tablet');
    expect(result.outOfStockCandidates![0].inStock).toBe(false);

    // Verify counts and structured heads-up summary
    expect(result.inStockCount).toBe(1);
    expect(result.outOfStockCount).toBe(1);
    expect(result.headsUpSummary).toContain('Heads-Up for Augmentin 625');
    expect(result.headsUpSummary).toContain('WHAT WE HAVE (In-Stock Alternatives');
    expect(result.headsUpSummary).toContain('WHAT WE DON\'T (Out-of-Stock Alternatives');
    expect(result.headsUpSummary).toContain('Rack B-04');
  });

  it('synthesizes heads-up in conversational agent with proper card badges', async () => {
    const response = await conversationalAgentEngine.processMessage({
      message: 'This medicine is unavailable. Find an alternative for Augmentin 625 Duo Tablet.',
      role: 'staff',
      channel: 'staff_modal'
    });

    expect(response.intent).toBe('ALTERNATIVES_SEARCH');
    expect(response.replyText).toBeDefined();

    // Verify cards have distinct green/red badges and details
    expect(response.cards).toBeDefined();
    expect(response.cards!.length).toBeGreaterThanOrEqual(2);

    const moxikindCard = response.cards!.find(c => c.title.includes('Moxikind'));
    expect(moxikindCard).toBeDefined();
    expect(moxikindCard!.badgeColor).toBe('green');
    expect(moxikindCard!.details?.inStock).toBe(true);

    const clavamCard = response.cards!.find(c => c.title.includes('Clavam'));
    expect(clavamCard).toBeDefined();
    expect(clavamCard!.badgeColor).toBe('red');
    expect(clavamCard!.details?.inStock).toBe(false);
  });
});
