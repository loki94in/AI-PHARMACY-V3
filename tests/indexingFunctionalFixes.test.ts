import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve(true)),
  initClient: jest.fn(() => Promise.resolve(true)),
  destroyClient: jest.fn(() => Promise.resolve(true)),
  reconnectClient: jest.fn(() => Promise.resolve(true)),
  forceReconnect: jest.fn(() => Promise.resolve(true)),
  prewarmWhatsApp: jest.fn(() => Promise.resolve(true)),
  normalizeWhatsAppPhone: jest.fn((p: string) => p),
  hashMessageBody: jest.fn(() => 12345),
  checkPhoneWhatsAppRegistered: jest.fn(() => Promise.resolve(true)),
  ensureSessionHealth: jest.fn(() => Promise.resolve(true)),
  ensureWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  waitForWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  waitForChatStoreReady: jest.fn(() => Promise.resolve(true)),
  getWhatsAppStatus: jest.fn(() => ({ status: 'CONNECTED' })),
  shouldRouteToBusiness: jest.fn(() => false),
  isWhatsAppExplicitlyDisabled: jest.fn(() => false),
  isWhatsAppAutoConnectAllowed: jest.fn(() => true),
  isWhatsAppBusyOrRestoring: jest.fn(() => false),
  isWhatsAppLoginWindowActive: jest.fn(() => false),
  getWhatsAppBrowserPid: jest.fn(() => null),
  getWhatsAppReadiness: jest.fn(() => 'ready'),
  markWhatsAppActivity: jest.fn(),
  setLifecycleProgress: jest.fn(),
  setLoginWindowActive: jest.fn(),
  executeWithWatchdog: jest.fn((fn: any) => fn()),
  isPuppeteerDetachedError: jest.fn(() => false),
  isProductionAppRunning: jest.fn(() => false),
  hasSavedSession: jest.fn(() => false),
  patchWWebJSInternals: jest.fn(),
  resolveChatSession: jest.fn(() => null),
  downloadMessageMediaReliably: jest.fn(() => Promise.resolve(null)),
  downloadMessageMediaById: jest.fn(() => Promise.resolve(null)),
  getMessageMedia: jest.fn(() => Promise.resolve(null)),
  currentQr: null,
  isReady: true,
  setCurrentQr: jest.fn(),
  setIsReady: jest.fn(),
  getChats: jest.fn(() => Promise.resolve([])),
  getChatMessages: jest.fn(() => Promise.resolve([]))
}));

jest.unstable_mockModule('../src/telegramBot.js', () => ({
  __esModule: true,
  telegramBotService: {
    sendDefaultNotification: jest.fn(() => Promise.resolve(true))
  }
}));

import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('Targeted Regression Tests: Tasks 1-4 Functional Fixes', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'functional-fixes-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed test medicines with case variations, generic names, and API refs
    await db.run("INSERT INTO medicines (id, name, generic_name, api_reference, item_code) VALUES (1, 'CALPOL 500 TABLET', 'Paracetamol', 'paracetamol-api', 'M1')");
    await db.run("INSERT INTO medicines (id, name, generic_name, api_reference, item_code) VALUES (2, 'DOLO 650 TABLET', 'PARACETAMOL', 'paracetamol-api', 'M2')");
    await db.run("INSERT INTO medicines (id, name, generic_name, api_reference, item_code) VALUES (3, 'CROCYN SYRUP', 'paracetamol', 'paracetamol-api', 'M3')");
    await db.run("INSERT INTO medicines (id, name, generic_name, api_reference, item_code) VALUES (4, 'NULL GENERIC MEDICINE', NULL, NULL, 'M4')");
    await db.run("INSERT INTO medicines (id, name, generic_name, api_reference, item_code) VALUES (5, 'EMPTY GENERIC MEDICINE', '', '', 'M5')");
    await db.run("INSERT INTO medicines (id, name, generic_name, api_reference, item_code) VALUES (6, 'CETRIZINE 10MG', 'Cetirizine', 'cetirizine-api', 'M6')");

    // Seed test customers
    await db.run("INSERT INTO customers (id, name, phone) VALUES (1, 'Sonali Male Kar', '9822001122')");
    await db.run("INSERT INTO customers (id, name, phone) VALUES (2, 'Rahul Sharma', '8698116017')");
    await db.run("INSERT INTO customers (id, name, phone) VALUES (3, 'Anita Kar', '9890112233')");

    await db.close();

    const { default: medicinesRouter } = await import('../src/routes/medicines.js');
    const { default: crmRouter } = await import('../src/routes/crm.js');

    app = express();
    app.use(express.json());
    app.use('/api', medicinesRouter);
    app.use('/api/crm', crmRouter);
  });

  afterAll(async () => {
    try {
      const { dbManager } = await import('../src/database/connection.js');
      await dbManager.close(true);
    } catch {}
    delete process.env.DB_PATH;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  test('Medicine Alternatives: returns case-insensitive alternatives excluding self', async () => {
    const res = await request(app).get('/api/medicines/1/quick-details');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('CALPOL 500 TABLET');
    expect(Array.isArray(res.body.alternatives)).toBe(true);

    const altNames = res.body.alternatives.map((a: any) => a.name);
    // Should find DOLO (PARACETAMOL) and CROCYN (paracetamol)
    expect(altNames).toContain('DOLO 650 TABLET');
    expect(altNames).toContain('CROCYN SYRUP');
    // Should NOT include self
    expect(altNames).not.toContain('CALPOL 500 TABLET');
    // Should NOT include Cetirizine
    expect(altNames).not.toContain('CETRIZINE 10MG');
  });

  test('Medicine Alternatives: handles NULL or empty generic_name and api_reference safely', async () => {
    const resNull = await request(app).get('/api/medicines/4/quick-details');
    expect(resNull.status).toBe(200);
    expect(resNull.body.alternatives).toEqual([]);

    const resEmpty = await request(app).get('/api/medicines/5/quick-details');
    expect(resEmpty.status).toBe(200);
    expect(resEmpty.body.alternatives).toEqual([]);
  });

  test('Medicine Alternatives: EXPLAIN QUERY PLAN uses index instead of full table scan', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const plan = await db.all(`
      EXPLAIN QUERY PLAN
      SELECT m.id, m.name, m.generic_name
      FROM medicines m
      WHERE m.id <> 1 AND (
        (m.api_reference = 'paracetamol-api' COLLATE NOCASE AND m.api_reference IS NOT NULL AND m.api_reference <> '') OR
        (m.generic_name = 'Paracetamol' COLLATE NOCASE AND m.generic_name IS NOT NULL AND m.generic_name <> '')
      )
      LIMIT 10
    `);
    await db.close();

    const planDetails = plan.map(p => p.detail).join(' ');
    // Must use index, NOT table scan
    expect(planDetails).not.toMatch(/^SCAN m$/);
    expect(planDetails).toMatch(/INDEX/i);
  });

  test('Customer Autocomplete: prefix and substring search semantics and records preserved', async () => {
    const resName = await request(app).get('/api/crm/patients?q=Sonali');
    expect(resName.status).toBe(200);
    expect(resName.body.length).toBeGreaterThanOrEqual(1);
    expect(resName.body[0].name).toBe('Sonali Male Kar');

    const resMiddle = await request(app).get('/api/crm/patients?q=Kar');
    expect(resMiddle.status).toBe(200);
    const names = resMiddle.body.map((p: any) => p.name);
    // Substring 'Kar' should match both 'Sonali Male Kar' and 'Anita Kar'
    expect(names).toContain('Sonali Male Kar');
    expect(names).toContain('Anita Kar');

    const resPhone = await request(app).get('/api/crm/patients?q=8698');
    expect(resPhone.status).toBe(200);
    expect(resPhone.body[0].name).toBe('Rahul Sharma');
  });

  test('Customer Autocomplete: idx_customers_name_nocase exists and accelerates prefix query', async () => {
    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    const prefixPlan = await db.all(`
      EXPLAIN QUERY PLAN
      SELECT * FROM customers WHERE name LIKE 'son%' COLLATE NOCASE LIMIT 10
    `);
    await db.close();

    const detail = prefixPlan[0]?.detail || '';
    expect(detail).toMatch(/USING INDEX idx_customers_name_nocase/);
  });
});
