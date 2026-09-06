import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { createStaffToken, verifyStaffToken } from '../src/middleware/tenantAuth.js';

describe('Multi-Pharmacy Phase 1: Tenant Isolation & Snapshot Polish (MULTI-PHARMACY.md §3, §5, §8, §23, §28, §34)', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE stores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT UNIQUE,
        is_central INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
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
        loose_quantity INTEGER DEFAULT 0,
        mrp REAL,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        distributor_id INTEGER,
        invoice_no TEXT,
        app_invoice_no TEXT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        total_amount REAL
      );

      CREATE TABLE sales_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT UNIQUE,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        total_amount REAL,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'completed',
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
        mrp REAL,
        medicine_name_snapshot TEXT DEFAULT NULL,
        batch_no_snapshot TEXT DEFAULT NULL,
        expiry_date_snapshot TEXT DEFAULT NULL,
        mrp_snapshot REAL DEFAULT NULL,
        tax_percent_snapshot REAL DEFAULT NULL
      );

      INSERT INTO stores (id, name, code, is_central) VALUES (1, 'Central Pharmacy Downtown', 'STORE-1', 1);
      INSERT INTO stores (id, name, code, is_central) VALUES (2, 'Branch Uptown', 'STORE-2', 0);
    `);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it('correctly scopes inventory_master queries to the requesting pharmacy store (§8, §34)', async () => {
    // Seed medicine
    await db.run("INSERT INTO medicines (id, name, mrp) VALUES (1, 'Paracetamol 500mg', 20.0)");

    // Store 1 inventory row
    await db.run("INSERT INTO inventory_master (id, store_id, medicine_id, batch_no, quantity) VALUES (1, 1, 1, 'BATCH-STORE1', 50)");
    // Store 2 inventory row
    await db.run("INSERT INTO inventory_master (id, store_id, medicine_id, batch_no, quantity) VALUES (2, 2, 1, 'BATCH-STORE2', 15)");
    // Legacy row with store_id NULL (must fallback to Store 1 for backward compatibility §34)
    await db.run("INSERT INTO inventory_master (id, store_id, medicine_id, batch_no, quantity) VALUES (3, NULL, 1, 'BATCH-LEGACY', 10)");

    // Query Store 1 view
    const store1Rows = await db.all(
      `SELECT * FROM inventory_master im WHERE (im.store_id = ? OR (im.store_id IS NULL AND ? = 1))`,
      [1, 1]
    );
    expect(store1Rows.length).toBe(2);
    expect(store1Rows.some(r => r.batch_no === 'BATCH-STORE1')).toBe(true);
    expect(store1Rows.some(r => r.batch_no === 'BATCH-LEGACY')).toBe(true);
    expect(store1Rows.some(r => r.batch_no === 'BATCH-STORE2')).toBe(false);

    // Query Store 2 view
    const store2Rows = await db.all(
      `SELECT * FROM inventory_master im WHERE (im.store_id = ? OR (im.store_id IS NULL AND ? = 1))`,
      [2, 2]
    );
    expect(store2Rows.length).toBe(1);
    expect(store2Rows[0].batch_no).toBe('BATCH-STORE2');

    // All stores view
    const allRows = await db.all(`SELECT * FROM inventory_master im`);
    expect(allRows.length).toBe(3);
  });

  it('correctly isolates purchases between pharmacy branches (§8, §23)', async () => {
    // Store 1 purchase
    await db.run("INSERT INTO purchases (id, store_id, invoice_no, total_amount) VALUES (1, 1, 'PUR-STORE1-001', 5000.0)");
    // Store 2 purchase
    await db.run("INSERT INTO purchases (id, store_id, invoice_no, total_amount) VALUES (2, 2, 'PUR-STORE2-001', 1200.0)");
    // Legacy purchase (store_id NULL)
    await db.run("INSERT INTO purchases (id, store_id, invoice_no, total_amount) VALUES (3, NULL, 'PUR-LEGACY-001', 800.0)");

    // Query Store 1 purchases
    const store1Purchases = await db.all(
      `SELECT * FROM purchases p WHERE (p.store_id = ? OR (p.store_id IS NULL AND ? = 1))`,
      [1, 1]
    );
    expect(store1Purchases.length).toBe(2);
    expect(store1Purchases.some(p => p.invoice_no === 'PUR-STORE1-001')).toBe(true);
    expect(store1Purchases.some(p => p.invoice_no === 'PUR-LEGACY-001')).toBe(true);
    expect(store1Purchases.some(p => p.invoice_no === 'PUR-STORE2-001')).toBe(false);

    // Query Store 2 purchases
    const store2Purchases = await db.all(
      `SELECT * FROM purchases p WHERE (p.store_id = ? OR (p.store_id IS NULL AND ? = 1))`,
      [2, 2]
    );
    expect(store2Purchases.length).toBe(1);
    expect(store2Purchases[0].invoice_no).toBe('PUR-STORE2-001');
  });

  it('verifies cross-store invoice access check rejects unauthorized tenant token (§8, §23)', async () => {
    // Seed Store 1 Invoice
    await db.run(`
      INSERT INTO sales_invoices (id, invoice_no, store_id, total_amount, customer_name_snapshot)
      VALUES (101, 'INV-101', 1, 250.0, 'Customer Downtown')
    `);

    // Staff member token for Store 2
    const store2StaffToken = createStaffToken({
      userId: 202,
      username: 'branch_pharmacist',
      storeId: 2,
      role: 'pharmacist'
    });
    const verifiedStaff = verifyStaffToken(store2StaffToken);
    expect(verifiedStaff).not.toBeNull();
    expect(verifiedStaff?.storeId).toBe(2);

    // Fetch invoice 101
    const invoice = await db.get("SELECT * FROM sales_invoices WHERE id = 101");
    expect(invoice).not.toBeNull();

    // Verification logic matching GET /api/sales/:id
    const isOwner = verifiedStaff?.role === 'owner';
    const isDenied = !isOwner && invoice.store_id && verifiedStaff?.storeId && invoice.store_id !== verifiedStaff.storeId;

    expect(isDenied).toBe(true);
  });

  it('ensures customer portal bill retrieval reflects frozen snapshots (§5, §7)', async () => {
    // Seed customer and past sale with snapshots
    await db.run("INSERT INTO customers (id, name, phone) VALUES (1, 'Anil Kumar', '9876543210')");
    await db.run("INSERT INTO medicines (id, name, mrp) VALUES (1, 'Amoxicillin 500mg', 75.0)");
    await db.run("INSERT INTO inventory_master (id, store_id, medicine_id, batch_no) VALUES (1, 1, 1, 'AMX-01')");

    await db.run(`
      INSERT INTO sales_invoices (
        id, invoice_no, store_id, customer_id, total_amount,
        customer_name_snapshot, customer_phone_snapshot, pharmacy_name_snapshot
      ) VALUES (1, 'INV-901', 1, 1, 75.0, 'Anil Kumar', '9876543210', 'Central Pharmacy Downtown')
    `);

    await db.run(`
      INSERT INTO sale_items (
        invoice_id, inventory_id, quantity, unit_price, mrp_snapshot, medicine_name_snapshot
      ) VALUES (1, 1, 1, 75.0, 75.0, 'Amoxicillin 500mg')
    `);

    // Customer renames in CRM, medicine catalog renamed in database
    await db.run("UPDATE customers SET name = 'Anil K. Sharma' WHERE id = 1");
    await db.run("UPDATE medicines SET name = 'Amoxicillin Forte 625mg', mrp = 110.0 WHERE id = 1");
    await db.run("UPDATE stores SET name = 'Central Medical Superstore' WHERE id = 1");

    // Customer Portal query
    const bills = await db.all(`
      SELECT si.id, si.invoice_no, si.store_id,
             COALESCE(si.pharmacy_name_snapshot, st.name, 'Pharmacy') as store_name
      FROM sales_invoices si
      LEFT JOIN stores st ON st.id = si.store_id
      WHERE si.customer_id = 1 AND (si.status IS NULL OR si.status != 'cancelled')
    `);

    expect(bills.length).toBe(1);
    expect(bills[0].store_name).toBe('Central Pharmacy Downtown'); // Preserves snapshot from sale time

    const items = await db.all(`
      SELECT sit.id, sit.quantity, sit.unit_price,
             COALESCE(sit.mrp_snapshot, sit.mrp, 0) as mrp,
             COALESCE(sit.medicine_name_snapshot, m.name, 'Medicine') as medicine_name
      FROM sale_items sit
      LEFT JOIN inventory_master im ON im.id = sit.inventory_id
      LEFT JOIN medicines m ON m.id = im.medicine_id
      WHERE sit.invoice_id = 1
    `);

    expect(items.length).toBe(1);
    expect(items[0].medicine_name).toBe('Amoxicillin 500mg'); // Frozen at time of bill
    expect(items[0].mrp).toBe(75.0);
  });
});
