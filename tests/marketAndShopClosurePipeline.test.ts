import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';
import express from 'express';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';
import crmRouter from '../src/routes/crm.js';
import { isClosedDay, advanceToNextOpenDay } from '../src/utils/pharmacyCalendar.js';
import { whatsappQueueWorker } from '../src/services/whatsappQueueWorker.js';

describe('Smart Market & Shop Closure Reminder Pipeline Test Suite', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;
  let app: express.Express;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-pipeline-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);
    db = await dbManager.getConnection();
    whatsappQueueWorker.setPaused(true);

    app = express();
    app.use(express.json());
    app.use('/api/crm', crmRouter);
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
    await db.run('DELETE FROM special_orders');
    await db.run('DELETE FROM patient_refills');
    await db.run('DELETE FROM app_settings WHERE key LIKE "pharmacy_%" OR key = "weekly_off"');
  });

  it('1. Correctly calculates multi-day chain of closures using advanceToNextOpenDay', async () => {
    // Set weekly off to Sunday and add custom closed dates
    await db.run(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES 
       ('pharmacy_weekly_off', 'sunday'),
       ('pharmacy_closed_dates', '["2026-11-10"]'),
       ('pharmacy_open_time', '09:00'),
       ('pharmacy_close_time', '22:00')`
    );

    // If starting on 2026-11-08 (Sunday, weekly off)
    const sundayDate = new Date('2026-11-08T10:00:00Z');
    const sundayCheck = await isClosedDay(sundayDate, 1, db);
    expect(sundayCheck.isClosed).toBe(true);
    expect(sundayCheck.isWeeklyOff).toBe(true);

    // Advancing from Sunday 2026-11-08 should land on Monday 2026-11-09
    const nextFromSunday = await advanceToNextOpenDay(sundayDate, { storeId: 1, dbInstance: db, advanceAtLeastOneDay: false });
    expect(nextFromSunday.ymd).toBe('2026-11-09');

    // If starting on Monday 2026-11-09 and advancing, since 2026-11-10 is in pharmacy_closed_dates, it should jump to 2026-11-11
    const mondayDate = new Date('2026-11-09T10:00:00Z');
    const nextFromMonday = await advanceToNextOpenDay(mondayDate, { storeId: 1, dbInstance: db, advanceAtLeastOneDay: true });
    expect(nextFromMonday.ymd).toBe('2026-11-11');
  });

  it('2. GET /api/crm/delay-notice-candidates returns both procurement delay and ready pickup candidates', async () => {
    // Insert a Procurement Delay special order (status: Waiting)
    await db.run(
      `INSERT INTO special_orders (requester, phone, medicine_name, qty, status, store_id)
       VALUES ('Ramesh Patil', '9822012345', 'Telmisartan 40mg', 2, 'Waiting', 1)`
    );

    // Insert a Ready special order (status: Ready)
    await db.run(
      `INSERT INTO special_orders (requester, phone, medicine_name, qty, status, store_id)
       VALUES ('Suresh Shinde', '9822099999', 'Metformin 500mg', 1, 'Ready', 1)`
    );

    const res = await request(app).get('/api/crm/delay-notice-candidates');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.calendar_context).toBeDefined();
    expect(res.body.calendar_context.next_working_date).toBeDefined();
    expect(res.body.calendar_context.open_time).toBeDefined();
    expect(res.body.calendar_context.close_time).toBeDefined();

    const candidates = res.body.candidates;
    const procurementItem = candidates.find((c: any) => c.patient_name === 'Ramesh Patil');
    const readyItem = candidates.find((c: any) => c.patient_name === 'Suresh Shinde');

    expect(procurementItem).toBeDefined();
    expect(procurementItem.category).toBe('procurement_delay');

    expect(readyItem).toBeDefined();
    expect(readyItem.category).toBe('ready_pickup');
  });

  it('3. POST /api/crm/broadcast-delay-notices interpolates dynamic calendar tags without panic', async () => {
    await db.run(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES 
       ('pharmacy_open_time', '09:00'),
       ('pharmacy_close_time', '22:00'),
       ('pharmacy_phone', '9876543210')`
    );

    await db.run(
      `INSERT INTO special_orders (id, requester, phone, medicine_name, qty, status, store_id)
       VALUES (101, 'Anjali Kadam', '9823456789', 'Thyronorm 50mcg', 1, 'Ready', 1)`
    );

    const template = 'सस्नेह नमस्कार {patient_name}, आपले {medicine_name} आमच्याकडे तयार आहे. दुकान उद्या {tomorrow_day} बंद राहणार असल्यामुळे आपण आज रात्री {close_time} पर्यंत किंवा {next_working_date} रोजी सकाळी {open_time} नंतर सवडीने घेऊ शकता. — {pharmacy_name}';

    const res = await request(app)
      .post('/api/crm/broadcast-delay-notices')
      .send({
        recipients: [
          {
            id: 101,
            type: 'special_order',
            patient_name: 'Anjali Kadam',
            patient_phone: '9823456789',
            medicine_name: 'Thyronorm 50mcg',
            qty: 1,
            store_id: 1
          }
        ],
        message_template: template,
        postpone_days: 1
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.queued_count).toBe(1);

    // Verify record in automation_notifications
    const queuedRow = await db.get(
      `SELECT * FROM automation_notifications WHERE recipient_phone LIKE '%9823456789%' ORDER BY id DESC LIMIT 1`
    );
    expect(queuedRow).toBeDefined();
    expect(queuedRow.message.toLowerCase()).toContain('anjali kadam');
    expect(queuedRow.message).toContain('Thyronorm 50mcg');
    expect(queuedRow.message).not.toContain('{patient_name}');
    expect(queuedRow.message).not.toContain('{medicine_name}');
    expect(queuedRow.message).not.toContain('{close_time}');
    expect(queuedRow.message).not.toContain('{open_time}');
    expect(queuedRow.message).not.toContain('{next_working_date}');
  });

  it('4. Supports all 3 Mark-Ready sources (Refill, Special Order, Online Order) and early close override (5 PM / 6 PM)', async () => {
    // 1. Special Order (counter walk-in, ready)
    await db.run(
      `INSERT INTO special_orders (id, requester, phone, medicine_name, qty, status, store_id, notified)
       VALUES (201, 'Sunil Joshi', '9822111111', 'Amlodipine 5mg', 1, 'Ready', 1, 1)`
    );

    // 2. Online Order (website source, ready)
    await db.run(
      `INSERT INTO special_orders (id, requester, phone, medicine_name, qty, status, store_id, customer_order_source, notified)
       VALUES (202, 'Priya Deshmukh', '9822222222', 'Accu-Chek Strips', 1, 'Ready', 1, 'website', 1)`
    );

    // 3. Patient Refill (staged / ready)
    await db.run(
      `INSERT INTO patient_refills (id, patient_name, patient_phone, medicine_id, quantity_needed, status, is_ready, is_active, store_id)
       VALUES (203, 'Kavita Shinde', '9822333333', 1, 2, 'staged', 1, 1, 1)`
    );

    const getRes = await request(app).get('/api/crm/delay-notice-candidates');
    expect(getRes.status).toBe(200);

    const candidates = getRes.body.candidates;
    const specialItem = candidates.find((c: any) => c.patient_name === 'Sunil Joshi');
    const onlineItem = candidates.find((c: any) => c.patient_name === 'Priya Deshmukh');
    const refillItem = candidates.find((c: any) => c.patient_name === 'Kavita Shinde');

    expect(specialItem).toBeDefined();
    expect(specialItem.type).toBe('special_order');
    expect(specialItem.category).toBe('ready_pickup');
    expect(specialItem.notified_earlier).toBe(true);

    expect(onlineItem).toBeDefined();
    expect(onlineItem.type).toBe('online_order');
    expect(onlineItem.category).toBe('ready_pickup');
    expect(onlineItem.notified_earlier).toBe(true);

    expect(refillItem).toBeDefined();
    expect(refillItem.type).toBe('refill');
    expect(refillItem.category).toBe('ready_pickup');

    // Test Early Close 05:00 PM broadcast override
    const earlyTemplate = 'सस्नेह नमस्कार {patient_name}, आपले औषध {medicine_name} तयार आहे. आज दुकान लवकर {close_time} वाजता बंद होईल आणि उद्या {tomorrow_day} बंद राहील. आपण आज {close_time} पूर्वी किंवा {next_working_date} रोजी सकाळी {open_time} नंतर सवडीने घेऊ शकता. — {pharmacy_name}';

    const postRes = await request(app)
      .post('/api/crm/broadcast-delay-notices')
      .send({
        recipients: [
          {
            id: onlineItem.id,
            type: onlineItem.type,
            patient_name: onlineItem.patient_name,
            patient_phone: onlineItem.patient_phone,
            medicine_name: onlineItem.medicine_name,
            qty: 1,
            store_id: 1
          }
        ],
        message_template: earlyTemplate,
        override_close_time: '05:00 PM',
        postpone_days: 1
      });

    expect(postRes.status).toBe(200);
    expect(postRes.body.success).toBe(true);

    const queuedRow = await db.get(
      `SELECT * FROM automation_notifications WHERE recipient_phone LIKE '%9822222222%' ORDER BY id DESC LIMIT 1`
    );
    expect(queuedRow).toBeDefined();
    expect(queuedRow.message).toContain('05:00 PM');
    expect(queuedRow.message).not.toContain('{close_time}');
  });
});
