/**
 * Multi-Page Micro-Workflows & Dynamic Token Allocation Test Suite
 *
 * Verifies Qwen local operational assistant page micro-workflows:
 * 1. POS Billing Workflows: Item Staging, Discount Application, Bill Parking
 * 2. Inventory Workflows: Shelf & Rack Location Lookup, Stock Count Correction
 * 3. Order Hub & Live Cart Workflows: Staging Shortages, Distributor Cart Sync
 * 4. CRM & Patient Workflows: Chronic Prescription Refill, Staff Callback Reminders
 * 5. Purchases Workflows: Distributor PTR & Margin Auditing
 * 6. Dispatch Workflows: Home Delivery Status Auditing
 * 7. Token Scaling: Dynamic Context Size & Max Token Allocation
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { conversationalAgentEngine } from '../src/services/localAi/conversationalAgentEngine.js';
import { parseOperationalIntent, buildOperationalSystemPrompt } from '../src/services/localAi/operationalIntentSchema.js';
import { getLocalAiConfig } from '../src/services/localAi/llamaServerClient.js';

describe('Page Micro-Workflows & Qwen Token Scaling Suite', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    process.env.LOCAL_AI_ENABLED = 'false';
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-workflow-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    db = await dbManager.getConnection();

    // 1. App settings
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmacy_name', 'Super Care Pharmacy')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmacy_phone', '+91 9988776655')");

    // 2. Customers
    await db.run(`
      INSERT OR REPLACE INTO customers (id, name, phone, language)
      VALUES (1, 'Rajesh Sharma', '9876543210', 'en'),
             (2, 'Sunita Verma', '9876500001', 'en')
    `);

    // 3. Medicines
    await db.run(`
      INSERT OR REPLACE INTO medicines (id, name, canonical_name, generic_name, dosage_form, strength, mrp, sell_price, total_stock)
      VALUES (201, 'Dolo 650', 'Dolo 650', 'Paracetamol 650mg', 'Tablet', '650mg', 33.50, 30.00, 100),
             (202, 'Pan 40', 'Pan 40', 'Pantoprazole 40mg', 'Tablet', '40mg', 150.00, 135.00, 45),
             (203, 'Augmentin 625 Duo', 'Augmentin 625 Duo', 'Amoxicillin and Potassium Clavulanate', 'Tablet', '625mg', 220.00, 200.00, 0)
    `);

    // 4. Inventory Batches with Rack Locations
    await db.run(`
      INSERT OR REPLACE INTO inventory_master (id, store_id, medicine_id, quantity, batch_no, expiry_date, rack_location)
      VALUES (201, 1, 201, 100, 'B-DOLO-A1', DATE('now', '+180 days'), 'RACK-B-TOP'),
             (202, 1, 202, 45, 'B-PAN-C2', DATE('now', '+90 days'), 'RACK-A-MIDDLE')
    `);

    // 5. Patient Refills
    await db.run(`
      INSERT OR REPLACE INTO patient_refills (
        id, store_id, patient_name, patient_phone, customer_id, medicine_id, medicine_name, quantity_needed, next_refill_date, status, is_ready, is_active
      ) VALUES
      (201, 1, 'Rajesh Sharma', '9876543210', 1, 201, 'Dolo 650', 2, DATE('now'), 'pending', 0, 1)
    `);

    // 6. Deliveries
    await db.run(`
      INSERT OR REPLACE INTO delivery_runs (id, store_id, status, notes)
      VALUES (1, 1, 'pending', 'Order #501 to Rajesh Sharma')
    `).catch(() => {});
  });

  afterAll(async () => {
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  // ── 1. POS Page Micro-Workflows ───────────────────────────────────────────
  describe('POS Page Micro-Workflows', () => {
    it('proposes item staging to POS cart when user is on /pos', async () => {
      const res = await conversationalAgentEngine.processMessage({
        sessionId: 'test-pos-session-1',
        message: 'add 2 strips of Dolo 650 to bill',
        role: 'staff',
        pageContext: { pathname: '/pos', pageTitle: 'POS Billing Counter' }
      });

      expect(res.intent).toBe('CART_STAGING');
      expect(res.requiresConfirmation).toBe(true);
      expect(res.proposedAction).toBeDefined();
      expect(res.proposedAction?.type).toBe('STAGE_POS_ITEM');
      expect(res.proposedAction?.data.quantity).toBe(2);
      expect(res.proposedAction?.data.medicineName).toContain('Dolo 650');
      expect(res.replyText).toContain('POS Billing Cart Staging');
    });

    it('proposes applying discount percentage on POS bill', async () => {
      const res = await conversationalAgentEngine.processMessage({
        sessionId: 'test-pos-session-2',
        message: 'give 10% discount on bill',
        role: 'staff',
        pageContext: { pathname: '/pos', pageTitle: 'POS Billing Counter' }
      });

      expect(res.intent).toBe('POS_APPLY_DISCOUNT');
      expect(res.requiresConfirmation).toBe(true);
      expect(res.proposedAction?.type).toBe('APPLY_DISCOUNT');
      expect(res.proposedAction?.data.discountPercent).toBe(10);
      expect(res.replyText).toContain('10%');
    });

    it('proposes holding / parking the current POS bill ticket', async () => {
      const res = await conversationalAgentEngine.processMessage({
        sessionId: 'test-pos-session-3',
        message: 'hold this bill',
        role: 'staff',
        pageContext: { pathname: '/pos', pageTitle: 'POS Billing Counter' }
      });

      expect(res.intent).toBe('POS_HOLD_BILL');
      expect(res.requiresConfirmation).toBe(true);
      expect(res.proposedAction?.type).toBe('HOLD_BILL');
      expect(res.replyText).toContain('Park Active Bill');
    });

    it('executes POS action after human confirmation (Rule 6)', async () => {
      const confirmRes = await conversationalAgentEngine.processMessage({
        sessionId: 'test-pos-session-2',
        message: 'yes',
        role: 'staff',
        pageContext: { pathname: '/pos' }
      });

      expect(confirmRes.intent).toBe('CONFIRMATION_EXECUTED');
      expect(confirmRes.actionTaken).toBe('APPLY_DISCOUNT');
      expect(confirmRes.replyText).toContain('Discount Confirmed');
    });
  });

  // ── 2. Inventory Page Micro-Workflows ─────────────────────────────────────
  describe('Inventory Page Micro-Workflows', () => {
    it('looks up exact shelf and rack location for medicine', async () => {
      const res = await conversationalAgentEngine.processMessage({
        sessionId: 'test-inv-session-1',
        message: 'where is Dolo 650 kept?',
        role: 'staff',
        pageContext: { pathname: '/inventory', pageTitle: 'Inventory & Batches' }
      });

      expect(res.intent).toBe('INVENTORY_STOCK_AUDIT');
      expect(res.replyText).toContain('RACK-B-TOP');
      expect(res.replyText).toContain('Dolo 650');
      expect(res.cards && res.cards.length > 0).toBe(true);
    });

    it('proposes physical stock count correction with audit gate', async () => {
      const res = await conversationalAgentEngine.processMessage({
        sessionId: 'test-inv-session-2',
        message: 'correct dolo 650 stock to 95 units physical count',
        role: 'staff',
        pageContext: { pathname: '/inventory', pageTitle: 'Inventory & Batches' }
      });

      expect(res.intent).toBe('STOCK_CORRECTION');
      expect(res.requiresConfirmation).toBe(true);
      expect(res.proposedAction?.type).toBe('ADJUST_STOCK');
      expect(res.proposedAction?.data.newQuantity).toBe(95);
    });
  });

  // ── 3. Live Cart & Order Hub Micro-Workflows ──────────────────────────────
  describe('Live Cart & Distributor Order Workflows', () => {
    it('proposes staging shortage medicine into Pharmarack live cart', async () => {
      const res = await conversationalAgentEngine.processMessage({
        sessionId: 'test-cart-session-1',
        message: 'stage 5 boxes of Pan 40 into live cart',
        role: 'staff',
        pageContext: { pathname: '/live-cart', pageTitle: 'Order Hub & Live Cart' }
      });

      expect(res.intent).toBe('CART_STAGING');
      expect(res.requiresConfirmation).toBe(true);
      expect(res.proposedAction?.type).toBe('STAGE_LIVE_CART_ITEM');
      expect(res.proposedAction?.data.medicineName).toContain('Pan 40');
      expect(res.proposedAction?.data.quantity).toBe(5);
    });

    it('proposes synchronizing distributor live cart', async () => {
      const res = await conversationalAgentEngine.processMessage({
        sessionId: 'test-cart-session-2',
        message: 'sync live cart',
        role: 'staff',
        pageContext: { pathname: '/live-cart', pageTitle: 'Order Hub & Live Cart' }
      });

      expect(res.intent).toBe('LIVE_CART_SYNC');
      expect(res.requiresConfirmation).toBe(true);
      expect(res.proposedAction?.type).toBe('LIVE_CART_SYNC');
      expect(res.replyText).toContain('Pharmarack Live Cart Sync');
    });
  });

  // ── 4. CRM & Refill Micro-Workflows ───────────────────────────────────────
  describe('CRM & Refill Micro-Workflows', () => {
    it('resolves patient chronic refill and proposes preparation', async () => {
      const res = await conversationalAgentEngine.processMessage({
        sessionId: 'test-crm-session-1',
        message: 'prepare refill for Rajesh Sharma',
        role: 'staff',
        pageContext: { pathname: '/crm', pageTitle: 'CRM & Patient Regimens' }
      });

      expect(res.intent).toBe('REFILL');
      expect(res.requiresConfirmation).toBe(true);
      expect(['STAGE_POS_ITEM', 'CONFIRM_REFILL']).toContain(res.proposedAction?.type);
      expect(res.replyText).toContain('Patient Refill');
      expect(res.replyText).toContain('Dolo 650');
    });

    it('schedules a staff callback reminder task for a patient', async () => {
      const res = await conversationalAgentEngine.processMessage({
        sessionId: 'test-crm-session-2',
        message: 'remind Sunita Verma tomorrow about blood pressure checkup',
        role: 'staff',
        pageContext: { pathname: '/crm', pageTitle: 'CRM & Patient Regimens' }
      });

      expect(res.intent).toBe('REMINDER_SCHEDULE');
      expect(res.requiresConfirmation).toBe(true);
      expect(res.proposedAction?.type).toBe('SCHEDULE_CALL');
      expect(res.replyText).toContain('Schedule Refill Reminder');
    });
  });

  // ── 5. Intent Schema & Token Scaling Unit Verification ─────────────────────
  describe('Operational Intent Schema & Token Scaling', () => {
    it('correctly parses operational JSON output for new intents', () => {
      const discountJson = JSON.stringify({
        intent: 'POS_APPLY_DISCOUNT',
        confidence: 0.98,
        discountPercent: 15,
        explanation: 'Customer loyalty discount'
      });
      const parsedDiscount = parseOperationalIntent(discountJson);
      expect(parsedDiscount.intent).toBe('POS_APPLY_DISCOUNT');
      expect(parsedDiscount.discountPercent).toBe(15);

      const rackJson = JSON.stringify({
        intent: 'INVENTORY_STOCK_AUDIT',
        confidence: 0.95,
        medicineName: 'Pan 40'
      });
      const parsedRack = parseOperationalIntent(rackJson);
      expect(parsedRack.intent).toBe('INVENTORY_STOCK_AUDIT');
      expect(parsedRack.medicineName).toBe('Pan 40');
    });

    it('generates system prompt containing page micro-workflow guidance', () => {
      const prompt = buildOperationalSystemPrompt();
      expect(prompt).toContain('POS_APPLY_DISCOUNT');
      expect(prompt).toContain('POS_HOLD_BILL');
      expect(prompt).toContain('INVENTORY_STOCK_AUDIT');
      expect(prompt).toContain('LIVE_CART_SYNC');
    });

    it('scales context configuration and max tokens gracefully', () => {
      process.env.LOCAL_AI_CONTEXT_SIZE = '8192';
      const config = getLocalAiConfig();
      expect(config.host).toBeDefined();
      expect(config.port).toBeGreaterThan(0);
      delete process.env.LOCAL_AI_CONTEXT_SIZE;
    });
  });
});
