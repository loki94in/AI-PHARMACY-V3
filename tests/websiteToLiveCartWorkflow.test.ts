import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

describe('Website-to-Live-Cart Dual Track & Offline Sync Workflow', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        generic_name TEXT,
        strength TEXT,
        packaging TEXT,
        mrp REAL,
        sell_price REAL
      );

      CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT
      );

      CREATE TABLE patient_refills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        medicine_name TEXT,
        quantity_needed INTEGER DEFAULT 1,
        distributor_name TEXT
      );

      CREATE TABLE medicine_distributor_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_name TEXT,
        store_id INTEGER,
        distributor_name TEXT,
        product_id INTEGER,
        product_code TEXT,
        rate REAL,
        mrp REAL,
        is_preferred INTEGER DEFAULT 1
      );

      CREATE TABLE distributor_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER,
        store_name TEXT,
        product_name TEXT,
        product_id INTEGER,
        product_code TEXT,
        rate REAL,
        mrp REAL
      );

      CREATE TABLE special_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        product TEXT,
        medicine_name TEXT,
        requester TEXT,
        phone TEXT,
        qty INTEGER DEFAULT 1,
        priority TEXT DEFAULT 'Normal',
        status TEXT DEFAULT 'Pending',
        delivery_status TEXT DEFAULT 'pending',
        payment_status TEXT DEFAULT 'UNPAID',
        pharmacy_verification_status TEXT DEFAULT 'PENDING',
        pharmarack_distributor TEXT,
        pharmarack_store_id INTEGER,
        pharmarack_product_id INTEGER,
        pharmarack_product_code TEXT,
        pharmarack_rate REAL,
        pharmarack_mrp REAL,
        needs_live_cart_sync INTEGER DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE online_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        product_name TEXT,
        product_name_snapshot TEXT,
        requested_qty INTEGER,
        confirmed_qty INTEGER,
        mrp REAL,
        final_price REAL,
        subtotal REAL,
        item_status TEXT DEFAULT 'PENDING'
      );

      CREATE TABLE order_tracking_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        event_type TEXT,
        event_detail TEXT,
        performed_by TEXT,
        performed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed test distributor data
    await db.run(
      `INSERT INTO medicine_distributor_links (medicine_name, store_id, distributor_name, product_id, product_code, rate, mrp, is_preferred)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      ['TELMISARTAN 40MG', 101, 'Prime Pharma Distributors', 5001, 'TEL40', 25.50, 45.00]
    );

    await db.run(
      `INSERT INTO distributor_catalog (store_id, store_name, product_name, product_id, product_code, rate, mrp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [102, 'Apex Healthcare Agency', 'AUGMENTIN 625 DUO', 6001, 'AUG625', 120.00, 204.00]
    );

    await db.run(
      `INSERT INTO customers (id, name, phone, address) VALUES (1, 'Ramesh Patil', '9876543210', '123 Market Rd')`
    );

    await db.run(
      `INSERT INTO patient_refills (customer_id, medicine_name, quantity_needed) VALUES (1, 'TELMISARTAN 40MG', 2)`
    );
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it('identifies refill items and marks them with resolved distributor for live cart auto-add', async () => {
    const isRefill = await db.get(
      `SELECT id FROM patient_refills WHERE customer_id = 1 AND LOWER(TRIM(medicine_name)) = LOWER(TRIM(?)) LIMIT 1`,
      ['TELMISARTAN 40MG']
    );
    expect(isRefill).toBeTruthy();

    const distLink = await db.get(
      `SELECT store_id, distributor_name, product_id, product_code, rate, mrp 
       FROM medicine_distributor_links 
       WHERE LOWER(TRIM(medicine_name)) = LOWER(TRIM(?)) 
       ORDER BY is_preferred DESC LIMIT 1`,
      ['TELMISARTAN 40MG']
    );
    expect(distLink.distributor_name).toBe('Prime Pharma Distributors');
    expect(distLink.store_id).toBe(101);

    // Simulate online addition to live cart
    const ins = await db.run(
      `INSERT INTO special_orders (
         customer_id, product, requester, phone, qty, status, delivery_status, pharmacy_verification_status,
         pharmarack_distributor, pharmarack_store_id, pharmarack_product_id, pharmarack_product_code,
         pharmarack_rate, pharmarack_mrp, needs_live_cart_sync
       ) VALUES (?, ?, ?, ?, ?, 'In Live Cart', 'in_live_cart', 'IN_LIVE_CART', ?, ?, ?, ?, ?, ?, 0)`,
      [1, 'TELMISARTAN 40MG', 'Ramesh Patil', '9876543210', 2, distLink.distributor_name, distLink.store_id, distLink.product_id, distLink.product_code, distLink.rate, distLink.mrp]
    );

    const orderId = ins.lastID;
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    expect(order.status).toBe('In Live Cart');
    expect(order.delivery_status).toBe('in_live_cart');
    expect(order.needs_live_cart_sync).toBe(0);
    expect(order.pharmarack_distributor).toBe('Prime Pharma Distributors');
  });

  it('marks orders as offline_queued when PC is offline, then syncs them when online', async () => {
    // 1. Order placed while offline
    const ins = await db.run(
      `INSERT INTO special_orders (
         customer_id, product, requester, phone, qty, status, delivery_status, pharmacy_verification_status,
         needs_live_cart_sync
       ) VALUES (?, ?, ?, ?, ?, 'Pending', 'offline_queued', 'OFFLINE_QUEUED', 1)`,
      [1, 'AUGMENTIN 625 DUO', 'Ramesh Patil', '9876543210', 1]
    );
    const orderId = ins.lastID;

    const queued = await db.all('SELECT * FROM special_orders WHERE needs_live_cart_sync = 1');
    expect(queued.length).toBe(1);
    expect(queued[0].id).toBe(orderId);

    // 2. Simulate startup sync resolution
    const catRow = await db.get(
      `SELECT store_id, store_name, product_id, product_code, rate, mrp 
       FROM distributor_catalog 
       WHERE LOWER(TRIM(product_name)) = LOWER(TRIM(?)) LIMIT 1`,
      [queued[0].product]
    );
    expect(catRow.store_name).toBe('Apex Healthcare Agency');

    // Update synced order
    await db.run(
      `UPDATE special_orders 
       SET needs_live_cart_sync = 0,
           status = 'In Live Cart',
           delivery_status = 'in_live_cart',
           pharmacy_verification_status = 'IN_LIVE_CART',
           pharmarack_distributor = ?,
           pharmarack_store_id = ?,
           pharmarack_product_id = ?,
           pharmarack_product_code = ?,
           pharmarack_rate = ?,
           pharmarack_mrp = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [catRow.store_name, catRow.store_id, catRow.product_id, catRow.product_code, catRow.rate, catRow.mrp, orderId]
    );

    const synced = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    expect(synced.needs_live_cart_sync).toBe(0);
    expect(synced.status).toBe('In Live Cart');
    expect(synced.delivery_status).toBe('in_live_cart');
    expect(synced.pharmarack_distributor).toBe('Apex Healthcare Agency');
  });

  it('human payment approval on special order pushes item into Live Cart with distributor details', async () => {
    // Customer orders special medicine with payment pending
    const ins = await db.run(
      `INSERT INTO special_orders (
         customer_id, product, requester, phone, qty, status, payment_status, pharmacy_verification_status
       ) VALUES (?, ?, ?, ?, ?, 'Pending', 'UNPAID', 'PENDING')`,
      [1, 'TELMISARTAN 40MG', 'Ramesh Patil', '9876543210', 3]
    );
    const orderId = ins.lastID;

    // Pharmacist clicks "Approve Payment" in Web Orders Hub
    const dist = await db.get(
      `SELECT store_id, distributor_name, product_id, product_code, rate, mrp 
       FROM medicine_distributor_links 
       WHERE LOWER(TRIM(medicine_name)) = LOWER(TRIM(?)) LIMIT 1`,
      ['TELMISARTAN 40MG']
    );

    await db.run(
      `UPDATE special_orders 
       SET payment_status = 'PAYMENT_CONFIRMED',
           status = 'In Live Cart',
           delivery_status = 'in_live_cart',
           pharmacy_verification_status = 'IN_LIVE_CART',
           pharmarack_distributor = ?,
           pharmarack_store_id = ?,
           pharmarack_product_id = ?,
           pharmarack_product_code = ?,
           pharmarack_rate = ?,
           pharmarack_mrp = ?,
           needs_live_cart_sync = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [dist.distributor_name, dist.store_id, dist.product_id, dist.product_code, dist.rate, dist.mrp, orderId]
    );

    const approvedOrder = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    expect(approvedOrder.payment_status).toBe('PAYMENT_CONFIRMED');
    expect(approvedOrder.status).toBe('In Live Cart');
    expect(approvedOrder.delivery_status).toBe('in_live_cart');
    expect(approvedOrder.pharmarack_distributor).toBe('Prime Pharma Distributors');
  });
});
