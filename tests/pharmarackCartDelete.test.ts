import { jest } from '@jest/globals';

const mockSendMessage = jest.fn((..._args: any[]) => Promise.resolve(true));
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: mockSendMessage,
  initClient: jest.fn(() => Promise.resolve(true)),
  hasSavedSession: jest.fn(() => true),
  waitForWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  markWhatsAppActivity: jest.fn(),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isConnected: true, isReady: true, status: 'CONNECTED' })),
  shouldRouteToBusiness: jest.fn(() => false),
  isWhatsAppExplicitlyDisabled: jest.fn(() => Promise.resolve(false)),
  isPuppeteerDetachedError: jest.fn(() => false),
  hashMessageBody: jest.fn((b: any) => String(b ?? '').length),
  normalizeWhatsAppPhone: jest.fn((p: string) => p ? String(p).replace(/\D/g, '') : ''),
  setCurrentQr: jest.fn(),
  setIsReady: jest.fn(),
  destroyClient: jest.fn(() => Promise.resolve(undefined)),
  forceReconnect: jest.fn(() => Promise.resolve(undefined)),
  reconnectClient: jest.fn(() => Promise.resolve(undefined)),
  getChats: jest.fn(() => Promise.resolve([])),
  getChatMessages: jest.fn(() => Promise.resolve([])),
  getMessageMedia: jest.fn(() => Promise.resolve({ mimetype: 'image/jpeg', data: '' })),
  ensureWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  isWhatsAppAutoConnectAllowed: jest.fn(() => true),
  downloadMessageMediaById: jest.fn(() => Promise.resolve(undefined)),
  checkPhoneWhatsAppRegistered: jest.fn(() => Promise.resolve('AVAILABLE')),
  ensureSessionHealth: jest.fn(() => Promise.resolve(true)),
  downloadMessageMediaReliably: jest.fn(() => Promise.resolve(null))
}));

import fs from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';
import request from 'supertest';
import { ensureSchema } from '../src/database.js';

describe('Pharmarack Cart Live Item Deletion Tests', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: express.Express;
  let dbManager: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cart-del-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    dbManager = (await import('../src/database/connection.js')).dbManager;
    const pharmarackRouter = (await import('../src/routes/pharmarack.js')).default;

    app = express();
    app.use(express.json());
    app.use('/api/pharmarack', pharmarackRouter);
  });

  afterAll(async () => {
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('1. POST /api/pharmarack/delete-cart-item rejects missing storeId or product identifier with 400', async () => {
    const resNoStore = await request(app)
      .post('/api/pharmarack/delete-cart-item')
      .send({ productCode: '14905' });
    expect(resNoStore.status).toBe(400);
    expect(resNoStore.body.error).toMatch(/Missing required item details/i);

    const resNoProd = await request(app)
      .post('/api/pharmarack/delete-cart-item')
      .send({ storeId: 47 });
    expect(resNoProd.status).toBe(400);
    expect(resNoProd.body.error).toMatch(/Missing required item details/i);
  });

  test('2. POST /api/pharmarack/delete-cart-item fails gracefully when session token is missing', async () => {
    const db = await dbManager.getConnection();
    await db.run("DELETE FROM app_settings WHERE key = 'pharmarack_session_token'");

    const res = await request(app)
      .post('/api/pharmarack/delete-cart-item')
      .send({
        storeId: 47,
        productCode: '14905',
        productName: 'ECOSPRIN AV 75'
      });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
