import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';
import {
  createRefillBatch,
  calculateTwoMonthLimit,
  approveRefillBatch,
  rejectRefillBatch,
  getRefillBatch
} from '../src/services/refillBatchService.js';
import { whatsappQueueWorker } from '../src/services/whatsappQueueWorker.js';

describe('Shared Refill Batch Validation & QA Refill Panel Pipeline', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refill-batch-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    db = await dbManager.getConnection();
    whatsappQueueWorker.setPaused(true);
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
    await db.run('DELETE FROM automation_notifications');
    await db.run('DELETE FROM refill_batches');
    await db.run('DELETE FROM patient_refills');
    await db.run('DELETE FROM special_orders');
    await db.run('DELETE FROM customers');
    await db.run('DELETE FROM medicines');
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('owner_whatsapp_number', '919876543210')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmacy_name', 'Test Pharmacy')");
  });

  describe('1. Booking Origin & Batch Identification (WB vs CRM)', () => {
    it('creates Website Refill Batch with WB- prefix and stores website source ID', async () => {
      await db.run(`INSERT INTO medicines (id, name) VALUES (1, 'METFORMIN 500MG')`);
      await db.run(`INSERT INTO customers (id, name, phone) VALUES (10, 'Aarav Sharma', '9876543210')`);

      const batch = await createRefillBatch({
        source: 'website',
        source_id: 'WEB-ORD-9999',
        customer_id: 10,
        patient_name: 'Aarav Sharma',
        patient_phone: '9876543210',
        items: [
          { medicine_id: 1, medicine_name: 'METFORMIN 500MG', quantity: 30 }
        ],
        auto_dispatch: false
      });

      expect(batch).toBeDefined();
      expect(batch.batch_id).toMatch(/^WB-\d{4}-[A-Z0-9]{4}$/);
      expect(batch.source).toBe('website');
      expect(batch.source_id).toBe('WEB-ORD-9999');
      expect(batch.patient_name).toBe('AARAV SHARMA');
    });

    it('creates CRM Refill Batch with CRM- prefix and stores crm source ID', async () => {
      await db.run(`INSERT INTO medicines (id, name) VALUES (2, 'TELMA 40MG')`);
      await db.run(`INSERT INTO customers (id, name, phone) VALUES (20, 'Priya Patel', '9876543211')`);

      const batch = await createRefillBatch({
        source: 'crm',
        source_id: 'CRM-MANUAL-101',
        customer_id: 20,
        patient_name: 'Priya Patel',
        patient_phone: '9876543211',
        items: [
          { medicine_id: 2, medicine_name: 'TELMA 40MG', quantity: 30 }
        ],
        auto_dispatch: false
      });

      expect(batch).toBeDefined();
      expect(batch.batch_id).toMatch(/^CRM-\d{4}-[A-Z0-9]{4}$/);
      expect(batch.source).toBe('crm');
      expect(batch.source_id).toBe('CRM-MANUAL-101');
    });

    it('strictly isolates refill batches from the Online Orders app (never creates special_orders)', async () => {
      await db.run(`INSERT INTO medicines (id, name) VALUES (3, 'ATORVA 10MG')`);

      await createRefillBatch({
        source: 'website',
        source_id: 'WEB-REFILL-55',
        patient_name: 'Kavita Singh',
        patient_phone: '9876543212',
        items: [
          { medicine_id: 3, medicine_name: 'ATORVA 10MG', quantity: 30 }
        ],
        auto_dispatch: false
      });

      const specialOrders = await db.all('SELECT * FROM special_orders');
      expect(specialOrders.length).toBe(0);

      const refillBatches = await db.all('SELECT * FROM refill_batches');
      expect(refillBatches.length).toBe(1);
    });
  });

  describe('2. Shared Refill Validation & 2-Month Limit Check', () => {
    it('calculates 2-month limit accurately based on daily dosage', () => {
      // 30 tablets per 30 days = 1/day -> 2 months (60 days) limit = 60 tablets
      expect(calculateTwoMonthLimit(30, 30)).toBe(60);
      // 10 tablets per 30 days = 1/3 per day -> 60 days limit = 20 tablets
      expect(calculateTwoMonthLimit(10, 30)).toBe(20);
      // 60 tablets per 30 days = 2/day -> 60 days limit = 120 tablets
      expect(calculateTwoMonthLimit(60, 30)).toBe(120);
    });

    it('holds items exceeding the 2-month limit for pharmacist reconfirmation (Approval Required)', async () => {
      await db.run(`INSERT INTO medicines (id, name) VALUES (4, 'GLIMEPIRIDE 2MG')`);
      await db.run(`INSERT INTO customers (id, name, phone) VALUES (30, 'Vikram Malhotra', '9876543213')`);
      // Patient has prescription for 30 tablets per 30 days
      await db.run(`
        INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed, refill_interval_days)
        VALUES (401, 30, 4, 'Vikram Malhotra', '9876543213', DATE('now'), 1, 'pending', 30, 30)
      `);

      // Requested quantity is 90 tablets (> 2-month limit of 60)
      const batch = await createRefillBatch({
        source: 'website',
        source_id: 'WEB-HIGH-QTY-1',
        customer_id: 30,
        patient_name: 'Vikram Malhotra',
        patient_phone: '9876543213',
        items: [
          { medicine_id: 4, medicine_name: 'GLIMEPIRIDE 2MG', quantity: 90, refill_id: 401 }
        ],
        auto_dispatch: false
      });

      expect(batch.status).toBe('approval_required');
      expect(batch.approval_status).toBe('required');
      expect(batch.approval_reason).toContain('exceeds 2-month limit');

      const items = JSON.parse(batch.items_json);
      expect(items[0].approval_status).toBe('required');
      expect(items[0].exceeds_two_month_limit).toBe(true);
      expect(items[0].two_month_limit).toBe(60);

      // Verify patient_refills table reflects approval_status
      const dbRefill = await db.get('SELECT approval_status, approval_reason, batch_id FROM patient_refills WHERE id = 401');
      expect(dbRefill.approval_status).toBe('required');
      expect(dbRefill.batch_id).toBe(batch.batch_id);
    });

    it('marks items within the 2-month limit eligible (Approved)', async () => {
      await db.run(`INSERT INTO medicines (id, name) VALUES (5, 'PANTOP 40MG')`);
      await db.run(`INSERT INTO customers (id, name, phone) VALUES (40, 'Neha Sen', '9876543214')`);
      await db.run(`
        INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed, refill_interval_days)
        VALUES (501, 40, 5, 'Neha Sen', '9876543214', DATE('now'), 1, 'pending', 30, 30)
      `);

      // Requested quantity is 45 tablets (<= 2-month limit of 60)
      const batch = await createRefillBatch({
        source: 'crm',
        source_id: 'CRM-NORMAL-1',
        customer_id: 40,
        patient_name: 'Neha Sen',
        patient_phone: '9876543214',
        items: [
          { medicine_id: 5, medicine_name: 'PANTOP 40MG', quantity: 45, refill_id: 501 }
        ],
        auto_dispatch: false
      });

      expect(batch.approval_status).toBe('approved');
      const items = JSON.parse(batch.items_json);
      expect(items[0].approval_status).toBe('approved');
      expect(items[0].exceeds_two_month_limit).toBe(false);
    });
  });

  describe('3. Pharmacist Reconfirmation: Approve & Release vs Reject', () => {
    it('releases held items and marks batch approved when pharmacist approves', async () => {
      await db.run(`INSERT INTO medicines (id, name) VALUES (6, 'LOSARTAN 50MG')`);
      await db.run(`INSERT INTO customers (id, name, phone) VALUES (50, 'Sunil Joshi', '9876543215')`);
      await db.run(`
        INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed, refill_interval_days)
        VALUES (601, 50, 6, 'Sunil Joshi', '9876543215', DATE('now'), 1, 'pending', 30, 30)
      `);

      const batch = await createRefillBatch({
        source: 'website',
        customer_id: 50,
        patient_name: 'Sunil Joshi',
        patient_phone: '9876543215',
        items: [
          { medicine_id: 6, medicine_name: 'LOSARTAN 50MG', quantity: 100, refill_id: 601 }
        ],
        auto_dispatch: false
      });

      expect(batch.approval_status).toBe('required');

      // Pharmacist approves batch
      const approveRes = await approveRefillBatch(batch.batch_id, 'Pharmacist Dr. Rao');
      expect(approveRes.success).toBe(true);

      const updatedBatch = await getRefillBatch(batch.batch_id);
      expect(updatedBatch?.approval_status).toBe('approved');
      expect(updatedBatch?.approved_by).toBe('Pharmacist Dr. Rao');

      const items = JSON.parse(updatedBatch!.items_json);
      expect(items[0].approval_status).toBe('approved');

      const dbRefill = await db.get('SELECT approval_status FROM patient_refills WHERE id = 601');
      expect(dbRefill.approval_status).toBe('approved');
    });

    it('rejects batch and keeps items on hold/rejected when pharmacist rejects', async () => {
      await db.run(`INSERT INTO medicines (id, name) VALUES (7, 'CLOPIDOGREL 75MG')`);
      await db.run(`INSERT INTO customers (id, name, phone) VALUES (60, 'Deepak Verma', '9876543216')`);
      await db.run(`
        INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed, refill_interval_days)
        VALUES (701, 60, 7, 'Deepak Verma', '9876543216', DATE('now'), 1, 'pending', 30, 30)
      `);

      const batch = await createRefillBatch({
        source: 'website',
        customer_id: 60,
        patient_name: 'Deepak Verma',
        patient_phone: '9876543216',
        items: [
          { medicine_id: 7, medicine_name: 'CLOPIDOGREL 75MG', quantity: 120, refill_id: 701 }
        ],
        auto_dispatch: false
      });

      const rejectRes = await rejectRefillBatch(batch.batch_id, 'Pharmacist Dr. Rao', 'Dosage excessively exceeds clinical safety interval');
      expect(rejectRes.success).toBe(true);

      const updatedBatch = await getRefillBatch(batch.batch_id);
      expect(updatedBatch?.status).toBe('rejected');
      expect(updatedBatch?.approval_status).toBe('rejected');
      expect(updatedBatch?.approval_reason).toContain('Dosage excessively exceeds clinical safety interval');

      const items = JSON.parse(updatedBatch!.items_json);
      expect(items[0].approval_status).toBe('rejected');

      const dbRefill = await db.get('SELECT approval_status FROM patient_refills WHERE id = 701');
      expect(dbRefill.approval_status).toBe('rejected');
    });
  });

  describe('4. Human-In-The-Loop Staged Notification Pipeline', () => {
    it('stages patient confirmation notification in automation_notifications without sending autonomously', async () => {
      await db.run(`INSERT INTO medicines (id, name) VALUES (8, 'AMLODIPINE 5MG')`);
      await db.run(`INSERT INTO customers (id, name, phone) VALUES (70, 'Meena Iyer', '9876543217')`);

      const batch = await createRefillBatch({
        source: 'crm',
        customer_id: 70,
        patient_name: 'Meena Iyer',
        patient_phone: '9876543217',
        items: [
          { medicine_id: 8, medicine_name: 'AMLODIPINE 5MG', quantity: 30 }
        ],
        auto_dispatch: false
      });

      const notifications = await db.all('SELECT * FROM automation_notifications WHERE recipient_phone = ?', ['9876543217']);
      expect(notifications.length).toBe(1);
      expect(notifications[0].type).toBe('refill_batch_booked');
      expect(notifications[0].status).toBe('pending');
      expect(notifications[0].message).toContain('AMLODIPINE 5MG');
      expect(notifications[0].message).toContain(batch.batch_id);
    });
  });
});
