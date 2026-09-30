import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('Old purchase bill edit keeps free quantity on the shelf', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purchase-edit-free-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { default: purchasesRouter } = await import('../src/routes/purchases.js');
    const { open } = await import('sqlite');
    const { default: sqlite3 } = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    await db.run('INSERT INTO medicines (id, name, mrp, pack_size) VALUES (70, "FreeEditMed", 50, 10)');
    await db.run('INSERT INTO distributors (id, name) VALUES (70, "Free Dist")');
    await db.run(
      'INSERT INTO purchases (id, distributor_id, invoice_no, total_amount, date) VALUES (70, 70, "P-FREE", 400, "2026-02-01")'
    );
    await db.run(
      'INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, quantity, free_qty, cost_price, mrp) VALUES (70, 70, "F-1", 10, 2, 40, 50)'
    );
    await db.run(
      'INSERT INTO inventory_master (medicine_id, quantity, loose_quantity, batch_no, expiry_date, cost_price, mrp) VALUES (70, 12, 0, "F-1", "12/30", 40, 50)'
    );
    await db.close();

    app = express();
    app.use(express.json());
    app.use('/purchases', purchasesRouter);
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('changing free quantity moves inventory_master.quantity by the net change', async () => {
    const res = await request(app).put('/purchases/70/full').send({
      distributor: 'Free Dist',
      distributor_id: 70,
      invoice_no: 'P-FREE',
      date: '2026-02-01',
      items: [{
        medicine_id: 70,
        medicine_name: 'FreeEditMed',
        batch_no: 'F-1',
        expiry_date: '12/30',
        qty: 10,
        free_qty: 5,
        rate: 40,
        mrp: 50
      }]
    });
    expect(res.status).toBe(200);

    const { open } = await import('sqlite');
    const { default: sqlite3 } = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    const shelf = await db.get('SELECT quantity FROM inventory_master WHERE medicine_id = 70 AND batch_no = ?', ['F-1']);
    const line = await db.get('SELECT quantity, free_qty FROM purchase_items WHERE purchase_id = 70');
    const ledger = await db.all(
      'SELECT transaction_type, quantity FROM stock_ledger WHERE medicine_id = 70 ORDER BY id'
    );
    await db.close();

    expect(shelf.quantity).toBe(15);
    expect(line.quantity).toBe(10);
    expect(line.free_qty).toBe(5);
    // One net row: the bill went from 12 shelf strips to 15 (10 billed + 5 free).
    expect(ledger.map((r: { transaction_type: string; quantity: number }) => [r.transaction_type, r.quantity])).toEqual([
      ['purchase_edit', 3]
    ]);
  });
});
