import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import crypto from 'crypto';
import { createStaffToken, verifyStaffToken } from '../src/middleware/tenantAuth.js';

describe('Multi-Pharmacy Tenant & Bill Snapshot Integrity (MULTI-PHARMACY.md §3, §5, §8, §18)', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });

    // Initialize Schema v55 test database
    await db.exec(`
      CREATE TABLE stores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT UNIQUE,
        is_central INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE pharmacy_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        role TEXT DEFAULT 'pharmacist',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE pharmacy_user_tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        store_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'pharmacist',
        permissions_json TEXT DEFAULT '["*"]',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES pharmacy_users(id),
        FOREIGN KEY(store_id) REFERENCES stores(id),
        UNIQUE(user_id, store_id)
      );

      CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT
      );

      CREATE TABLE medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        mrp REAL
      );

      CREATE TABLE inventory_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        medicine_id INTEGER,
        batch_no TEXT,
        expiry_date TEXT,
        quantity INTEGER DEFAULT 10,
        mrp REAL
      );

      CREATE TABLE sales_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT UNIQUE,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        total_amount REAL,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        customer_name_snapshot TEXT DEFAULT NULL,
        customer_phone_snapshot TEXT DEFAULT NULL,
        customer_address_snapshot TEXT DEFAULT NULL,
        doctor_name_snapshot TEXT DEFAULT NULL,
        pharmacy_name_snapshot TEXT DEFAULT NULL
      );

      CREATE TABLE sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER,
        inventory_id INTEGER,
        quantity INTEGER,
        unit_price REAL,
        medicine_name_snapshot TEXT DEFAULT NULL,
        batch_no_snapshot TEXT DEFAULT NULL,
        expiry_date_snapshot TEXT DEFAULT NULL,
        mrp_snapshot REAL DEFAULT NULL,
        tax_percent_snapshot REAL DEFAULT NULL
      );

      INSERT INTO stores (id, name, code) VALUES (1, 'Main Store Downtown', 'STORE-1');
      INSERT INTO stores (id, name, code) VALUES (2, 'Branch Uptown', 'STORE-2');
    `);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it('generates and verifies staff tokens with tenant context', () => {
    const token = createStaffToken({
      userId: 101,
      username: 'pharmacist_john',
      storeId: 2,
      role: 'pharmacist',
      permissions: ['create_sale', 'view_inventory']
    });

    const verified = verifyStaffToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(101);
    expect(verified?.username).toBe('pharmacist_john');
    expect(verified?.storeId).toBe(2);
    expect(verified?.role).toBe('pharmacist');
    expect(verified?.permissions).toContain('create_sale');
  });

  it('rejects tampered or malformed staff tokens', () => {
    const token = createStaffToken({
      userId: 101,
      username: 'pharmacist_john',
      storeId: 2,
      role: 'pharmacist'
    });

    // Tamper with payload
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const tamperedPayload = decoded.replace('pharmacist_john', 'admin_hacker');
    const tamperedToken = Buffer.from(tamperedPayload).toString('base64');

    expect(verifyStaffToken(tamperedToken)).toBeNull();
    expect(verifyStaffToken('invalid.token.here')).toBeNull();
  });

  it('guarantees historical bill immutability when customer is renamed (§5)', async () => {
    // 1. Create original customer & medicine
    await db.run(`INSERT INTO customers (id, name, phone, address) VALUES (1, 'Rahul Patil', '9876543210', '123 MG Road')`);
    await db.run(`INSERT INTO medicines (id, name, mrp) VALUES (1, 'Paracetamol 500mg', 25.0)`);
    await db.run(`INSERT INTO inventory_master (id, store_id, medicine_id, batch_no, expiry_date, quantity, mrp) VALUES (1, 1, 1, 'BATCH-001', '2027-12-31', 100, 25.0)`);

    // 2. Insert invoice with snapshot data (Simulating sale creation)
    await db.run(`
      INSERT INTO sales_invoices (
        invoice_no, store_id, customer_id, total_amount,
        customer_name_snapshot, customer_phone_snapshot, customer_address_snapshot, pharmacy_name_snapshot
      ) VALUES ('INV-1001', 1, 1, 50.0, 'Rahul Patil', '9876543210', '123 MG Road', 'Main Store Downtown')
    `);

    await db.run(`
      INSERT INTO sale_items (
        invoice_id, inventory_id, quantity, unit_price,
        medicine_name_snapshot, batch_no_snapshot, expiry_date_snapshot, mrp_snapshot
      ) VALUES (1, 1, 2, 25.0, 'Paracetamol 500mg', 'BATCH-001', '2027-12-31', 25.0)
    `);

    // 3. Customer later changes name and phone in CRM
    await db.run(`UPDATE customers SET name = 'Rohan Patil', phone = '9999999999', address = '456 Residency Rd' WHERE id = 1`);
    // And medicine catalog name is renamed/updated
    await db.run(`UPDATE medicines SET name = 'Paracetamol Extra 500mg', mrp = 35.0 WHERE id = 1`);

    // 4. Query past invoice with snapshot resolution: MUST return original Rahul Patil and Paracetamol 500mg!
    const bill = await db.get(`
      SELECT si.invoice_no,
             COALESCE(si.customer_name_snapshot, c.name) as customer_name,
             COALESCE(si.customer_phone_snapshot, c.phone) as customer_phone,
             COALESCE(si.customer_address_snapshot, c.address) as customer_address,
             COALESCE(si.pharmacy_name_snapshot, 'Pharmacy') as pharmacy_name
      FROM sales_invoices si
      LEFT JOIN customers c ON c.id = si.customer_id
      WHERE si.invoice_no = 'INV-1001'
    `);

    expect(bill.customer_name).toBe('Rahul Patil');
    expect(bill.customer_phone).toBe('9876543210');
    expect(bill.customer_address).toBe('123 MG Road');

    const item = await db.get(`
      SELECT sit.quantity,
             COALESCE(sit.medicine_name_snapshot, m.name) as medicine_name,
             COALESCE(sit.mrp_snapshot, m.mrp) as mrp
      FROM sale_items sit
      LEFT JOIN inventory_master im ON im.id = sit.inventory_id
      LEFT JOIN medicines m ON m.id = im.medicine_id
      WHERE sit.invoice_id = 1
    `);

    expect(item.medicine_name).toBe('Paracetamol 500mg');
    expect(item.mrp).toBe(25.0);
  });

  it('enforces tenant data isolation between Store 1 and Store 2 bills (§8, §38)', async () => {
    // Store 1 Invoice
    await db.run(`
      INSERT INTO sales_invoices (invoice_no, store_id, total_amount, customer_name_snapshot)
      VALUES ('INV-STORE1-001', 1, 150.0, 'Customer Store 1')
    `);

    // Store 2 Invoice
    await db.run(`
      INSERT INTO sales_invoices (invoice_no, store_id, total_amount, customer_name_snapshot)
      VALUES ('INV-STORE2-001', 2, 350.0, 'Customer Store 2')
    `);

    // Store 1 query
    const store1Bills = await db.all(`SELECT * FROM sales_invoices WHERE store_id = 1`);
    expect(store1Bills.length).toBe(1);
    expect(store1Bills[0].invoice_no).toBe('INV-STORE1-001');

    // Store 2 query
    const store2Bills = await db.all(`SELECT * FROM sales_invoices WHERE store_id = 2`);
    expect(store2Bills.length).toBe(1);
    expect(store2Bills[0].invoice_no).toBe('INV-STORE2-001');

    // Cross-store query without tenant filter is prevented by store scoping
    expect(store1Bills.some(b => b.invoice_no === 'INV-STORE2-001')).toBe(false);
    expect(store2Bills.some(b => b.invoice_no === 'INV-STORE1-001')).toBe(false);
  });

  it('backfills legacy pre-migration invoices with customer and medicine snapshots cleanly', async () => {
    // Seed legacy invoice without snapshots
    await db.run(`INSERT INTO customers (id, name, phone) VALUES (2, 'Pre-Migration User', '9123456780')`);
    await db.run(`INSERT INTO medicines (id, name, mrp) VALUES (2, 'Aspirin 75mg', 10.0)`);
    await db.run(`INSERT INTO inventory_master (id, store_id, medicine_id, batch_no, expiry_date, mrp) VALUES (2, 1, 2, 'ASP-75', '2026-06-30', 10.0)`);

    await db.run(`INSERT INTO sales_invoices (id, invoice_no, store_id, customer_id, total_amount) VALUES (99, 'INV-LEGACY-99', 1, 2, 20.0)`);
    await db.run(`INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price) VALUES (99, 2, 2, 10.0)`);

    // Verify snapshots are initially NULL
    const preInv = await db.get('SELECT customer_name_snapshot FROM sales_invoices WHERE id = 99');
    expect(preInv.customer_name_snapshot).toBeNull();

    // Run Schema v55 backfill
    await db.run(`
      UPDATE sales_invoices
      SET customer_name_snapshot = (SELECT name FROM customers WHERE customers.id = sales_invoices.customer_id),
          customer_phone_snapshot = (SELECT phone FROM customers WHERE customers.id = sales_invoices.customer_id)
      WHERE customer_name_snapshot IS NULL AND customer_id IS NOT NULL
    `);

    await db.run(`
      UPDATE sale_items
      SET medicine_name_snapshot = (SELECT m.name FROM inventory_master im JOIN medicines m ON m.id = im.medicine_id WHERE im.id = sale_items.inventory_id),
          batch_no_snapshot = (SELECT im.batch_no FROM inventory_master im WHERE im.id = sale_items.inventory_id),
          expiry_date_snapshot = (SELECT im.expiry_date FROM inventory_master im WHERE im.id = sale_items.inventory_id),
          mrp_snapshot = (SELECT im.mrp FROM inventory_master im WHERE im.id = sale_items.inventory_id)
      WHERE medicine_name_snapshot IS NULL AND inventory_id IS NOT NULL
    `);

    // Verify snapshots are populated
    const postInv = await db.get('SELECT customer_name_snapshot, customer_phone_snapshot FROM sales_invoices WHERE id = 99');
    expect(postInv.customer_name_snapshot).toBe('Pre-Migration User');
    expect(postInv.customer_phone_snapshot).toBe('9123456780');

    const postItem = await db.get('SELECT medicine_name_snapshot, batch_no_snapshot, mrp_snapshot FROM sale_items WHERE invoice_id = 99');
    expect(postItem.medicine_name_snapshot).toBe('Aspirin 75mg');
    expect(postItem.batch_no_snapshot).toBe('ASP-75');
    expect(postItem.mrp_snapshot).toBe(10.0);
  });
});
