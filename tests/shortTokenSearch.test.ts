import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve(true)),
  initClient: jest.fn(() => Promise.resolve(true))
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

describe('Short-Token and Exact Medicine Search', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'short-token-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { open } = await import('sqlite');
    const sqlite3 = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.default.Database });

    // Seed representative test medicines
    await db.run("INSERT INTO medicines (name, item_code) VALUES ('AARCAL D3 SACHET 1GM', 'M-001')");
    await db.run("INSERT INTO medicines (name, item_code) VALUES ('SHELCAL D3 TABLET', 'M-002')");
    await db.run("INSERT INTO medicines (name, item_code) VALUES ('BENADON VITAMIN B6 40MG', 'M-003')");
    await db.run("INSERT INTO medicines (name, item_code) VALUES ('CLAVAM 625 CV TABLET', 'M-004')");
    await db.run("INSERT INTO medicines (name, item_code) VALUES ('H1 TEST DRUG 50MG', 'M-005')");
    await db.run("INSERT INTO medicines (name, item_code) VALUES ('UNRELATED BIND3X CAPSULE', 'M-006')"); // 'IND3X' must NOT match 'D3'
    await db.close();

    const { default: inventoryRouter } = await import('../src/routes/inventory.js');
    app = express();
    app.use(express.json());
    app.use('/api/inventory', inventoryRouter);
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

  test('multi-token query with short token "AARCAL D3" finds AARCAL D3', async () => {
    const res = await request(app).get('/api/inventory/catalog-search?q=AARCAL%20D3');
    expect(res.status).toBe(200);
    const names = res.body.map((m: any) => m.name);
    expect(names).toContain('AARCAL D3 SACHET 1GM');
  });

  test('standalone short token "D3" finds D3 medicines with word-boundary, not unrelated words', async () => {
    const res = await request(app).get('/api/inventory/catalog-search?q=D3');
    expect(res.status).toBe(200);
    const names = res.body.map((m: any) => m.name);
    expect(names).toContain('AARCAL D3 SACHET 1GM');
    expect(names).toContain('SHELCAL D3 TABLET');
    expect(names).not.toContain('UNRELATED BIND3X CAPSULE');
  });

  test('standalone short token "B6" finds B6 medicines', async () => {
    const res = await request(app).get('/api/inventory/catalog-search?q=B6');
    expect(res.status).toBe(200);
    const names = res.body.map((m: any) => m.name);
    expect(names).toContain('BENADON VITAMIN B6 40MG');
  });

  test('standalone short token "CV" finds CV medicines', async () => {
    const res = await request(app).get('/api/inventory/catalog-search?q=CV');
    expect(res.status).toBe(200);
    const names = res.body.map((m: any) => m.name);
    expect(names).toContain('CLAVAM 625 CV TABLET');
  });

  test('standalone short token "H1" finds H1 medicines', async () => {
    const res = await request(app).get('/api/inventory/catalog-search?q=H1');
    expect(res.status).toBe(200);
    const names = res.body.map((m: any) => m.name);
    expect(names).toContain('H1 TEST DRUG 50MG');
  });

  test('OCR filterProductNames with short-token input bypasses FTS5 without error', async () => {
    const { productNameFilterService } = await import('../src/services/productNameFilterService.js');
    await productNameFilterService.initialize(['AARCAL D3 SACHET 1GM', 'CLAVAM 625 CV TABLET']);
    const result = await productNameFilterService.filterProductNames('D3');
    expect(result).toBeDefined();
    expect(Array.isArray(result.matches)).toBe(true);
  });
});
