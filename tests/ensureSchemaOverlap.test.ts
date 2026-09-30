import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';
import { dbManager } from '../src/database/connection.js';

// Bug P2-82: two ensureSchema() runs overlapping (email sync + inbox read) cleared
// dbManager.isBooting while one was still running. That run's bill-date UPDATE on
// sales_invoices then looked like a stock write to the write interceptor and fired a full
// stock-metrics + expiry-cache rebuild (~17 a day in the real shop log). The flag must stay
// set until the LAST run finishes.
describe('ensureSchema keeps the boot flag for overlapping runs', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-overlap-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath); // fresh DB: full DDL once; later runs take the fast path
  });

  afterAll(async () => {
    await dbManager.close(true).catch(() => {});
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('the bill-date UPDATE never runs with isBooting=false while a run is in flight', async () => {
    const db = await dbManager.getConnection();
    const realRun = db.run;
    const flagAtBillDateUpdate: boolean[] = [];
    let second: Promise<void> | null = null;
    db.run = function (this: unknown, sql: any, ...params: any[]) {
      if (typeof sql === 'string' && sql.includes('UPDATE sales_invoices SET date')) {
        flagAtBillDateUpdate.push(dbManager.isBooting);
        // Start the second run when the first reaches its bill-date step: the first then has only
        // its short tail left and finishes while the second is still mid-way (the real overlap).
        if (!second) second = ensureSchema(dbPath);
      }
      return (realRun as any).call(this, sql, ...params);
    } as any;
    try {
      await ensureSchema(dbPath);
      await second;
    } finally {
      db.run = realRun;
    }
    expect(flagAtBillDateUpdate).toEqual([true, true]);
    expect(dbManager.isBooting).toBe(false);
  });
});
