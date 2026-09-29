import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('Investigation stock columns match POS shelf math', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;
  let inventoryId: number;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'investigation-columns-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const { default: investigationRouter } = await import('../src/routes/investigation.js');
    const { open } = await import('sqlite');
    const { default: sqlite3 } = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    const med = await db.run(
      'INSERT INTO medicines (name, mrp, pack_size) VALUES (?, ?, ?)',
      ['ColumnMed', 20, 10]
    );
    const medicineId = med.lastID!;
    // Shelf after purchase 10+2 and a sale of 1 strip + 4 loose (pack 10): 10 strips, 6 loose.
    const inv = await db.run(
      'INSERT INTO inventory_master (medicine_id, quantity, loose_quantity, batch_no, expiry_date, mrp, cost_price) VALUES (?, 10, 6, ?, ?, ?, ?)',
      [medicineId, 'COL-1', '12/30', 20, 8]
    );
    inventoryId = inv.lastID!;

    const dist = await db.run('INSERT INTO distributors (name) VALUES (?)', ['Column Dist']);
    const pur = await db.run(
      'INSERT INTO purchases (distributor_id, invoice_no, total_amount, date) VALUES (?, ?, ?, ?)',
      [dist.lastID, 'P-COL', 80, '2026-01-01 10:00:00']
    );
    await db.run(
      'INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, quantity, free_qty, cost_price, mrp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [pur.lastID, medicineId, 'COL-1', 10, 2, 8, 20]
    );

    const cust = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Column Patient', '9000000001']);
    const sale = await db.run(
      'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount, date) VALUES (?, ?, ?, ?)',
      ['S-COL', cust.lastID, 28, '2026-01-02 10:00:00']
    );
    await db.run(
      'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty) VALUES (?, ?, ?, ?, ?)',
      [sale.lastID, inventoryId, 1, 20, 4]
    );
    await db.close();

    app = express();
    app.use(express.json());
    app.use('/investigation', investigationRouter);
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('timeline closing stock uses purchase free qty and POS strip/loose sale math', async () => {
    const res = await request(app).get('/investigation/timeline').query({ medicineName: 'ColumnMed', limit: 50 });
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<Record<string, number | string>>;
    const purchase = rows.find(r => r.type === 'Purchase');
    const sale = rows.find(r => r.type === 'Sale');
    expect(purchase).toBeDefined();
    expect(purchase?.purchase_qty).toBe(10);
    expect(purchase?.free_qty).toBe(2);
    expect(purchase?.closing_qty).toBe(12);
    expect(purchase?.closing_loose).toBe(0);
    expect(sale).toBeDefined();
    expect(sale?.sale_qty).toBe(1);
    expect(sale?.sale_loose).toBe(4);
    expect(sale?.closing_qty).toBe(10);
    expect(sale?.closing_loose).toBe(6);
  });

  test('investigation stock edit writes inventory_master and a stock_ledger delta', async () => {
    const res = await request(app)
      .put(`/investigation/inventory/${inventoryId}`)
      .send({
        quantity: 9,
        loose_quantity: 2,
        batch_no: 'COL-1',
        expiry_date: '12/30',
        mrp: 20,
        cost_price: 8,
        rack_location: ''
      });
    expect(res.status).toBe(200);

    const { open } = await import('sqlite');
    const { default: sqlite3 } = await import('sqlite3');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    const shelf = await db.get('SELECT quantity, loose_quantity FROM inventory_master WHERE id = ?', [inventoryId]);
    const ledger = await db.get(
      `SELECT quantity, loose_quantity, transaction_type FROM stock_ledger WHERE transaction_type = 'investigation_adjustment' ORDER BY id DESC LIMIT 1`
    );
    await db.close();

    expect(shelf.quantity).toBe(9);
    expect(shelf.loose_quantity).toBe(2);
    expect(ledger.quantity).toBe(-1);
    expect(ledger.loose_quantity).toBe(-4);
    expect(ledger.transaction_type).toBe('investigation_adjustment');
  });
});
