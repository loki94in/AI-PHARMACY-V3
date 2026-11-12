import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('Pharmarack Historical Order Sync (Sent PO History without past-date WhatsApp reminders)', () => {
  let tmpDir: string;
  let dbPath: string;
  const origFetch = globalThis.fetch;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmarack-hist-sync-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_token', 'test-token-123')`);
    await db.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('automation_enabled', 'true')`);
    await db.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('trigger_dispatch_reminder_enabled', 'true')`);
  });

  afterAll(async () => {
    globalThis.fetch = origFetch;
    try {
      const { dbManager } = await import('../src/database/connection.js');
      await dbManager.closeAll();
    } catch (_) {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('imports past-date orders into Sent PO History without queuing WhatsApp reminders and skips today', async () => {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const todayIso = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    const yesterday = new Date(now.getTime() - 86400000);
    const yesterdayIso = `${yesterday.getFullYear()}-${p(yesterday.getMonth() + 1)}-${p(yesterday.getDate())}`;

    globalThis.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('DisplayOrders')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                OrderNo: 'PR-PAST-001',
                OrderId: 9001,
                StoreName: 'Closed Day Pharma',
                storeId: 101,
                OrderAmount: 450,
                OrderDate: `${yesterdayIso}T14:20:00`
              },
              {
                OrderNo: 'PR-TODAY-001',
                OrderId: 9002,
                StoreName: 'Today Pharma',
                storeId: 102,
                OrderAmount: 300,
                OrderDate: `${todayIso}T10:15:00`
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.includes('GetOrderDetailsForRetailerManager')) {
        return new Response(
          JSON.stringify({
            data: {
              invoicedItems: [
                { ProductFullName: 'DOLO 650MG TAB', Quantity: 2, ProductCode: 'D650', MRP: 30, PTR: 22 }
              ]
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as unknown as typeof fetch;

    const { syncHistoricalPharmarackOrders } = await import('../src/services/pharmarackOrderSyncService.js');
    const res = await syncHistoricalPharmarackOrders(30, true);

    expect(res.ok).toBe(true);
    expect(res.imported).toBe(1);

    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    const pastPlaced = await db.get(`SELECT * FROM pharmarack_placed_orders WHERE order_no = 'PR-PAST-001'`);
    expect(pastPlaced).toBeTruthy();
    expect(pastPlaced.order_date).toBe(yesterdayIso);
    expect(JSON.parse(pastPlaced.items_json)).toHaveLength(1);

    // Today's order must NOT be swallowed by historical sync (so syncPharmarackOrders owns today's WhatsApp reminder).
    const todaySynced = await db.get(`SELECT * FROM pharmarack_synced_orders WHERE order_no = 'PR-TODAY-001'`);
    expect(todaySynced).toBeFalsy();

    // Zero WhatsApp reminders queued for past-date historical orders.
    const queued = await db.all(`SELECT * FROM whatsapp_send_queue`);
    expect(queued).toHaveLength(0);
  });
});
