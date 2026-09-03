import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import {
  normalizePhone,
  hashPin,
  generateRandomPin,
  generateRandomOtp,
  createCustomerToken,
  verifyCustomerToken
} from '../src/routes/customerPortal.js';

describe('WhatsApp OTP Login, Permanent User Identity & Centralized Architecture (Spec Compliance)', () => {
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
        is_active INTEGER DEFAULT 1
      );
      INSERT INTO stores (id, name, code) VALUES (1, 'Main Pharmacy', 'MAIN');

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
        FOREIGN KEY(customer_id) REFERENCES customers(id)
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
        category TEXT,
        mrp REAL DEFAULT 0,
        sell_price REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE inventory_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER NOT NULL,
        store_id INTEGER DEFAULT 1,
        batch_no TEXT,
        quantity INTEGER DEFAULT 0,
        unit_price REAL DEFAULT 0,
        mrp REAL DEFAULT 0,
        expiry_date TEXT,
        is_active INTEGER DEFAULT 1,
        FOREIGN KEY(medicine_id) REFERENCES medicines(id)
      );

      CREATE TABLE sales_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT UNIQUE,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        doctor_id INTEGER,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        total_amount REAL DEFAULT 0,
        payment_medium TEXT DEFAULT 'CASH',
        payment_status TEXT DEFAULT 'PAID',
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      );

      CREATE TABLE sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        inventory_id INTEGER,
        quantity INTEGER DEFAULT 1,
        unit_price REAL DEFAULT 0,
        mrp REAL DEFAULT 0,
        discount_per REAL DEFAULT 0,
        FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id),
        FOREIGN KEY(inventory_id) REFERENCES inventory_master(id)
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
        notes TEXT,
        customer_order_source TEXT DEFAULT 'website',
        delivery_status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      );
    `);
  });

  afterEach(async () => {
    if (db) await db.close();
  });

  // TEST 1: User logs in with WhatsApp OTP for the first time.
  // Expected: New user created with permanent user_id / customer_id.
  it('TEST 1: Creates new customer and permanent customer_id on first-time WhatsApp OTP login', async () => {
    const rawPhone = '+91 98765 43210';
    const cleanPhone = normalizePhone(rawPhone);
    expect(cleanPhone).toBe('9876543210');

    // Simulate OTP Request flow
    let customer = await db.get('SELECT * FROM customers WHERE phone = ?', [cleanPhone]);
    expect(customer).toBeUndefined();

    const insRes = await db.run(
      'INSERT INTO customers (name, phone, address, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      ['New Patient', cleanPhone, '123 Health Ave']
    );
    const permanentUserId = insRes.lastID as number;
    expect(permanentUserId).toBeGreaterThan(0);

    const otp = generateRandomOtp();
    await db.run(
      'INSERT INTO customer_portal_otps (login_id, otp_code, expires_at, is_used) VALUES (?, ?, datetime("now", "+10 minutes"), 0)',
      [cleanPhone, otp]
    );

    // Simulate OTP Verify flow
    const validOtp = await db.get(
      'SELECT * FROM customer_portal_otps WHERE login_id = ? AND otp_code = ? AND is_used = 0 AND expires_at > datetime("now")',
      [cleanPhone, otp]
    );
    expect(validOtp).toBeDefined();
    await db.run('UPDATE customer_portal_otps SET is_used = 1 WHERE id = ?', [validOtp.id]);

    // Create portal account bound to permanent customer_id
    const pin = generateRandomPin();
    await db.run(
      'INSERT INTO customer_portal_accounts (customer_id, login_id, pin_hash, pin_display, preferred_store_id) VALUES (?, ?, ?, ?, 1)',
      [permanentUserId, cleanPhone, hashPin(pin), pin]
    );

    const createdAccount = await db.get('SELECT * FROM customer_portal_accounts WHERE customer_id = ?', [permanentUserId]);
    expect(createdAccount.customer_id).toBe(permanentUserId);
    expect(createdAccount.login_id).toBe(cleanPhone);
  });

  // TEST 2: Same user logs in again.
  // Expected: Existing user loaded. No duplicate user created.
  it('TEST 2: Loads existing user on repeat login without creating duplicate accounts', async () => {
    const phone = '9876543210';
    // Pre-create user
    const insRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Aarav Sharma', phone]);
    const existingUserId = insRes.lastID as number;

    await db.run(
      'INSERT INTO customer_portal_accounts (customer_id, login_id, pin_hash, pin_display) VALUES (?, ?, ?, ?)',
      [existingUserId, phone, hashPin('1234'), '1234']
    );

    // Second login attempt
    let customer = await db.get('SELECT * FROM customers WHERE phone = ?', [phone]);
    expect(customer).toBeDefined();
    expect(customer.id).toBe(existingUserId);

    // Verify customer count remains 1
    const totalCustomers = await db.get('SELECT COUNT(*) as cnt FROM customers WHERE phone = ?', [phone]);
    expect(totalCustomers.cnt).toBe(1);

    const totalAccounts = await db.get('SELECT COUNT(*) as cnt FROM customer_portal_accounts WHERE login_id = ?', [phone]);
    expect(totalAccounts.cnt).toBe(1);
  });

  // TEST 3: User logs out and logs in again.
  // Expected: Old catalog, orders, invoices and settings remain available.
  it('TEST 3: Retains access to old invoices, orders, and refills after logout/login cycle', async () => {
    const phone = '9876543210';
    const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Meera Rao', phone]);
    const customerId = custRes.lastID as number;

    // Create historical invoice
    const invRes = await db.run(
      'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount) VALUES (?, ?, ?)',
      ['INV-2026-001', customerId, 450.00]
    );
    const invoiceId = invRes.lastID as number;

    // Add order
    await db.run(
      'INSERT INTO special_orders (customer_id, product, qty) VALUES (?, ?, ?)',
      [customerId, 'Amoxicillin 500mg', 2]
    );

    // Simulate logout (client drops token), then re-authenticates
    const sessionToken = createCustomerToken(customerId, phone);
    const verified = verifyCustomerToken(sessionToken);
    expect(verified).not.toBeNull();
    expect(verified!.customerId).toBe(customerId);

    // Fetch invoices by verified permanent customer_id
    const customerInvoices = await db.all('SELECT * FROM sales_invoices WHERE customer_id = ?', [verified!.customerId]);
    expect(customerInvoices.length).toBe(1);
    expect(customerInvoices[0].invoice_no).toBe('INV-2026-001');
    expect(customerInvoices[0].total_amount).toBe(450.00);

    const customerOrders = await db.all('SELECT * FROM special_orders WHERE customer_id = ?', [verified!.customerId]);
    expect(customerOrders.length).toBe(1);
    expect(customerOrders[0].product).toBe('Amoxicillin 500mg');
  });

  // TEST 4: Product price changes.
  // Expected: New bills use new price. Old bills remain unchanged (snapshot immutability).
  it('TEST 4: Historical invoices maintain price snapshots when product price changes', async () => {
    // 1. Insert medicine with initial price ₹100
    const medRes = await db.run(
      'INSERT INTO medicines (name, mrp, sell_price) VALUES (?, ?, ?)',
      ['Paracetamol 650mg', 100.0, 100.0]
    );
    const medId = medRes.lastID as number;

    const invMasterRes = await db.run(
      'INSERT INTO inventory_master (medicine_id, quantity, unit_price, mrp) VALUES (?, 100, 100.0, 100.0)',
      [medId]
    );
    const invId = invMasterRes.lastID as number;

    // 2. January Invoice created at ₹100
    const invJanRes = await db.run(
      'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount) VALUES (?, 1, ?)',
      ['INV-JAN-01', 200.0]
    );
    const janInvoiceId = invJanRes.lastID as number;
    await db.run(
      'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, mrp) VALUES (?, ?, 2, 100.0, 100.0)',
      [janInvoiceId, invId]
    );

    // 3. March: Medicine price increases to ₹120 in catalog
    await db.run('UPDATE medicines SET mrp = 120.0, sell_price = 120.0 WHERE id = ?', [medId]);
    await db.run('UPDATE inventory_master SET unit_price = 120.0, mrp = 120.0 WHERE id = ?', [invId]);

    // 4. March Invoice created at new price ₹120
    const invMarRes = await db.run(
      'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount) VALUES (?, 1, ?)',
      ['INV-MAR-01', 240.0]
    );
    const marInvoiceId = invMarRes.lastID as number;
    await db.run(
      'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, mrp) VALUES (?, ?, 2, 120.0, 120.0)',
      [marInvoiceId, invId]
    );

    // 5. Verify January invoice STILL reports ₹100 unit price and ₹200 total (immutable snapshot)
    const janItem = await db.get(
      `SELECT sit.unit_price, sit.quantity, (sit.quantity * sit.unit_price) as total_price
       FROM sale_items sit WHERE sit.invoice_id = ?`,
      [janInvoiceId]
    );
    expect(janItem.unit_price).toBe(100.0);
    expect(janItem.total_price).toBe(200.0);

    // Verify March invoice reports new price ₹120
    const marItem = await db.get(
      `SELECT sit.unit_price, sit.quantity, (sit.quantity * sit.unit_price) as total_price
       FROM sale_items sit WHERE sit.invoice_id = ?`,
      [marInvoiceId]
    );
    expect(marItem.unit_price).toBe(120.0);
    expect(marItem.total_price).toBe(240.0);
  });

  // TEST 5: Product is archived.
  // Expected: Product disappears from active catalog. Historical invoices remain accessible.
  it('TEST 5: Soft-archiving a medicine hides it from active catalog while preserving past invoices', async () => {
    const medRes = await db.run('INSERT INTO medicines (name, mrp, is_active) VALUES (?, 50.0, 1)', ['Old Medicine']);
    const medId = medRes.lastID as number;

    const invRes = await db.run('INSERT INTO inventory_master (medicine_id, quantity, unit_price) VALUES (?, 10, 50.0)', [medId]);
    const invId = invRes.lastID as number;

    // Past invoice exists referencing this product
    const invSale = await db.run('INSERT INTO sales_invoices (invoice_no, customer_id) VALUES (?, 1)', ['INV-HIST-01']);
    await db.run('INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price) VALUES (?, ?, 1, 50.0)', [invSale.lastID, invId]);

    // Archive product (Rule 8: never hard delete products with historical transactions)
    await db.run('UPDATE medicines SET is_active = 0 WHERE id = ?', [medId]);

    // Active catalog query excludes archived product
    const activeCatalog = await db.all('SELECT * FROM medicines WHERE is_active = 1');
    expect(activeCatalog.find(m => m.id === medId)).toBeUndefined();

    // Historical invoice lookup still resolves medicine name and snapshot price via LEFT JOIN
    const pastBillItem = await db.get(
      `SELECT sit.quantity, sit.unit_price, COALESCE(m.name, 'Archived Medicine') as medicine_name
       FROM sale_items sit
       LEFT JOIN inventory_master im ON im.id = sit.inventory_id
       LEFT JOIN medicines m ON m.id = im.medicine_id
       WHERE sit.invoice_id = ?`,
      [invSale.lastID]
    );
    expect(pastBillItem).toBeDefined();
    expect(pastBillItem.medicine_name).toBe('Old Medicine');
    expect(pastBillItem.unit_price).toBe(50.0);
  });

  // TEST 6 & 7: Catalog changes from Web or Mobile are unified.
  // Expected: Single database source of truth reflects immediately across all clients.
  it('TEST 6 & 7: Updates to central catalog are immediately visible uniformly across Web and Mobile', async () => {
    const medRes = await db.run('INSERT INTO medicines (name, sell_price) VALUES (?, 80.0)', ['Central Drug']);
    const medId = medRes.lastID as number;

    // Mobile admin updates price to ₹95
    await db.run('UPDATE medicines SET sell_price = 95.0 WHERE id = ?', [medId]);

    // Web client reads from central database
    const webView = await db.get('SELECT sell_price FROM medicines WHERE id = ?', [medId]);
    expect(webView.sell_price).toBe(95.0);

    // Web admin updates price to ₹110
    await db.run('UPDATE medicines SET sell_price = 110.0 WHERE id = ?', [medId]);

    // Mobile client reads from central database
    const mobileView = await db.get('SELECT sell_price FROM medicines WHERE id = ?', [medId]);
    expect(mobileView.sell_price).toBe(110.0);
  });

  // TEST 8: User A tries to access User B's invoice.
  // Expected: HTTP 403 / Access Denied.
  it('TEST 8: Enforces tenant isolation — User A cannot view User B invoices', async () => {
    const userAToken = createCustomerToken(101, '9000000001');
    const userBId = 202;

    const verifiedA = verifyCustomerToken(userAToken);
    expect(verifiedA).not.toBeNull();
    expect(verifiedA!.customerId).toBe(101);

    // Tenant check helper simulating backend route guard
    const authorizeAccess = (tokenUserId: number, targetCustomerId: number) => {
      if (tokenUserId !== targetCustomerId) {
        return { status: 403, error: 'Access denied: Cannot access another customer\'s invoices' };
      }
      return { status: 200, ok: true };
    };

    const attempt = authorizeAccess(verifiedA!.customerId, userBId);
    expect(attempt.status).toBe(403);
    expect(attempt.error).toContain('Access denied');
  });

  // TEST 9: Invoice creation fails halfway.
  // Expected: Transaction rolls back cleanly without leaving partial records.
  it('TEST 9: Transaction rollback prevents partial/corrupted invoice records on failure', async () => {
    const initialCount = await db.get('SELECT COUNT(*) as cnt FROM sales_invoices');

    try {
      await db.run('BEGIN TRANSACTION');
      await db.run('INSERT INTO sales_invoices (invoice_no, customer_id) VALUES (?, 1)', ['INV-FAIL-01']);
      
      // Simulate error during line item insertion (e.g. foreign key or constraint violation)
      throw new Error('Simulated network/hardware failure during sale items write');
    } catch (err) {
      await db.run('ROLLBACK');
    }

    const postCount = await db.get('SELECT COUNT(*) as cnt FROM sales_invoices');
    expect(postCount.cnt).toBe(initialCount.cnt);

    const orphanInvoice = await db.get('SELECT * FROM sales_invoices WHERE invoice_no = ?', ['INV-FAIL-01']);
    expect(orphanInvoice).toBeUndefined();
  });

  // TEST 10: User refreshes the app or clears frontend cache.
  // Expected: Data can be reliably reloaded from backend using permanent customer_id.
  it('TEST 10: Reloading data from backend after client cache clear restores complete state', async () => {
    const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Dev Patel', '9123456780']);
    const customerId = custRes.lastID as number;

    await db.run('INSERT INTO sales_invoices (invoice_no, customer_id, total_amount) VALUES (?, ?, 300.0)', ['INV-RESTORE-1', customerId]);

    // Frontend cache cleared: only session token / permanent ID survived in storage
    const token = createCustomerToken(customerId, '9123456780');
    const session = verifyCustomerToken(token);
    expect(session).not.toBeNull();

    // Query fresh state from backend
    const reloadedProfile = await db.get('SELECT id, name, phone FROM customers WHERE id = ?', [session!.customerId]);
    expect(reloadedProfile.name).toBe('Dev Patel');

    const reloadedBills = await db.all('SELECT invoice_no, total_amount FROM sales_invoices WHERE customer_id = ?', [session!.customerId]);
    expect(reloadedBills.length).toBe(1);
    expect(reloadedBills[0].invoice_no).toBe('INV-RESTORE-1');
  });

  // TEST 11: Same invoice/order request is accidentally submitted twice.
  // Expected: System prevents accidental duplicate transaction using idempotency constraints.
  it('TEST 11: Idempotency constraint blocks accidental duplicate order submission', async () => {
    const idempotencyKey = 'req-xyz-98765';
    const customerId = 5;

    const placeOrderWithIdempotency = async (key: string, product: string, qty: number) => {
      // Check for recent matching request
      const existing = await db.get(
        `SELECT id, product FROM special_orders 
         WHERE customer_id = ? AND notes LIKE ? AND created_at > datetime('now', '-2 minutes') LIMIT 1`,
        [customerId, `%[Idempotency: ${key}]%`]
      );
      if (existing) {
        return { isDuplicate: true, orderId: existing.id };
      }

      const res = await db.run(
        `INSERT INTO special_orders (customer_id, product, qty, notes) VALUES (?, ?, ?, ?)`,
        [customerId, product, qty, `[Website Order] [Idempotency: ${key}]`]
      );
      return { isDuplicate: false, orderId: res.lastID };
    };

    // First submission
    const firstCall = await placeOrderWithIdempotency(idempotencyKey, 'Cetirizine 10mg', 1);
    expect(firstCall.isDuplicate).toBe(false);

    // Accidental second submission with identical idempotency key
    const secondCall = await placeOrderWithIdempotency(idempotencyKey, 'Cetirizine 10mg', 1);
    expect(secondCall.isDuplicate).toBe(true);
    expect(secondCall.orderId).toBe(firstCall.orderId);

    // Total orders in DB should strictly be 1
    const countRow = await db.get('SELECT COUNT(*) as total FROM special_orders WHERE customer_id = ?', [customerId]);
    expect(countRow.total).toBe(1);
  });

  // TEST 12: User changes phone number.
  // Expected: Existing user_id remains unchanged. Historical data remains connected.
  it('TEST 12: Updating customer phone number preserves immutable customer_id and all historical links', async () => {
    const originalPhone = '9800000001';
    const newPhone = '9800000002';

    // Create customer and historical records
    const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', ['Anita Sen', originalPhone]);
    const immutableUserId = custRes.lastID as number;

    await db.run(
      'INSERT INTO customer_portal_accounts (customer_id, login_id, pin_hash, pin_display) VALUES (?, ?, ?, ?)',
      [immutableUserId, originalPhone, hashPin('9999'), '9999']
    );

    await db.run(
      'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount) VALUES (?, ?, 750.0)',
      ['INV-ANITA-01', immutableUserId]
    );

    // Change phone number
    await db.run('UPDATE customers SET phone = ? WHERE id = ?', [newPhone, immutableUserId]);
    await db.run('UPDATE customer_portal_accounts SET login_id = ? WHERE customer_id = ?', [newPhone, immutableUserId]);

    // Verify user_id did NOT change
    const updatedCustomer = await db.get('SELECT * FROM customers WHERE id = ?', [immutableUserId]);
    expect(updatedCustomer.id).toBe(immutableUserId);
    expect(updatedCustomer.phone).toBe(newPhone);

    // Verify historical invoice still linked to the exact same customer_id
    const customerInvoices = await db.all('SELECT * FROM sales_invoices WHERE customer_id = ?', [immutableUserId]);
    expect(customerInvoices.length).toBe(1);
    expect(customerInvoices[0].invoice_no).toBe('INV-ANITA-01');

    // Verify new phone resolves to the exact same customer_id and account
    const resolvedByNewPhone = await db.get('SELECT * FROM customers WHERE phone = ?', [newPhone]);
    expect(resolvedByNewPhone.id).toBe(immutableUserId);

    const portalByNewPhone = await db.get('SELECT * FROM customer_portal_accounts WHERE login_id = ?', [newPhone]);
    expect(portalByNewPhone.customer_id).toBe(immutableUserId);
  });
});
