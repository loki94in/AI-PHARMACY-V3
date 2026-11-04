import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';
import {
  getTodayDistributorRemindersFast,
  syncTodayActiveDistributors
} from '../src/services/distributorDispatchReminderWorker.js';

describe('Dispatch All Distributors Directory & Phone Order Trigger Tests', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-all-dist-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;

    await ensureSchema(dbPath);
    const db = await dbManager.getConnection();

    // Seed master distributors
    await db.run(
      `INSERT INTO distributors (name, phone, contact, email) VALUES (?, ?, ?, ?)`,
      ['Balaji Pharma Wholesalers', '9822012345', 'Balaji Contact', 'balaji@example.com']
    );
    await db.run(
      `INSERT INTO distributors (name, phone, contact, email) VALUES (?, ?, ?, ?)`,
      ['Apex Healthcare Distributors', '9822099999', 'Apex Contact', 'apex@example.com']
    );

    const { default: dispatchRouter } = await import('../src/routes/dispatch.js');

    app = express();
    app.use(express.json());
    app.use('/api/dispatch', dispatchRouter);
  });

  afterAll(async () => {
    try {
      await dbManager.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('Fast read returns all master distributors even when no orders exist today', async () => {
    const reminders = await getTodayDistributorRemindersFast();
    expect(Array.isArray(reminders)).toBe(true);

    const balaji = reminders.find(r => r.distributor_name === 'Balaji Pharma Wholesalers');
    const apex = reminders.find(r => r.distributor_name === 'Apex Healthcare Distributors');

    expect(balaji).toBeDefined();
    expect(balaji.status).toBe('No Order Today');
    expect(balaji.has_order_today).toBe(0);
    expect(balaji.distributor_phone).toBe('9822012345');

    expect(apex).toBeDefined();
    expect(apex.status).toBe('No Order Today');
    expect(apex.has_order_today).toBe(0);
    expect(apex.distributor_phone).toBe('9822099999');
  });

  test('API GET /api/dispatch/distributor-reminders/today returns all master distributors', async () => {
    const res = await request(app).get('/api/dispatch/distributor-reminders/today');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.reminders)).toBe(true);

    const names = res.body.reminders.map((r: any) => r.distributor_name);
    expect(names).toContain('Balaji Pharma Wholesalers');
    expect(names).toContain('Apex Healthcare Distributors');
  });

  test('Recording a manual phone order converts master distributor into today active order', async () => {
    const postRes = await request(app)
      .post('/api/dispatch/distributor-reminders/manual-order')
      .send({
        distributor_name: 'Balaji Pharma Wholesalers',
        distributor_phone: '9822012345'
      });

    expect([200, 201]).toContain(postRes.status);
    expect(postRes.body.success).toBe(true);
    expect(postRes.body.reminder).toBeDefined();
    expect(postRes.body.reminder.order_source).toBe('phone_call');

    // Re-query fast reminders
    const updatedReminders = await getTodayDistributorRemindersFast();
    const balaji = updatedReminders.find(r => r.distributor_name === 'Balaji Pharma Wholesalers');
    expect(balaji).toBeDefined();
    expect(balaji.has_order_today).toBe(1);
    expect(balaji.status).toBe('Pending');
    expect(balaji.order_source).toBe('phone_call');

    // Apex should still be 'No Order Today'
    const apex = updatedReminders.find(r => r.distributor_name === 'Apex Healthcare Distributors');
    expect(apex).toBeDefined();
    expect(apex.has_order_today).toBe(0);
    expect(apex.status).toBe('No Order Today');
  });
});
