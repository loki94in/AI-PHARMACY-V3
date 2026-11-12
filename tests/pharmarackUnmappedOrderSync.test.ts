import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('Pharmarack Unmapped Order Sync (isMapped: true + false)', () => {
  let tmpDir: string;
  let dbPath: string;
  const origFetch = globalThis.fetch;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmarack-unmapped-sync-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_token', 'test-token-123')`);
    await db.run(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('automation_enabled', 'false')`);
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

  it('syncs unmapped orders (isMapped: false) for today and past dates into Sent PO History', async () => {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const todayIso = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    const yesterday = new Date(now.getTime() - 86400000);
    const yesterdayIso = `${yesterday.getFullYear()}-${p(yesterday.getMonth() + 1)}-${p(yesterday.getDate())}`;

    const seenIsMappedFlags: boolean[] = [];

    globalThis.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('DisplayOrders')) {
        const body = JSON.parse(String(init?.body || '{}'));
        seenIsMappedFlags.push(body.isMapped);

        if (body.isMapped === false) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  OrderNo: '1893848',
                  OrderId: 1895019,
                  StoreName: 'SK DISTRIBUTORS',
                  storeId: 6241,
                  OrderAmount: '0.00',
                  OrderDate: `${todayIso} 18:37:53.619255`
                },
                {
                  OrderNo: '1893000',
                  OrderId: 1894000,
                  StoreName: 'UNMAPPED PAST PHARMA',
                  storeId: 6242,
                  OrderAmount: '120.00',
                  OrderDate: `${yesterdayIso} 11:00:00`
                }
              ]
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            data: [
              {
                OrderNo: '1893849',
                OrderId: 1895020,
                StoreName: 'MAPPED PHARMA',
                storeId: 101,
                OrderAmount: '500.00',
                OrderDate: `${todayIso} 10:00:00`
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

    const { syncPharmarackOrders, syncHistoricalPharmarackOrders } = await import('../src/services/pharmarackOrderSyncService.js');
    const todayRes = await syncPharmarackOrders(true);
    expect(todayRes.ok).toBe(true);
    expect(todayRes.newOrders).toBe(2);

    const histRes = await syncHistoricalPharmarackOrders(30, true);
    expect(histRes.ok).toBe(true);
    expect(histRes.imported).toBe(1);

    expect(seenIsMappedFlags).toContain(true);
    expect(seenIsMappedFlags).toContain(false);

    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();

    const unmappedToday = await db.get(`SELECT * FROM pharmarack_placed_orders WHERE order_no = '1893848'`);
    expect(unmappedToday).toBeTruthy();
    expect(unmappedToday.store_name).toBe('SK DISTRIBUTORS');
    expect(unmappedToday.order_date).toBe(todayIso);
    expect(JSON.parse(unmappedToday.items_json)).toHaveLength(1);

    const unmappedPast = await db.get(`SELECT * FROM pharmarack_placed_orders WHERE order_no = '1893000'`);
    expect(unmappedPast).toBeTruthy();
    expect(unmappedPast.order_date).toBe(yesterdayIso);
  });
});
