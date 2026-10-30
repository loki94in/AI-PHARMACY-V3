import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { conversationalAgentEngine } from '../src/services/localAi/conversationalAgentEngine.js';
import { pharmacyToolRegistry } from '../src/services/localAi/pharmacyToolRegistry.js';
import { dbManager } from '../src/database/connection.js';

describe('Unified Patient Refill Orchestration Flow Tests', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;
  let stagedSessionId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-refill-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    db = await dbManager.getConnection();

    // 1. Seed Customer with Outstanding Due
    await db.run(
      `INSERT OR REPLACE INTO customers (id, name, phone, credit_balance, credit_due_date)
       VALUES (701, 'Rajesh Sharma', '9876543210', 450.00, '2026-11-05'),
              (702, 'Pooja Verma', '9876543211', 0.00, NULL)`
    );

    // 2. Seed Medicines
    await db.run(
      `INSERT OR REPLACE INTO medicines (id, name, generic_name, dosage_form, strength, mrp, sell_price, total_stock)
       VALUES (801, 'GLYCOMET GP 1MG TAB', 'Metformin + Glimepiride', 'Tablet', '1mg', 120.00, 110.00, 0),
              (802, 'TELMA 40MG TABLET', 'Telmisartan', 'Tablet', '40mg', 95.00, 85.00, 20)`
    );

    // 3. Seed Shelf Stock in inventory_master (GLYCOMET is out of stock = 0, TELMA has 20 units)
    await db.run(
      `INSERT OR REPLACE INTO inventory_master (id, medicine_id, batch_no, expiry_date, quantity, mrp, unit_price, is_active)
       VALUES (901, 802, 'BATCH-TELMA', '2028-12-31', 20, 95.00, 60.00, 1)`
    );

    // 4. Seed Active Patient Refills
    await db.run(
      `INSERT OR REPLACE INTO patient_refills (id, customer_id, patient_name, patient_phone, medicine_id, medicine_name, quantity_needed, status, is_active, next_refill_date)
       VALUES (1001, 701, 'Rajesh Sharma', '9876543210', 801, 'GLYCOMET GP 1MG TAB', 2, 'active', 1, '2026-10-31'),
              (1002, 702, 'Pooja Verma', '9876543211', 802, 'TELMA 40MG TABLET', 1, 'active', 1, '2026-11-02')`
    );
  }, 30000);

  afterAll(async () => {
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  test('Test 1: orchestrateUnifiedPatientRefillFlow detects shortages and customer dues correctly', async () => {
    const plan = await pharmacyToolRegistry.orchestrateUnifiedPatientRefillFlow('Rajesh', db);

    expect(plan.found).toBe(true);
    expect(plan.customer?.name).toBe('Rajesh Sharma');
    expect(plan.customer?.creditBalance).toBe(450.00);
    expect(plan.hasShortage).toBe(true);
    expect(plan.hasOutstandingDue).toBe(true);

    const target = plan.refills.find(r => r.medicineName.includes('GLYCOMET'));
    expect(target).toBeDefined();
    expect(target?.shortageQty).toBe(2);
    expect(target?.totalStock).toBe(0);
    expect(target?.inStock).toBe(false);

    expect(plan.suggestedActions).toContain('Stage Shortage to Live Cart');
    expect(plan.suggestedActions).toContain('Send WhatsApp Payment QR');
  });

  test('Test 2: In-stock customer refill (Pooja Verma) recommends dispensing and notes zero due', async () => {
    const plan = await pharmacyToolRegistry.orchestrateUnifiedPatientRefillFlow('Pooja', db);

    expect(plan.found).toBe(true);
    expect(plan.customer?.name).toBe('Pooja Verma');
    expect(plan.customer?.creditBalance).toBe(0);
    expect(plan.hasShortage).toBe(false);
    expect(plan.hasOutstandingDue).toBe(false);

    const target = plan.refills.find(r => r.medicineName.includes('TELMA'));
    expect(target?.inStock).toBe(true);
    expect(plan.suggestedActions).toContain('Confirm & Dispense Refill');
    expect(plan.suggestedActions).not.toContain('Send WhatsApp Payment QR');
  });

  test('Test 3: Compound query stages UNIFIED_REFILL_ORCHESTRATION proposal under Rule 6 HITL', async () => {
    const res = await conversationalAgentEngine.processMessage({
      message: 'Check refill for Rajesh, add shortage to live cart, schedule follow-up call, and send payment QR',
      role: 'staff',
      phone: '9876543210',
      pageContext: { pathname: '/crm' }
    });

    stagedSessionId = res.sessionId;
    expect(res.intent).toBe('REFILL');
    expect(res.requiresConfirmation).toBe(true);
    expect(res.proposedAction).toBeDefined();
    expect(res.proposedAction?.type).toBe('UNIFIED_REFILL_ORCHESTRATION');

    const pData = res.proposedAction?.data;
    expect(pData?.medicineName).toContain('GLYCOMET');
    expect(pData?.stageLiveCart).toBe(true);
    expect(pData?.scheduleCallTask).toBe(true);
    expect(pData?.sendPaymentQr).toBe(true);
    expect(pData?.dueAmount).toBe(450.00);

    // Message must summarize the proposed multi-action execution clearly
    expect(res.replyText).toContain('Outstanding Due Balance');
    expect(res.replyText).toContain('450.00');
    expect(res.replyText).toContain('Stage shortage');
    expect(res.suggestedFollowUps).toContain('Approve & Execute');
  }, 15000);

  test('Test 4: Rule 6 Execution executes staged actions into canonical tables', async () => {
    // Simulate user approving the proposal
    const approveRes = await conversationalAgentEngine.processMessage({
      sessionId: stagedSessionId,
      message: 'Approve & Execute',
      role: 'staff',
      phone: '9876543210',
      pageContext: { pathname: '/crm' }
    });

    expect(approveRes.replyText).toContain('Refill Orchestration Executed');

    // 1. Verify Call Task was written to canonical patient_call_tasks
    const taskRow = await db.get(
      `SELECT * FROM patient_call_tasks WHERE patient_name = ? ORDER BY id DESC LIMIT 1`,
      ['Rajesh Sharma']
    );
    expect(taskRow).toBeDefined();
    expect(taskRow.patient_name).toBe('Rajesh Sharma');
    expect(taskRow.patient_phone).toBe('9876543210');
    expect(taskRow.task_type).toBe('callback');
    expect(taskRow.status).toBe('pending');

    // 2. Verify response confirms execution
    expect(approveRes.replyText).toContain('CRM Callback Task');
  }, 20000);

  test('Test 5: Zero-balance customer does not stage false payment collection', async () => {
    const res = await conversationalAgentEngine.processMessage({
      message: 'Check refill for Pooja, add to live cart and send payment qr',
      role: 'staff',
      phone: '9876543211',
      pageContext: { pathname: '/crm' }
    });

    expect(res.intent).toBe('REFILL');
    const pData = res.proposedAction?.data;
    // Pooja has credit_balance = 0, so sendPaymentQr must be false
    expect(pData?.sendPaymentQr).toBe(false);
    expect(pData?.dueAmount).toBe(0);
    expect(res.replyText).not.toContain('Outstanding Due Balance: ₹');
  }, 15000);
});
