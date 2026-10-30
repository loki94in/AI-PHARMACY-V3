import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { conversationalAgentEngine } from '../src/services/localAi/conversationalAgentEngine.js';
import { knowledgeBaseService } from '../src/services/localAi/knowledgeBaseService.js';
import { dbManager } from '../src/database/connection.js';

describe('Multi-Task & Compound Intent Agent Engine Tests', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-task-agent-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    db = await dbManager.getConnection();

    // Seed knowledge base SOP documents
    await knowledgeBaseService.seedInitialKnowledge(db);

    // Insert test medicines into master & inventory
    await db.run(
      `INSERT OR IGNORE INTO medicines (id, name, generic_name, dosage_form, strength, mrp, sell_price, total_stock)
       VALUES (101, 'DOLO 650MG STRIP', 'Paracetamol', 'Tablet', '650mg', 32.28, 30.00, 15),
              (102, 'CALPOL 500MG TABLET', 'Paracetamol', 'Tablet', '500mg', 20.00, 18.00, 20),
              (103, 'ALEX JUNIOR SYP 60ML', 'Chlorpheniramine + Dextromethorphan', 'Syrup', '60ml', 115.00, 110.00, 5)`
    );

    await db.run(
      `INSERT OR IGNORE INTO inventory_master (id, medicine_id, batch_no, expiry_date, quantity, mrp, unit_price, is_active)
       VALUES (501, 101, 'BATCH-DOLO', '2028-12-31', 15, 32.28, 25.00, 1),
              (502, 102, 'BATCH-CALPOL', '2028-10-31', 20, 20.00, 15.00, 1),
              (503, 103, 'BATCH-ALEX', '2027-08-31', 5, 115.00, 90.00, 1)`
    );
  }, 30000);

  afterAll(async () => {
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  test('Test 1: Multi-Item Batch Staging parses compound quantities and medicines', () => {
    const text = 'Add 10 Dolo 650, 5 Augmentin 625, and 3 Pan 40 to live cart';
    const items = conversationalAgentEngine.extractBatchStagingItems(text);

    expect(items.length).toBe(3);
    expect(items[0].medicineName.toLowerCase()).toContain('dolo 650');
    expect(items[0].quantity).toBe(10);
    expect(items[1].medicineName.toLowerCase()).toContain('augmentin 625');
    expect(items[1].quantity).toBe(5);
    expect(items[2].medicineName.toLowerCase()).toContain('pan 40');
    expect(items[2].quantity).toBe(3);
  });

  test('Test 2: Live cart status inquiry handles user typos (KLIVE CART, ITOM)', async () => {
    const resolved = await (conversationalAgentEngine as any).resolveUnifiedIntent(
      'HOW MANY ITOM WE HAVE IN THE KLIVE CART',
      { pathname: '/pharmarack-cart' },
      'staff'
    );

    expect(resolved.type).toBe('LIVE_CART_STATUS');
  });

  test('Test 3: Placeholder cart staging ("Stage item to live cart") prompts for medicine instead of staging "item"', async () => {
    const res = await conversationalAgentEngine.processMessage({
      message: 'Stage item to live cart',
      role: 'staff',
      pageContext: { pathname: '/pharmarack-cart' }
    });

    expect(res.replyText).toContain('Which medicine would you like to stage to the Pharmarack Live Cart?');
    expect(res.cards?.some(c => c.title === 'Select Medicine')).toBe(true);
    // Crucial: Must NOT require confirmation to stage "item"
    expect(res.requiresConfirmation).toBe(false);
  }, 15000);

  test('Test 4: Raw medicine name entry ("ALEX JUNIOR SYP 60ML") routes to MEDICINE_INQUIRY', async () => {
    const resolved = await (conversationalAgentEngine as any).resolveUnifiedIntent(
      'ALEX JUNIOR SYP 60ML',
      { pathname: '/pos' },
      'staff'
    );

    expect(resolved.type).toBe('MEDICINE_INQUIRY');
    expect(resolved.medicineName?.toLowerCase()).toContain('alex junior');
  });

  test('Test 5: Multi-medicine availability inquiry extracts both entities', async () => {
    const resolved = await (conversationalAgentEngine as any).resolveUnifiedIntent(
      'Do we have Dolo 650 and Calpol 500 in stock?',
      { pathname: '/pos' },
      'staff'
    );

    expect(resolved.type).toBe('MULTI_MEDICINE_INQUIRY');
    expect(resolved.batchItems?.length).toBe(2);
  });

  test('Test 6: SOP procedure question retrieves approved Schedule H SOP citation', async () => {
    const res = await conversationalAgentEngine.processMessage({
      message: 'What is the SOP procedure for dispensing Schedule H prescription medicines?',
      role: 'staff',
      pageContext: { pathname: '/pos' }
    });

    expect(res.replyText.toLowerCase()).toContain('schedule h');
    expect(res.citations && res.citations.length > 0).toBe(true);
    expect(res.citations?.some(c => c.sourceType === 'sop')).toBe(true);
    expect(res.cards?.some(c => c.badge === 'Approved SOP')).toBe(true);
  }, 15000);
});
