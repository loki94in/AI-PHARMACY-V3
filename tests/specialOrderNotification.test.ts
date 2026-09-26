import { jest } from '@jest/globals';

const mockEnqueue = jest.fn((..._args: any[]) => Promise.resolve(1234));
jest.unstable_mockModule('../src/services/whatsappQueueWorker.js', () => ({
  __esModule: true,
  whatsappQueueWorker: {
    enqueue: mockEnqueue,
    forceNext: jest.fn(() => Promise.resolve(true)),
    triggerProcessing: jest.fn()
  }
}));

import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('Special Order Sourcing Notification & Guard Tests', () => {
  let tmpDir: string;
  let dbPath: string;
  let waAdminEscalationService: any;
  let filterCandidatesByFormulation: any;
  let rankSpecialOrderDistributorCandidates: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-notif-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    waAdminEscalationService = (await import('../src/services/waAdminEscalationService.js')).waAdminEscalationService;
    const intentMod = await import('../src/services/whatsappIntentService.js');
    filterCandidatesByFormulation = intentMod.filterCandidatesByFormulation;
    const pharmaMod = await import('../src/routes/pharmarack.js');
    rankSpecialOrderDistributorCandidates = pharmaMod.rankSpecialOrderDistributorCandidates;
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM app_settings');
    await db.run("INSERT INTO app_settings (key, value) VALUES ('wa_auto_share_admin', 'true')");
    await db.run("INSERT INTO app_settings (key, value) VALUES ('admin_whatsapp', '919876543210')");
  });

  test('notifyOwnerOfSpecialOrderPharmarackResults formats Rate | MRP and separate Margin line without Wholesale PTR', async () => {
    await waAdminEscalationService.notifyOwnerOfSpecialOrderPharmarackResults({
      specialOrderId: 2,
      soCode: 'SO-TMSA-2',
      customerName: 'Mr. RATNAKR',
      customerPhone: '9307409630',
      medicineName: 'IBUGESIC PLUS SYRUP',
      quantity: 5,
      unit: 'bottle',
      mrp: 62.27,
      totalAmount: 311.35,
      pharmarackOptions: [
        {
          name: 'IBUGESIC PLUS SYRUP 60ML',
          distributor: 'Sinhagad Pharma Pvt Ltd',
          rate: 31.61,
          mrp: 41.49,
          mapped: true,
          stock: '98'
        }
      ]
    });

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const msg = mockEnqueue.mock.calls[0][1] as string;
    expect(msg).toContain('IBUGESIC PLUS SYRUP');
    expect(msg).toContain('Rate: ₹31.61 | MRP: ₹41.49');
    expect(msg).toContain('Margin: ₹9.88 (23.8%)');
    expect(msg).not.toContain('Wholesale PTR:');
  });

  test('filterCandidatesByFormulation enforces Dosage Form Shield (Syrup != Tab)', () => {
    const candidates = [
      { name: 'IBUGESIC PLUS TAB', distributor: 'Dist 1' },
      { name: 'IBUGESIC PLUS SYRUP 60ML', distributor: 'Dist 2' },
      { name: 'IBUGESIC PLUS SUSP 100ML', distributor: 'Dist 3' }
    ];
    const results = filterCandidatesByFormulation('IBUGESIC PLUS SYRUP', candidates);
    expect(results.length).toBe(2);
    expect(results.some((r: any) => r.name.includes('TAB'))).toBe(false);
    expect(results.every((r: any) => r.name.includes('SYRUP') || r.name.includes('SUSP'))).toBe(true);
  });

  test('rankSpecialOrderDistributorCandidates strictly prioritizes mapped distributors when available', async () => {
    const candidates = [
      { name: 'Med A', distributor: 'Dist Mapped 1', rate: 30, mrp: 50, mapped: true, stock: 10 },
      { name: 'Med A', distributor: 'Dist Mapped 2', rate: 32, mrp: 50, mapped: true, stock: 20 },
      { name: 'Med A', distributor: 'Dist Unmapped 1', rate: 25, mrp: 50, mapped: false, stock: 50 }
    ];
    const results = await rankSpecialOrderDistributorCandidates(null, candidates, 2, 1);
    expect(results.length).toBe(2);
    expect(results.every((r: any) => r.mapped === true)).toBe(true);
    expect(results.some((r: any) => r.mapped === false)).toBe(false);
  });
});
