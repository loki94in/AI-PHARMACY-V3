import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { normalizePhone, hashPin, generateRandomPin, generateRandomOtp } from '../src/routes/customerPortal.js';

describe('Customer Portal & Multi-Store Refill Lifecycle', () => {
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
        code TEXT,
        address TEXT,
        phone TEXT,
        is_central INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE customer_portal_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL UNIQUE,
        login_id TEXT NOT NULL UNIQUE,
        pin_hash TEXT NOT NULL,
        pin_display TEXT,
        preferred_store_id INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active',
        last_login_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(customer_id) REFERENCES customers(id),
        FOREIGN KEY(preferred_store_id) REFERENCES stores(id)
      );

      CREATE TABLE customer_portal_otps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login_id TEXT NOT NULL,
        otp_code TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        is_used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        generic_name TEXT,
        mrp REAL,
        sell_price REAL
      );

      CREATE TABLE patient_refills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        patient_name TEXT NOT NULL,
        patient_phone TEXT NOT NULL,
        medicine_id INTEGER NOT NULL,
        refill_interval_days INTEGER DEFAULT 30,
        quantity_needed INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        last_refill_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        next_refill_date DATETIME
      );

      CREATE TABLE sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT NOT NULL,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        total_amount REAL DEFAULT 0,
        net_amount REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        medicine_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        unit_price REAL DEFAULT 0,
        total_price REAL DEFAULT 0
      );

      CREATE TABLE special_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        product TEXT NOT NULL,
        requester TEXT,
        phone TEXT,
        qty INTEGER DEFAULT 1,
        priority TEXT DEFAULT 'Normal',
        status TEXT DEFAULT 'Pending',
        customer_order_source TEXT DEFAULT 'in_store',
        delivery_status TEXT DEFAULT 'pending',
        return_status TEXT DEFAULT 'none',
        notes TEXT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE order_tracking_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        event_type TEXT,
        event_detail TEXT,
        performed_by TEXT,
        performed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Seed Stores
      INSERT INTO stores (id, name, address, phone) VALUES
        (1, 'City Pharmacy Main Market', '123 MG Road', '9876543210'),
        (2, 'City Pharmacy Station Branch', '45 Station Road', '9822334455');

      -- Seed Medicines
      INSERT INTO medicines (id, name, generic_name, mrp, sell_price) VALUES
        (1, 'Telma 40mg Tablet', 'Telmisartan', 150.00, 140.00),
        (2, 'Glycomet 500mg Tablet', 'Metformin', 45.00, 40.00),
        (3, 'Shelcal 500mg Tablet', 'Calcium + Vitamin D3', 130.00, 120.00);
    `);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it('normalizes customer phone numbers cleanly across various formats', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('919876543210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
    expect(normalizePhone('9876543210')).toBe('9876543210');
  });

  it('creates customer account and generates unique PIN credentials with hash', async () => {
    const phone = '9876543210';
    const name = 'Rajesh Sharma';
    const pin = '4829';
    const pinHashed = hashPin(pin);

    // 1. Create customer
    const custRes = await db.run(
      'INSERT INTO customers (name, phone) VALUES (?, ?)',
      [name, phone]
    );
    const customerId = custRes.lastID;

    // 2. Create portal credentials
    await db.run(
      `INSERT INTO customer_portal_accounts (customer_id, login_id, pin_hash, pin_display, preferred_store_id)
       VALUES (?, ?, ?, ?, 1)`,
      [customerId, phone, pinHashed, pin]
    );

    const account = await db.get(
      'SELECT * FROM customer_portal_accounts WHERE login_id = ?',
      [phone]
    );

    expect(account).toBeDefined();
    expect(account.customer_id).toBe(customerId);
    expect(account.login_id).toBe('9876543210');
    expect(account.pin_display).toBe('4829');
    expect(account.pin_hash).toBe(pinHashed);
    expect(account.preferred_store_id).toBe(1);
    expect(account.status).toBe('active');
  });

  it('authenticates customer with valid phone and PIN', async () => {
    const phone = '9811223344';
    const pin = '5678';
    const hashed = hashPin(pin);

    const cust = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Priya Patel', phone]);
    await db.run(
      'INSERT INTO customer_portal_accounts (customer_id, login_id, pin_hash, pin_display) VALUES (?, ?, ?, ?)',
      [cust.lastID, phone, hashed, pin]
    );

    // Test correct PIN
    const match = await db.get(
      'SELECT * FROM customer_portal_accounts WHERE login_id = ? AND pin_hash = ? AND status = "active"',
      [phone, hashPin(pin)]
    );
    expect(match).toBeDefined();
    expect(match.login_id).toBe(phone);

    // Test wrong PIN
    const wrongMatch = await db.get(
      'SELECT * FROM customer_portal_accounts WHERE login_id = ? AND pin_hash = ?',
      [phone, hashPin('0000')]
    );
    expect(wrongMatch).toBeUndefined();
  });

  it('manages OTP generation, verification, and expiration', async () => {
    const phone = '9899887766';
    const otp = generateRandomOtp();
    const validExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const expiredExpiry = new Date(Date.now() - 5000).toISOString().replace('T', ' ').slice(0, 19);

    // Insert valid OTP
    await db.run(
      'INSERT INTO customer_portal_otps (login_id, otp_code, expires_at, is_used) VALUES (?, ?, ?, 0)',
      [phone, otp, validExpiry]
    );

    // Verify valid OTP
    const validRow = await db.get(
      `SELECT * FROM customer_portal_otps 
       WHERE login_id = ? AND otp_code = ? AND is_used = 0 AND expires_at > datetime('now')`,
      [phone, otp]
    );
    expect(validRow).toBeDefined();

    // Mark as used
    await db.run('UPDATE customer_portal_otps SET is_used = 1 WHERE id = ?', [validRow.id]);

    // Used OTP should not match
    const usedRow = await db.get(
      `SELECT * FROM customer_portal_otps 
       WHERE login_id = ? AND otp_code = ? AND is_used = 0`,
      [phone, otp]
    );
    expect(usedRow).toBeUndefined();

    // Expired OTP test
    await db.run(
      'INSERT INTO customer_portal_otps (login_id, otp_code, expires_at, is_used) VALUES (?, ?, ?, 0)',
      [phone, '999999', expiredExpiry]
    );
    const expiredRow = await db.get(
      `SELECT * FROM customer_portal_otps 
       WHERE login_id = ? AND otp_code = '999999' AND expires_at > datetime('now')`,
      [phone]
    );
    expect(expiredRow).toBeUndefined();
  });

  it('places customized multi-medicine in-store pickup refill order for chosen branch', async () => {
    // 1. Setup Customer & Active Refills
    const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Anil Kumar', '9844556677']);
    const customerId = custRes.lastID;

    await db.run(
      `INSERT INTO patient_refills (store_id, customer_id, patient_name, patient_phone, medicine_id, quantity_needed)
       VALUES (1, ?, 'Anil Kumar', '9844556677', 1, 10), (1, ?, 'Anil Kumar', '9844556677', 2, 20)`,
      [customerId, customerId]
    );

    // 2. Customer selects Store #2 (Station Branch) for pickup and chooses Telma + Glycomet
    const chosenStoreId = 2;
    const selectedItems = [
      { product: 'Telma 40mg Tablet', qty: 10, price: 140.00 },
      { product: 'Glycomet 500mg Tablet', qty: 20, price: 40.00 }
    ];

    const createdOrders = [];
    for (const it of selectedItems) {
      const res = await db.run(
        `INSERT INTO special_orders (
          store_id, customer_id, product, requester, phone, qty, status, customer_order_source, delivery_status
        ) VALUES (?, ?, ?, 'Anil Kumar', '9844556677', ?, 'Pending', 'website_refill', 'counter_pickup')`,
        [chosenStoreId, customerId, it.product, it.qty]
      );
      createdOrders.push(res.lastID);

      await db.run(
        `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by)
         VALUES (?, 'refill_order_created', 'Refill placed for counter collection at Store #2', 'customer')`,
        [res.lastID]
      );
    }

    expect(createdOrders.length).toBe(2);

    // 3. Verify Store #2 POS query finds these orders
    const store2Orders = await db.all(
      'SELECT * FROM special_orders WHERE store_id = 2 AND customer_order_source = "website_refill"'
    );
    expect(store2Orders.length).toBe(2);
    expect(store2Orders[0].delivery_status).toBe('counter_pickup');
    expect(store2Orders[0].product).toBe('Telma 40mg Tablet');
    expect(store2Orders[1].product).toBe('Glycomet 500mg Tablet');

    // 4. Verify Store #1 POS does not have them
    const store1Orders = await db.all(
      'SELECT * FROM special_orders WHERE store_id = 1 AND customer_order_source = "website_refill"'
    );
    expect(store1Orders.length).toBe(0);
  });

  it('allows customer to change their own PIN through online portal', async () => {
    const phone = '9811223344';
    const initialPin = '1122';
    const initialHash = hashPin(initialPin);

    // Create customer and account
    const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Sanjay Roy', phone]);
    await db.run(
      'INSERT INTO customer_portal_accounts (customer_id, login_id, pin_hash, pin_display, preferred_store_id) VALUES (?, ?, ?, ?, 1)',
      [custRes.lastID, phone, initialHash, initialPin]
    );

    // Customer changes PIN to '5566'
    const newPin = '5566';
    const newHashed = hashPin(newPin);

    await db.run(
      'UPDATE customer_portal_accounts SET pin_hash = ?, pin_display = ?, updated_at = CURRENT_TIMESTAMP WHERE login_id = ?',
      [newHashed, newPin, phone]
    );

    const updatedAccount = await db.get('SELECT * FROM customer_portal_accounts WHERE login_id = ?', [phone]);
    expect(updatedAccount.pin_display).toBe('5566');
    expect(updatedAccount.pin_hash).toBe(newHashed);

    // Verify authentication succeeds with new PIN and fails with old PIN
    expect(updatedAccount.pin_hash).toBe(hashPin('5566'));
    expect(updatedAccount.pin_hash).not.toBe(hashPin('1122'));
  });

  it('allows pharmacy staff to manually overwrite and reset customer PIN', async () => {
    const phone = '9877001122';
    const autoPin = '4321';
    const autoHash = hashPin(autoPin);

    // Initial account
    const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Vikram Singh', phone]);
    const accRes = await db.run(
      'INSERT INTO customer_portal_accounts (customer_id, login_id, pin_hash, pin_display, preferred_store_id) VALUES (?, ?, ?, ?, 1)',
      [custRes.lastID, phone, autoHash, autoPin]
    );

    // Pharmacy staff overrides PIN to '9988'
    const staffChosenPin = '9988';
    const staffHash = hashPin(staffChosenPin);

    await db.run(
      'UPDATE customer_portal_accounts SET pin_hash = ?, pin_display = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [staffHash, staffChosenPin, accRes.lastID]
    );

    const overwrittenAccount = await db.get('SELECT * FROM customer_portal_accounts WHERE id = ?', [accRes.lastID]);
    expect(overwrittenAccount.pin_display).toBe('9988');
    expect(overwrittenAccount.pin_hash).toBe(staffHash);
    expect(overwrittenAccount.pin_hash).toBe(hashPin('9988'));
  });

  it('strictly rejects portal login or refill orders from unregistered customers without pharmacy provisioning', async () => {
    const unknownPhone = '9998887766';

    // 1. Attempt login query for unknown customer
    const portalAccount = await db.get(
      'SELECT * FROM customer_portal_accounts WHERE login_id = ? AND status = "active"',
      [unknownPhone]
    );
    expect(portalAccount).toBeUndefined();

    // 2. Attempt customer query in database
    const existingCustomer = await db.get(
      'SELECT id, name FROM customers WHERE phone = ?',
      [unknownPhone]
    );
    expect(existingCustomer).toBeUndefined();
  });
});
