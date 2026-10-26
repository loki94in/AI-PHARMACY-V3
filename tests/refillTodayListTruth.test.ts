import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';
import { buildDailyOperationalBriefing, purgePendingCustomerReminders } from '../src/services/refillService.js';
import { processRefillCartItem, sendRefillCartSummary } from '../src/services/refillCartService.js';
import { whatsappQueueWorker } from '../src/services/whatsappQueueWorker.js';

describe('Refill Today List Truth & Queue Resilience (P2-111, P2-112, P2-113)', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refill-truth-test-'));
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
    await db.run('DELETE FROM whatsapp_send_queue');
    await db.run('DELETE FROM automation_notifications');
    await db.run('DELETE FROM patient_refills');
    await db.run('DELETE FROM customers');
    await db.run('DELETE FROM medicines');
    await db.run('DELETE FROM special_orders');
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('owner_whatsapp_number', '919876543210')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmacy_name', 'Test Pharmacy')");
  });

  describe('P2-111: Owner Today List Purity', () => {
    it('only includes refills due today or overdue in morning briefing, strictly excluding future and completed refills', async () => {
      // 1. Medicine
      await db.run(`INSERT INTO medicines (id, name) VALUES (1, 'METFORMIN 500MG'), (2, 'TELMA 40MG'), (3, 'ATORVA 10MG')`);

      // 2. Active Customer
      await db.run(`INSERT INTO customers (id, name, phone) VALUES (10, 'Ramesh Gupta', '9876500001'), (20, 'Suresh Verma', '9876500002'), (30, 'Anita Roy', '9876500003'), (40, 'Vikram Singh', '9876500004')`);

      // 3. Refill due today (ACTIVE) -> SHOULD appear
      await db.run(`
        INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed)
        VALUES (101, 10, 1, 'Ramesh Gupta', '9876500001', DATE('now', 'localtime'), 1, 'pending', 30)
      `);

      // 4. Refill due in 3 days (WITHIN 7 DAYS) -> SHOULD appear
      await db.run(`
        INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed)
        VALUES (102, 20, 2, 'Suresh Verma', '9876500002', DATE('now', '+3 days'), 1, 'pending', 30)
      `);

      // 5. Refill completed today -> MUST NOT appear
      await db.run(`
        INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed)
        VALUES (103, 30, 3, 'Anita Roy', '9876500003', DATE('now', 'localtime'), 1, 'completed', 30)
      `);

      // 6. Refill due in 15 days (> 7 DAYS) -> MUST NOT appear
      await db.run(`
        INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed)
        VALUES (104, 40, 2, 'Vikram Singh', '9876500004', DATE('now', '+15 days'), 1, 'pending', 30)
      `);

      const briefing = await buildDailyOperationalBriefing(db, 'detailed');
      expect(briefing.messageText).toContain('Ramesh Gupta');
      expect(briefing.messageText).toContain('METFORMIN 500MG');
      expect(briefing.messageText).toContain('Suresh Verma');
      expect(briefing.messageText).toContain('TELMA 40MG');
      expect(briefing.messageText).not.toContain('Anita Roy');
      expect(briefing.messageText).not.toContain('ATORVA 10MG');
      expect(briefing.messageText).not.toContain('Vikram Singh');
    });

    it('rejects processRefillCartItem for completed or cancelled refills', async () => {
      await db.run(`INSERT INTO medicines (id, name) VALUES (1, 'METFORMIN 500MG')`);
      await db.run(`
        INSERT INTO patient_refills (id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed)
        VALUES (201, 1, 'Patient Completed', '9876500004', DATE('now', 'localtime'), 1, 'completed', 10)
      `);

      const res = await processRefillCartItem(201);
      expect(res.status).toBe('failed');
      expect(res.message).toContain('already completed or inactive');
    });

    it('sendRefillCartSummary excludes completed refills and skips send if all are completed', async () => {
      await db.run(`INSERT INTO medicines (id, name) VALUES (1, 'METFORMIN 500MG')`);
      await db.run(`
        INSERT INTO patient_refills (id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed)
        VALUES (301, 1, 'Patient Completed', '9876500005', DATE('now', 'localtime'), 1, 'completed', 10)
      `);

      const summaryRes = await sendRefillCartSummary('Patient Completed', [
        { refillId: 301, medicineName: 'METFORMIN 500MG', status: 'added', storeName: 'Distributor A', qty: 10 }
      ]);

      expect(summaryRes.queued).toBe(false);
      expect(summaryRes.reason).toContain('All items are completed or cancelled');
    });

    it('purgePendingCustomerReminders cleans up staged notifications matching phone and medicines', async () => {
      await db.run(`
        INSERT INTO automation_notifications (id, type, recipient_phone, recipient_name, message, status)
        VALUES (501, 'refill_reminder', '919876500006', 'Patient Test', 'Your METFORMIN is due', 'staged')
      `);

      await purgePendingCustomerReminders(db, {
        phone: '9876500006',
        medicineNames: ['METFORMIN']
      });

      const stagedRow = await db.get('SELECT status FROM automation_notifications WHERE id = 501');
      expect(stagedRow.status).toBe('cancelled');
    });
  });

  describe('P2-112: Owner WhatsApp Queue Message Combining', () => {
    it('combines multiple owner operational alerts into ONE message with section headers', async () => {
      const ownerNumber = '919876543210';

      const id1 = await whatsappQueueWorker.enqueue(
        ownerNumber,
        '🛒 *Refill Cart Summary*\n• Paracetamol × 10',
        'refill_cart_summary',
        'Admin / Store Owner'
      );

      const id2 = await whatsappQueueWorker.enqueue(
        ownerNumber,
        '⚠️ *Shortage Alert*\n• Amoxicillin is low in stock',
        'admin_shortage_reminder',
        'Admin / Store Owner'
      );

      expect(id1).toBe(id2);

      const combined = await db.get('SELECT * FROM whatsapp_send_queue WHERE id = ?', [id1]);
      expect(combined.message).toContain('🔹 *Section 1*');
      expect(combined.message).toContain('🛒 *Refill Cart Summary*');
      expect(combined.message).toContain('🔹 *Section 2*');
      expect(combined.message).toContain('⚠️ *Shortage Alert*');
      expect(combined.message).toContain('──────────────');
    });

    it('strictly keeps the Morning Briefing standalone and never merges other messages into it', async () => {
      const ownerNumber = '919876543210';

      const briefingId = await whatsappQueueWorker.enqueue(
        ownerNumber,
        '☀️ *Morning Operational Briefing*\nNo refills due today.',
        'admin_morning_briefing',
        'Pharmacy Admin'
      );

      const alertId = await whatsappQueueWorker.enqueue(
        ownerNumber,
        '⚠️ *Shortage Alert*\n• Paracetamol is out of stock',
        'admin_shortage_reminder',
        'Admin / Store Owner'
      );

      expect(briefingId).not.toBe(alertId);

      const briefing = await db.get('SELECT message FROM whatsapp_send_queue WHERE id = ?', [briefingId]);
      expect(briefing.message).not.toContain('Shortage Alert');
      expect(briefing.message).not.toContain('Section 2');
    });
  });

  describe('P2-113: Power-Cut Queue Resilience & Attempt Tracking', () => {
    it('records attempts_log and last_attempt_at in database schema', async () => {
      const queueId = await whatsappQueueWorker.enqueue(
        '919876500007',
        'Test Resilience Message',
        'pos_sale_invoice',
        'Test Customer'
      );

      const now = new Date().toISOString();
      const logEntry = JSON.stringify([{ attempt: 1, at: now, error: 'Network timeout during storm' }]);

      await db.run(
        'UPDATE whatsapp_send_queue SET last_attempt_at = ?, attempts_log = ?, status = ? WHERE id = ?',
        [now, logEntry, 'failed_offline', queueId]
      );

      const row = await db.get('SELECT last_attempt_at, attempts_log, status FROM whatsapp_send_queue WHERE id = ?', [queueId]);
      expect(row.last_attempt_at).toBe(now);
      expect(row.attempts_log).toContain('Network timeout during storm');
      expect(row.status).toBe('failed_offline');
    });

    it('cleanupOldSentItems restores unconfirmed same-day items to pending on boot', async () => {
      // Create an unconfirmed item marked as failed_offline earlier today
      await db.run(`
        INSERT INTO whatsapp_send_queue (id, number, message, type, status, retry_count, created_at)
        VALUES (901, '919876500008', 'Unconfirmed today message', 'reminder', 'failed_offline', 1, ${Date.now() - 3600000})
      `);

      await whatsappQueueWorker.cleanupOldSentItems();

      const item = await db.get('SELECT status, retry_count FROM whatsapp_send_queue WHERE id = 901');
      expect(item.status).toBe('pending');
    });

    it('getWorkerState returns truthful todaySummary counts', async () => {
      await db.run(`
        INSERT INTO whatsapp_send_queue (number, message, type, status, created_at, sent_at)
        VALUES ('919876500009', 'Sent 1', 'pos_sale_invoice', 'sent', ${Date.now()}, ${Date.now()}),
               ('919876500010', 'Pending 1', 'pos_sale_invoice', 'pending', ${Date.now()}, NULL)
      `);

      const state = await whatsappQueueWorker.getWorkerState();
      expect(state.todaySummary).toBeDefined();
      expect(state.todaySummary?.sent).toBeGreaterThanOrEqual(1);
      expect(state.todaySummary?.pending).toBeGreaterThanOrEqual(1);
    });
  });
});
