import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('Cross-Distributor Returns & Missing Purchase Invoice Handling', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'return-cross-dist-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;

    await ensureSchema(dbPath);

    const { default: returnsRouter } = await import('../src/routes/returns.js');

    app = express();
    app.use(express.json());
    app.use('/api/returns', returnsRouter);
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('1. Allows returning a medicine to Distributor B even when purchased from Distributor A', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed Distributor A (seller) and Distributor B (return target)
    const distARes = await db.run("INSERT INTO distributors (name) VALUES ('Distributor Alpha')");
    const distAId = distARes.lastID;
    const distBRes = await db.run("INSERT INTO distributors (name) VALUES ('Distributor Beta')");
    const distBId = distBRes.lastID;

    // Seed Medicine
    const medRes = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Cross Return Medicine 500mg', 100)");
    const medId = medRes.lastID;

    // Seed Purchase from Distributor A
    const purchRes = await db.run("INSERT INTO purchases (distributor_id, invoice_no) VALUES (?, 'INV-ALPHA-99')", [distAId]);
    await db.run(
      "INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp) VALUES (?, ?, 'BATCH-X1', '12/28', 10, 70.0, 100.0)",
      [purchRes.lastID, medId]
    );

    // Seed inventory stock
    await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-X1', '12/28', 10, 70.0, 100.0, 1)",
      [medId]
    );

    // Process return addressed to Distributor B (cross-distributor return)
    const returnPayload = {
      distributor_id: distBId,
      distributor_name: 'Distributor Beta',
      loss_percentage: 0,
      invoice_no: 'CFA-CLAIM-01',
      items: [
        {
          medicine_id: medId,
          batch_no: 'BATCH-X1',
          expiry_date: '12/28',
          quantity: 5,
          cost_price: 70.0,
          mrp: 100.0,
          invoice_no: 'CFA-CLAIM-01',
          distributor_id: distBId
        }
      ]
    };

    const res = await request(app)
      .post('/api/returns/process-returns')
      .send(returnPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.returnNo).toMatch(/^PR-\d+/);

    // Check returns record in database
    const returnRecord = await db.get("SELECT * FROM returns WHERE return_no = ?", [res.body.returnNo]);
    expect(returnRecord).toBeDefined();
    expect(returnRecord.distributor_id).toBe(distBId);
    // original_invoice_id should NOT be linked to Distributor A's purchase
    expect(returnRecord.original_invoice_id).toBeNull();
    // return_invoice_id should store the provided invoice string
    expect(returnRecord.return_invoice_id).toBe('CFA-CLAIM-01');

    // Check return_items record in database
    const returnItem = await db.get("SELECT * FROM return_items WHERE return_id = ?", [returnRecord.id]);
    expect(returnItem).toBeDefined();
    expect(returnItem.medicine_id).toBe(medId);
    expect(returnItem.batch_no).toBe('BATCH-X1');
    expect(returnItem.expiry_date).toBe('12/28');
    expect(returnItem.invoice_no).toBe('CFA-CLAIM-01');
    expect(returnItem.quantity).toBe(5);

    // Stock should be decremented from 10 to 5
    const invAfter = await db.get("SELECT quantity FROM inventory_master WHERE medicine_id = ? AND batch_no = ?", [medId, 'BATCH-X1']);
    expect(invAfter.quantity).toBe(5);

    await db.close();
  });

  test('2. Allows returning medicine when purchase invoice is missing in app (unbilled/manual stock)', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const distRes = await db.run("INSERT INTO distributors (name) VALUES ('Distributor Gamma')");
    const distId = distRes.lastID;

    // Medicine exists in stock with NO purchase records
    const medRes = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Unbilled Medicine 250mg', 50)");
    const medId = medRes.lastID;

    await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-UNBILLED', '06/27', 8, 35.0, 50.0, 1)",
      [medId]
    );

    const returnPayload = {
      distributor_id: distId,
      distributor_name: 'Distributor Gamma',
      loss_percentage: 2.0,
      invoice_no: 'MANUAL-INV-77',
      items: [
        {
          medicine_id: medId,
          batch_no: 'BATCH-UNBILLED',
          expiry_date: '06/27',
          quantity: 4,
          cost_price: 35.0,
          mrp: 50.0,
          invoice_no: 'MANUAL-INV-77',
          distributor_id: distId
        }
      ]
    };

    const res = await request(app)
      .post('/api/returns/process-returns')
      .send(returnPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const returnRecord = await db.get("SELECT * FROM returns WHERE return_no = ?", [res.body.returnNo]);
    expect(returnRecord.original_invoice_id).toBeNull();
    expect(returnRecord.return_invoice_id).toBe('MANUAL-INV-77');

    const itemRecord = await db.get("SELECT * FROM return_items WHERE return_id = ?", [returnRecord.id]);
    expect(itemRecord.invoice_no).toBe('MANUAL-INV-77');
    expect(itemRecord.expiry_date).toBe('06/27');

    await db.close();
  });

  test('3. GET /api/returns/lookup-purchases returns inventory fallback when no purchase records exist', async () => {
    const res = await request(app)
      .get('/api/returns/lookup-purchases')
      .query({ name: 'Unbilled Medicine' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].batch_no).toBe('BATCH-UNBILLED');
    expect(res.body[0].distributor_name).toContain('Store Stock');
  });

  test('4. Allows returning wrong product delivered by distributor as Goods Return with 0% loss', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const distRes = await db.run("INSERT INTO distributors (name) VALUES ('Distributor Delta')");
    const distId = distRes.lastID;

    // Medicine delivered wrong by distributor
    const medRes = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Wrong Delivered Medicine 500mg', 120)");
    const medId = medRes.lastID;

    await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-WRONG-1', '12/28', 15, 80.0, 120.0, 1)",
      [medId]
    );

    const returnPayload = {
      distributor_id: distId,
      distributor_name: 'Distributor Delta',
      return_sub_type: 'good',
      reason: 'Wrong Product Delivered',
      loss_percentage: 0,
      invoice_no: 'WRONG-DELIVERY-01',
      items: [
        {
          medicine_id: medId,
          medicine_name: 'Wrong Delivered Medicine 500mg',
          batch_no: 'BATCH-WRONG-1',
          expiry_date: '12/28',
          quantity: 15,
          cost_price: 80.0,
          mrp: 120.0,
          return_type: 'good',
          reason: 'Wrong Product Delivered',
          invoice_no: 'WRONG-DELIVERY-01',
          distributor_id: distId
        }
      ]
    };

    const res = await request(app)
      .post('/api/returns/process-returns')
      .send(returnPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const returnRecord = await db.get("SELECT * FROM returns WHERE return_no = ?", [res.body.returnNo]);
    expect(returnRecord).toBeDefined();
    expect(returnRecord.return_sub_type).toBe('good');
    expect(returnRecord.reason).toBe('Wrong Product Delivered');
    expect(returnRecord.total_amount).toBe(1200.0); // 15 * 80

    // Check credit note tracking: expected_credit_amount should be 100% (1200) with 0% loss
    const creditTracking = await db.get("SELECT * FROM expiry_returns_tracking WHERE return_id = ?", [returnRecord.id]);
    expect(creditTracking).toBeDefined();
    expect(creditTracking.loss_percentage).toBe(0);
    expect(creditTracking.expected_credit_amount).toBe(1200.0);

    // Stock should be decremented to 0
    const invAfter = await db.get("SELECT quantity FROM inventory_master WHERE medicine_id = ? AND batch_no = ?", [medId, 'BATCH-WRONG-1']);
    expect(invAfter.quantity).toBe(0);

    await db.close();
  });

  test('5. Defaults to Goods Return with 0% loss when non-expired items are returned with non-expiry reason', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const distRes = await db.run("INSERT INTO distributors (name) VALUES ('Distributor Epsilon')");
    const distId = distRes.lastID;

    const medRes = await db.run("INSERT INTO medicines (name, mrp) VALUES ('Excess Stock Non-Expired 10mg', 60)");
    const medId = medRes.lastID;

    await db.run(
      "INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active) VALUES (?, 'BATCH-EXCESS-1', '10/29', 20, 40.0, 60.0, 1)",
      [medId]
    );

    const returnPayload = {
      distributor_id: distId,
      distributor_name: 'Distributor Epsilon',
      // No explicit return_sub_type or loss_percentage provided
      items: [
        {
          medicine_id: medId,
          batch_no: 'BATCH-EXCESS-1',
          expiry_date: '10/29',
          quantity: 10,
          cost_price: 40.0,
          mrp: 60.0,
          return_type: 'good',
          reason: 'Non-Expired / Excess Stock',
          distributor_id: distId
        }
      ]
    };

    const res = await request(app)
      .post('/api/returns/process-returns')
      .send(returnPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const returnRecord = await db.get("SELECT * FROM returns WHERE return_no = ?", [res.body.returnNo]);
    expect(returnRecord.return_sub_type).toBe('good');
    expect(returnRecord.reason).toBe('Non-Expired / Excess Stock');

    const creditTracking = await db.get("SELECT * FROM expiry_returns_tracking WHERE return_id = ?", [returnRecord.id]);
    expect(creditTracking).toBeDefined();
    expect(creditTracking.loss_percentage).toBe(0);
    expect(creditTracking.expected_credit_amount).toBe(400.0); // 10 * 40

    await db.close();
  });
});
