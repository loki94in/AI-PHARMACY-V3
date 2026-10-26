import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';
import {
  getMorningBriefing,
  validatePhoneNumber,
  classifyContactChannel,
  routeToWhatsAppQueue,
  routeToCallTaskQueue,
  updateContactDetails,
  advanceCallOutcome
} from '../src/services/morningBriefingService.js';
import { whatsappQueueWorker } from '../src/services/whatsappQueueWorker.js';

describe('Morning Briefing & Reorder Hub Flow Pipeline', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-briefing-test-'));
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
    await db.run('DELETE FROM patient_call_tasks');
    await db.run('DELETE FROM patient_refills');
    await db.run('DELETE FROM special_orders');
    await db.run('DELETE FROM customers');
    await db.run('DELETE FROM medicines');
    await db.run('DELETE FROM whatsapp_chats');
  });

  describe('1. Phone Validation & 3-Way Channel Classification Gate', () => {
    it('validates genuine 10-digit Indian phone numbers', () => {
      const valid = validatePhoneNumber('+91 98765 43210');
      expect(valid.isValid).toBe(true);
      expect(valid.cleanDigits10).toBe('9876543210');
      expect(valid.status).toBe('usable');
    });

    it('rejects empty, short, or dummy phone numbers', () => {
      expect(validatePhoneNumber('').status).toBe('missing');
      expect(validatePhoneNumber('   ').status).toBe('missing');
      expect(validatePhoneNumber('12345').status).toBe('invalid');
      expect(validatePhoneNumber('0000000000').status).toBe('invalid');
      expect(validatePhoneNumber('1111111111').status).toBe('invalid');
    });

    it('classifies contact channels into 3 distinct pathways', async () => {
      // 1. WhatsApp Available: customer has prior chat
      await db.run(`INSERT INTO whatsapp_chats (id, name) VALUES ('919876543210@c.us', 'Active User')`);
      const channelWa = await classifyContactChannel('9876543210', db);
      expect(channelWa).toBe('whatsapp_available');

      // 2. WhatsApp Unavailable: valid number, not in chat history/unregistered
      const channelCall = await classifyContactChannel('9123456789', db);
      expect(channelCall).toBe('whatsapp_unavailable');

      // 3. No Usable Phone Number
      const channelMissing = await classifyContactChannel('00000', db);
      expect(channelMissing).toBe('no_usable_phone');
    });
  });

  describe('2. Source Aggregation & Consolidated Morning Briefing', () => {
    it('collects pending work across Refills, Special Orders, Online Orders, and Call Tasks', async () => {
      await db.run(`INSERT INTO medicines (id, name) VALUES (1, 'METFORMIN 500MG'), (2, 'TELMA 40MG')`);

      // Refill Request (Pending)
      await db.run(`
        INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed)
        VALUES (101, 1, 1, 'Rajesh Gupta', '9876543210', DATE('now'), 1, 'pending', 30)
      `);

      // Refill Request (Action Required: 2-Mo limit)
      await db.run(`
        INSERT INTO patient_refills (id, customer_id, medicine_id, patient_name, patient_phone, next_refill_date, is_active, status, quantity_needed, approval_status, approval_reason)
        VALUES (102, 2, 2, 'Sunita Rao', '9876543211', DATE('now'), 1, 'pending', 90, 'required', 'Exceeds 2-month limit')
      `);

      // Special Order (Manual CRM: Procurement Needed)
      await db.run(`
        INSERT INTO special_orders (id, requester, phone, medicine_name, qty, priority, status, customer_order_source)
        VALUES (201, 'Anita Desai', '9876543212', 'INSULIN GLARGINE', 2, 'High', 'procurement_needed', 'in_store')
      `);

      // Online Order (Website order)
      await db.run(`
        INSERT INTO special_orders (id, requester, phone, medicine_name, qty, priority, status, customer_order_source, delivery_status, total_amount)
        VALUES (301, 'Karan Johar', '9876543213', 'DOLO 650', 1, 'Normal', 'Pending', 'website', 'pending', 35)
      `);

      // Manual Call Task (Pending Call)
      await db.run(`
        INSERT INTO patient_call_tasks (id, task_type, patient_name, patient_phone, reference_id, details_json, status)
        VALUES (401, 'refill', 'Mohan Lal', '9876543214', 'REF-55', '{"details":"Confirm collection"}', 'pending')
      `);

      // Record with Missing Phone (Should trigger contact_review)
      await db.run(`
        INSERT INTO special_orders (id, requester, phone, medicine_name, qty, priority, status, customer_order_source)
        VALUES (202, 'Unknown Contact', '0000000000', 'CETRIZINE 10MG', 1, 'Normal', 'Pending', 'in_store')
      `);

      const summary = await getMorningBriefing();

      // Verify Refills
      expect(summary.refills.total).toBe(2);
      expect(summary.refills.action_required).toBe(1);
      expect(summary.refills.pending).toBe(1);

      // Verify Special Orders
      expect(summary.special_orders.total).toBe(2);
      expect(summary.special_orders.procurement_needed).toBe(1);

      // Verify Online Orders
      expect(summary.online_orders.total).toBe(1);
      expect(summary.online_orders.items[0].reference_id).toBe('ORD-301');

      // Verify Call Tasks
      expect(summary.call_tasks.total).toBe(1);
      expect(summary.call_tasks.pending_call).toBe(1);

      // Verify Contact Review
      expect(summary.contact_review.total).toBeGreaterThanOrEqual(1);
      expect(summary.contact_review.items.some(i => i.customer_name === 'UNKNOWN CONTACT')).toBe(true);
    });

    it('deduplicates multiple entries for the same patient and medicine', async () => {
      // 2 identical refills for same patient and medicine
      await db.run(`
        INSERT INTO patient_refills (id, medicine_id, patient_name, patient_phone, medicine_name, is_active, status, quantity_needed)
        VALUES (11, 1, 'Amit Shah', '9876500000', 'ECOSPRIN 75', 1, 'pending', 30),
               (12, 1, 'Amit Shah', '9876500000', 'ECOSPRIN 75', 1, 'pending', 30)
      `);

      const summary = await getMorningBriefing();
      const amitRefills = summary.refills.items.filter(i => i.customer_name === 'AMIT SHAH');
      expect(amitRefills.length).toBe(1);
    });
  });

  describe('3. Channel Routing Engine & Contact Details Correction', () => {
    it('routes WhatsApp Available item to staged automation_notifications queue', async () => {
      const result = await routeToWhatsAppQueue({
        customer_name: 'Pooja Hegde',
        customer_phone: '9876543210',
        source_type: 'refill',
        reference_id: 'REF-101'
      });

      expect(result.success).toBe(true);
      expect(result.notification_id).toBeGreaterThan(0);

      const notif = await db.get('SELECT * FROM automation_notifications WHERE id = ?', [result.notification_id]);
      expect(notif.recipient_phone).toBe('9876543210');
      expect(notif.needs_confirmation).toBe(1);
      expect(notif.status).toBe('pending');
    });

    it('routes WhatsApp Unavailable item to patient_call_tasks queue', async () => {
      const result = await routeToCallTaskQueue({
        customer_name: 'Suresh Raina',
        customer_phone: '9876511111',
        task_type: 'special_order',
        reference_id: 'SO-999',
        reason: 'Special order arrived, needs collection call',
        priority: 'high'
      });

      expect(result.success).toBe(true);
      expect(result.task_id).toBeGreaterThan(0);

      const task = await db.get('SELECT * FROM patient_call_tasks WHERE id = ?', [result.task_id]);
      expect(task.task_type).toBe('special_order');
      expect(task.patient_name).toBe('SURESH RAINA');
      expect(task.patient_phone).toBe('9876511111');
      expect(task.priority).toBe('high');
      expect(task.status).toBe('pending');
    });

    it('updates contact details and enables re-routing for records with missing phone', async () => {
      await db.run(`INSERT INTO customers (id, name, phone) VALUES (50, 'Varun Dhawan', '0000000000')`);
      await db.run(`INSERT INTO special_orders (id, requester, phone, status) VALUES (501, 'Varun Dhawan', '0000000000', 'Pending')`);

      const updateRes = await updateContactDetails({
        customer_name: 'Varun Dhawan',
        old_phone: '0000000000',
        new_phone: '9876522222',
        reference_id: 'SO-501',
        source_type: 'special_order'
      });

      expect(updateRes.success).toBe(true);
      expect(updateRes.channel_status).toBe('whatsapp_unavailable');

      const updatedOrder = await db.get('SELECT phone FROM special_orders WHERE id = 501');
      expect(updatedOrder.phone).toBe('9876522222');

      const updatedCustomer = await db.get('SELECT phone FROM customers WHERE id = 50');
      expect(updatedCustomer.phone).toBe('9876522222');
    });
  });

  describe('4. Call Outcome Pipeline State Machine', () => {
    let callTaskId: number;

    beforeEach(async () => {
      const res = await db.run(`
        INSERT INTO patient_call_tasks (task_type, patient_name, patient_phone, status, call_attempts)
        VALUES ('refill', 'Kishore Kumar', '9876533333', 'pending', 0)
      `);
      callTaskId = res.lastID;
    });

    it('transitions: Pending Call -> Called (increments attempt counter and stamps timestamp)', async () => {
      const step1 = await advanceCallOutcome(callTaskId, 'called');
      expect(step1.success).toBe(true);
      expect(step1.new_status).toBe('called');

      const task = await db.get('SELECT status, call_attempts, last_called_at FROM patient_call_tasks WHERE id = ?', [callTaskId]);
      expect(task.status).toBe('called');
      expect(task.call_attempts).toBe(1);
      expect(task.last_called_at).toBeDefined();
    });

    it('transitions: Called -> Customer Responded -> Resolved (completed)', async () => {
      await advanceCallOutcome(callTaskId, 'called');

      const step2 = await advanceCallOutcome(callTaskId, 'customer_responded', {
        outcome_notes: 'Patient confirmed collection this evening'
      });

      expect(step2.success).toBe(true);
      expect(step2.new_status).toBe('completed');

      const task = await db.get('SELECT status, call_outcome FROM patient_call_tasks WHERE id = ?', [callTaskId]);
      expect(task.status).toBe('completed');
      expect(task.call_outcome).toContain('Patient confirmed collection this evening');
    });

    it('transitions: Called -> No Answer -> Follow-up Required (loops back to Pending Call with reschedule date)', async () => {
      await advanceCallOutcome(callTaskId, 'called');

      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const step2 = await advanceCallOutcome(callTaskId, 'no_answer', {
        reschedule_date: tomorrow
      });

      expect(step2.success).toBe(true);
      expect(step2.new_status).toBe('rescheduled');

      const task = await db.get('SELECT status, reschedule_date, call_outcome FROM patient_call_tasks WHERE id = ?', [callTaskId]);
      expect(task.status).toBe('rescheduled');
      expect(task.reschedule_date).toBe(tomorrow);
      expect(task.call_outcome).toContain('No Answer - Follow-up Required');
    });

    it('transitions: Called -> Further Action Needed -> Follow-up Required (loops back to Pending Call)', async () => {
      await advanceCallOutcome(callTaskId, 'called');

      const step2 = await advanceCallOutcome(callTaskId, 'further_action_needed', {
        outcome_notes: 'Doctor prescription reconfirmation required',
        reschedule_date: '2026-10-28'
      });

      expect(step2.success).toBe(true);
      expect(step2.new_status).toBe('rescheduled');

      const task = await db.get('SELECT status, reschedule_date, notes FROM patient_call_tasks WHERE id = ?', [callTaskId]);
      expect(task.status).toBe('rescheduled');
      expect(task.reschedule_date).toBe('2026-10-28');
      expect(task.notes).toBe('Doctor prescription reconfirmation required');
    });
  });
});
