import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { dbManager } from '../src/database/connection.js';
import { ensureSchema } from '../src/database.js';
import { parseOperationalIntent } from '../src/services/localAi/operationalIntentSchema.js';
import { conversationalAgentEngine } from '../src/services/localAi/conversationalAgentEngine.js';
import { pharmacyToolRegistry } from '../src/services/localAi/pharmacyToolRegistry.js';

describe('Qwen Operational Disambiguation & Hybrid Automation Workflows', () => {
  let db: any;

  beforeAll(async () => {
    db = await dbManager.getConnection();
    await ensureSchema(db);

    // Seed test customer
    await db.run(
      `INSERT OR REPLACE INTO customers (id, name, phone, credit_balance)
       VALUES (99901, 'Test Workflow Patient', '9876500111', 150.00)`
    );

    // Seed test medicine
    await db.run(
      `INSERT OR REPLACE INTO medicines (id, name, canonical_name, generic_name, total_stock, pack_size, mrp, sell_price)
       VALUES (99901, 'Test Workflow Dolo 650', 'test workflow dolo 650', 'Paracetamol', 20, '15 Tablets', 35.00, 30.00)`
    );

    await db.run(
      `INSERT OR REPLACE INTO medicines (id, name, canonical_name, generic_name, total_stock, pack_size, mrp, sell_price)
       VALUES (99902, 'Test Workflow Dolopar 650', 'test workflow dolopar 650', 'Paracetamol', 50, '10 Tablets', 30.00, 26.00)`
    );

    // Seed test inventory batch
    await db.run(
      `INSERT OR REPLACE INTO inventory_master (id, store_id, medicine_id, batch_no, quantity, expiry_date)
       VALUES (99901, 1, 99901, 'BATCH-WF-01', 20, '2027-12-31')`
    );

    // Seed chronic refill for patient
    await db.run(
      `INSERT OR REPLACE INTO patient_refills (id, store_id, patient_name, patient_phone, medicine_id, medicine_name, quantity_needed, status, is_active)
       VALUES (99901, 1, 'Test Workflow Patient', '9876500111', 99901, 'Test Workflow Dolo 650', 30, 'active', 1)`
    );

    // Seed a purchase record
    await db.run(
      `INSERT OR REPLACE INTO purchases (id, store_id, invoice_no, date, total_amount)
       VALUES (99901, 1, 'INV-WF-PUR-01', date('now', '-5 days', 'localtime'), 500.00)`
    );

    await db.run(
      `INSERT OR REPLACE INTO purchase_items (id, purchase_id, medicine_id, batch_no, quantity, cost_price, mrp)
       VALUES (99901, 99901, 99901, 'BATCH-WF-01', 50, 22.00, 35.00)`
    );
  });

  afterAll(async () => {
    try {
      await db.run(`DELETE FROM purchase_items WHERE id = 99901`);
      await db.run(`DELETE FROM purchases WHERE id = 99901`);
      await db.run(`DELETE FROM patient_refills WHERE id = 99901`);
      await db.run(`DELETE FROM inventory_master WHERE id = 99901`);
      await db.run(`DELETE FROM medicines WHERE id IN (99901, 99902)`);
      await db.run(`DELETE FROM customers WHERE id = 99901`);
    } catch (_) {}
  });

  test('1. Structured Intent Parser extracts timeframe, amount, and inventory destination', () => {
    // Workflow 1: Purchase timeframe
    const purIntent = parseOperationalIntent(JSON.stringify({
      intent: 'PURCHASE_QUERY',
      confidence: 0.95,
      medicine: 'Dolo 650',
      timeframeDays: 15
    }));
    expect(purIntent.intent).toBe('PURCHASE_QUERY');
    expect(purIntent.medicineName).toBe('Dolo 650');
    expect(purIntent.timeframeDays).toBe(15);

    // Workflow 2: Refill all
    const refIntent = parseOperationalIntent(JSON.stringify({
      intent: 'REFILL_MANAGEMENT',
      confidence: 0.95,
      patient: 'Test Patient',
      allRefills: true
    }));
    expect(refIntent.intent).toBe('REFILL_MANAGEMENT');
    expect(refIntent.patientName).toBe('Test Patient');
    expect(refIntent.allRefills).toBe(true);

    // Workflow 3: Inventory stock addition
    const stockIntent = parseOperationalIntent(JSON.stringify({
      intent: 'STOCK_ADJUSTMENT',
      confidence: 0.95,
      medicine: 'Azithral',
      quantity: 5,
      unit: 'strips',
      destination: 'inventory'
    }));
    expect(stockIntent.intent).toBe('STOCK_ADJUSTMENT');
    expect(stockIntent.quantity).toBe(5);
    expect(stockIntent.unit).toBe('strips');
    expect(stockIntent.destination).toBe('inventory');

    // Workflow 4: Custom QR amount
    const dueIntent = parseOperationalIntent(JSON.stringify({
      intent: 'CUSTOMER_DUE_QUERY',
      confidence: 0.95,
      patient: 'Test Patient',
      amount: 100
    }));
    expect(dueIntent.intent).toBe('CUSTOMER_DUE_QUERY');
    expect(dueIntent.amount).toBe(100);
  });

  test('2. Workflow 1: Purchase history query with timeframe and similar medicine suggestion', async () => {
    // Query exact purchased medicine
    const result = await conversationalAgentEngine.processMessage({
      phone: '9876500111',
      role: 'owner',
      message: 'When was the last time we purchased Test Workflow Dolo 650 in the last 15 days?'
    });

    expect(result.intent).toBe('PURCHASE_QUERY');
    expect(result.replyText).toContain('Purchase Inward');
    expect(result.replyText).toContain('Test Workflow Dolo 650');

    // Query non-existent medicine with partial name to verify similar medicine suggestion
    const simResult = await conversationalAgentEngine.processMessage({
      phone: '9876500111',
      role: 'owner',
      message: 'When was the last time we purchased Test Workflow Dolo?'
    });

    expect(simResult.intent).toBe('PURCHASE_QUERY');
    expect(simResult.replyText).toContain('Test Workflow Dolo');
  });

  test('3. Workflow 2: Patient refill all stages active chronic medicines with default quantities', async () => {
    const refillResult = await conversationalAgentEngine.processMessage({
      phone: '9876500111',
      role: 'staff',
      message: 'Add Test Workflow Patient refill all'
    });

    expect(refillResult.intent).toBe('REFILL');
    expect(refillResult.requiresConfirmation).toBe(true);
    expect(refillResult.proposedAction).toBeDefined();
    expect(refillResult.proposedAction?.type).toBe('STAGE_LIVE_CART_BATCH');
    expect(refillResult.proposedAction?.data.items.length).toBeGreaterThanOrEqual(1);
    expect(refillResult.proposedAction?.data.items[0].medicineName).toBe('Test Workflow Dolo 650');
    expect(refillResult.proposedAction?.data.items[0].quantity).toBe(30);
  });

  test('4. Workflow 3: Adding 4 strips in inventory calculates pack units and commits under Rule 6 HITL', async () => {
    // 15 tablets/strip, so 4 strips = 60 units. Initial stock = 20, new stock = 80.
    const addResult = await conversationalAgentEngine.processMessage({
      phone: '9876500111',
      role: 'staff',
      message: 'Add Test Workflow Dolo 650 4 strips in inventory'
    });

    expect(addResult.intent).toBe('STOCK_CORRECTION');
    expect(addResult.requiresConfirmation).toBe(true);
    expect(addResult.proposedAction).toBeDefined();
    expect(addResult.proposedAction?.type).toBe('ADJUST_STOCK');
    expect(addResult.proposedAction?.data.mode).toBe('add');
    expect(addResult.proposedAction?.data.addedQuantity).toBe(60); // 4 * 15 tablets
    expect(addResult.proposedAction?.data.newQuantity).toBe(80); // 20 + 60

    // Confirm under Rule 6 Human-in-the-Loop
    const confirmResult = await conversationalAgentEngine.processMessage({
      phone: '9876500111',
      sessionId: addResult.sessionId,
      role: 'staff',
      message: 'Yes'
    });

    expect(confirmResult.actionTaken).toBe('ADJUST_STOCK');
    expect(confirmResult.replyText).toContain('Live Inventory Updated');

    // Verify in database
    const medRow = await db.get(`SELECT total_stock FROM medicines WHERE id = 99901`);
    expect(medRow.total_stock).toBe(80);
  });

  test('5. Workflow 4: Credit reminder with custom QR amount stages specified amount', async () => {
    const qrResult = await conversationalAgentEngine.processMessage({
      phone: '9876500111',
      role: 'staff',
      message: 'Send credit reminder 100 rs auto qr code to Test Workflow Patient'
    });

    expect(qrResult.intent).toBe('CUSTOMER_DUE_QUERY');
    expect(qrResult.requiresConfirmation).toBe(true);
    expect(qrResult.proposedAction?.type).toBe('SEND_DUE_PAYMENT_QR');
    expect(qrResult.proposedAction?.data.amount).toBe(100);
    expect(qrResult.replyText).toContain('100.00');
  });
});
