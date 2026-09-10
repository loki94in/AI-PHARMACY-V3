import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';

// Isolate WhatsApp auth dir
process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-promo-auth-'));

// Fix Jest VM Float32Array instanceof
Object.defineProperty(Float32Array, Symbol.hasInstance, {
  value: (inst: any) => inst && inst.constructor && inst.constructor.name === 'Float32Array'
});

// Mock external services to avoid network/spawning dependencies
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve()),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isReady: true, initializing: false, isSyncing: false })),
  isReady: true,
  currentQr: null,
  shouldRouteToBusiness: jest.fn(() => Promise.resolve(false)),
  initClient: jest.fn(() => Promise.resolve()),
  hashMessageBody: (msg: string) => String(msg).slice(0, 16),
  normalizeWhatsAppPhone: (phone: string) => String(phone).replace(/\D/g, ''),
  hasSavedSession: jest.fn(() => true),
  waitForWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  markWhatsAppActivity: jest.fn(),
  isWhatsAppExplicitlyDisabled: jest.fn(() => Promise.resolve(false)),
  isPuppeteerDetachedError: jest.fn(() => false),
  setCurrentQr: jest.fn(),
  setIsReady: jest.fn(),
  destroyClient: jest.fn(() => Promise.resolve(undefined)),
  forceReconnect: jest.fn(() => Promise.resolve(undefined)),
  reconnectClient: jest.fn(() => Promise.resolve(undefined)),
  getChats: jest.fn(() => Promise.resolve([])),
  getChatMessages: jest.fn(() => Promise.resolve([])),
  getMessageMedia: jest.fn(() => Promise.resolve({ mimetype: 'image/jpeg', data: '' })),
  downloadMessageMediaById: jest.fn(() => Promise.resolve(undefined)),
  ensureWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  isWhatsAppAutoConnectAllowed: jest.fn(() => Promise.resolve(true))
}));

jest.unstable_mockModule('../src/services/pharmarackCatalogCache.js', () => ({
  __esModule: true,
  searchCatalog: jest.fn(() => Promise.resolve({ mapped: [], nonMapped: [] })),
  scoreProductName: jest.fn(() => 0),
}));

jest.unstable_mockModule('../src/services/scispacyClient.js', () => ({
  __esModule: true,
  queryScispacy: jest.fn(() => Promise.resolve(null)),
  startScispacySidecar: jest.fn(),
  stopScispacySidecar: jest.fn()
}));

import {
  isPromotionalOrBroadcastMessage,
  isPlausibleMedicineName,
  extractMedicineCandidates,
  parseMessage
} from '../src/services/intentKeywords.js';

describe('WhatsApp Promotional & Broadcast Filtering (Bug P1-22)', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;
  let handleInbound: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-promo-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;

    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    db = await dbManager.getConnection();

    // Insert master medicine with 0 inventory stock to test out-of-stock flow
    await db.run("INSERT INTO medicines (name, api_reference) VALUES ('Dolo 650 Tab', 'Paracetamol')");

    // Release startup cart sync coordinator for test environment
    const { startupSyncCoordinator } = await import('../src/services/startupSyncCoordinator.js');
    startupSyncCoordinator.markCartLoaded();

    handleInbound = (await import('../src/services/whatsappIntentService.js')).handleInbound;
  }, 60000);

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  describe('isPromotionalOrBroadcastMessage', () => {
    test('detects the exact Shikhar promotional flyer message', () => {
      const text = "*Here's what you are missing on Shikhar*😱\n\n1️⃣Get Upto 500 Ushop points 💰\n2️⃣Maximum Festive margins💰 \n3️⃣New Dhamakedaar Market Updates🥳 🤑\n\n*Start Saving🥰*";
      expect(isPromotionalOrBroadcastMessage(text)).toBe(true);
    });

    test('detects short promotional snippets (deals, margins, month rates)', () => {
      expect(isPromotionalOrBroadcastMessage('⌛Limited festive deals⌛')).toBe(true);
      expect(isPromotionalOrBroadcastMessage('Double Margins')).toBe(true);
      expect(isPromotionalOrBroadcastMessage('Earn 50,000/month from home')).toBe(true);
      expect(isPromotionalOrBroadcastMessage('000/month')).toBe(true);
      expect(isPromotionalOrBroadcastMessage('Dear Retailer, special discount on all orders')).toBe(true);
      expect(isPromotionalOrBroadcastMessage('Happy Diwali to all members! 🎉🎁')).toBe(true);
    });

    test('allows legitimate customer medicine orders to pass through', () => {
      expect(isPromotionalOrBroadcastMessage('need Dolo 650 2 strips')).toBe(false);
      expect(isPromotionalOrBroadcastMessage('pathva Telma 40')).toBe(false);
      expect(isPromotionalOrBroadcastMessage('Novastat 20')).toBe(false);
      expect(isPromotionalOrBroadcastMessage('Azithral 500 1 strip chahiye')).toBe(false);
      expect(isPromotionalOrBroadcastMessage('Pan D 15 tab send karo')).toBe(false);
    });
  });

  describe('isPlausibleMedicineName with promotional and formatting tokens', () => {
    test('rejects promotional strings even if formatted with markdown or emojis', () => {
      expect(isPlausibleMedicineName('*Start Saving🥰*')).toBe(false);
      expect(isPlausibleMedicineName('Festive margins💰')).toBe(false);
      expect(isPlausibleMedicineName('Double Margins')).toBe(false);
      expect(isPlausibleMedicineName('⌛Limited festive deals⌛')).toBe(false);
      expect(isPlausibleMedicineName('000/month')).toBe(false);
      expect(isPlausibleMedicineName('Ushop points 💰')).toBe(false);
    });

    test('accepts genuine medicine names', () => {
      expect(isPlausibleMedicineName('Dolo 650')).toBe(true);
      expect(isPlausibleMedicineName('Novastat 20')).toBe(true);
      expect(isPlausibleMedicineName('Telma 40')).toBe(true);
      expect(isPlausibleMedicineName('Azithromycin 500mg')).toBe(true);
    });
  });

  describe('extractMedicineCandidates with promotional and bullet-point messages', () => {
    test('returns empty array for promotional messages', () => {
      const text = "*Here's what you are missing on Shikhar*😱\n\n1️⃣Get Upto 500 Ushop points 💰\n2️⃣Maximum Festive margins💰 \n3️⃣New Dhamakedaar Market Updates🥳 🤑\n\n*Start Saving🥰*";
      const candidates = extractMedicineCandidates(text);
      expect(candidates).toEqual([]);
    });

    test('preserves genuine multi-item order with quantities and units', () => {
      const candidates = extractMedicineCandidates('2 strips dolo 650 aur 1 telma 40');
      expect(candidates.length).toBe(2);
      expect(candidates[0].medicineName.toLowerCase()).toContain('dolo 650');
      expect(candidates[0].quantity).toBe(2);
      expect(candidates[0].unit).toBe('strip');
      expect(candidates[1].medicineName.toLowerCase()).toContain('telma 40');
      expect(candidates[1].quantity).toBe(1);
    });
  });

  describe('End-to-end handleInbound: zero special_orders created on promotional messages', () => {
    test('promotional broadcast message creates ZERO rows in special_orders', async () => {
      const mockPromoMsg = {
        id: { _serialized: 'promo_msg_101' },
        from: '918655830783@c.us',
        body: "*Here's what you are missing on Shikhar*😱\n\n1️⃣Get Upto 500 Ushop points 💰\n2️⃣Maximum Festive margins💰 \n3️⃣New Dhamakedaar Market Updates🥳 🤑\n\n*Start Saving🥰*",
        hasMedia: false,
        fromMe: false,
        timestamp: Math.floor(Date.now() / 1000)
      };

      await handleInbound(mockPromoMsg);

      const rows = await db.all('SELECT * FROM special_orders WHERE phone LIKE "%8655830783%"');
      expect(rows.length).toBe(0);
    });

    test('conversational chatter without order intent or match creates ZERO rows in special_orders', async () => {
      const mockChatMsg = {
        id: { _serialized: 'chat_msg_102' },
        from: '919999988888@c.us',
        body: 'Hello sir how are you doing today',
        hasMedia: false,
        fromMe: false,
        timestamp: Math.floor(Date.now() / 1000)
      };

      await handleInbound(mockChatMsg);

      const rows = await db.all('SELECT * FROM special_orders WHERE phone LIKE "%9999988888%"');
      expect(rows.length).toBe(0);
    });
  });
});
