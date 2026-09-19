import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate the WhatsApp auth dir BEFORE any app import, same as whatsappRouting.test.ts.
process.env.WWEBJS_AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-guidance-auth-'));

// Mock the outbound send layer so no real WhatsApp network call is attempted, and so
// we can assert on the exact text handleInbound builds for the customer.
const enqueueMock = jest.fn((..._args: any[]) => Promise.resolve({ id: 1 }));
jest.unstable_mockModule('../src/services/whatsappQueueWorker.js', () => ({
  __esModule: true,
  whatsappQueueWorker: {
    enqueue: enqueueMock,
    forceNext: jest.fn(() => Promise.resolve())
  }
}));

jest.unstable_mockModule('../src/services/pharmarackCatalogCache.js', () => ({
  __esModule: true,
  searchCatalog: jest.fn(() => Promise.resolve([])),
  scoreProductName: jest.fn(() => 0),
  pharmarackCatalogCache: {
    syncCatalog: jest.fn(() => Promise.resolve({ synced: 0, errors: 0 })),
    searchCatalog: jest.fn(() => Promise.resolve([]))
  },
  ensureCatalogSyncCron: jest.fn(),
  stopCatalogSyncCron: jest.fn()
}));

jest.unstable_mockModule('../src/services/scispacyClient.js', () => ({
  __esModule: true,
  queryScispacy: jest.fn(() => Promise.resolve(null)),
  startScispacySidecar: jest.fn(),
  stopScispacySidecar: jest.fn()
}));

import { ensureSchema } from '../src/database.js';

describe('WhatsApp guidance prompt — echoes unparsed messages instead of a bare generic greeting', () => {
  let tmpDir: string;
  let dbPath: string;
  let handleInbound: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-guidance-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    handleInbound = (await import('../src/services/whatsappIntentService.js')).handleInbound;
  }, 60000);

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(async () => {
    enqueueMock.mockClear();
  });

  test('unparsable text (no medicine candidates) is echoed back in the guidance prompt', async () => {
    // Every token here is in the noise-word set, so extractMedicineCandidates()
    // yields zero candidates and the code falls into maybeSendGuidancePrompt().
    const originalText = 'thank you so much sir please ok bhai';

    const mockMsg = {
      from: '917000000001@c.us',
      body: originalText,
      id: { _serialized: 'msg-guidance-101' },
      hasMedia: false
    };

    await handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 500));

    const guidanceCall = (enqueueMock.mock.calls as any[][]).find(c => c[2] === 'customer_guidance_prompt');
    expect(guidanceCall).toBeDefined();
    const sentMessage = String(guidanceCall?.[1] || '');
    expect(sentMessage).toContain(originalText);
  }, 60000);

  test('multi-candidate confirmation includes the customer name when known', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run(
      "INSERT INTO customers (id, name, phone) VALUES (201, 'Priya Sharma', '917000000002')"
    );

    const mockMsg = {
      from: '917000000002@c.us',
      body: 'Dolo 650 aur Telma 40 chahiye',
      id: { _serialized: 'msg-guidance-102' },
      hasMedia: false
    };

    await handleInbound(mockMsg);
    await new Promise(r => setTimeout(r, 500));

    const bundleCall = (enqueueMock.mock.calls as any[][]).find(c => c[2] === 'customer_medicine_clarification');
    expect(bundleCall).toBeDefined();
    const sentMessage = String(bundleCall?.[1] || '');
    expect(sentMessage).toContain('Priya Sharma');
    expect(sentMessage.toLowerCase()).toContain('dolo');
    expect(sentMessage.toLowerCase()).toContain('telma');
  }, 60000);
});
