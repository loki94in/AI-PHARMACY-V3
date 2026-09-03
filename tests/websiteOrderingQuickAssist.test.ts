import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

describe('Website Ordering & Quick Assist Master Suite', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE stores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        generic_name TEXT,
        strength TEXT,
        packaging TEXT,
        manufacturer TEXT,
        category TEXT,
        mrp REAL,
        sell_price REAL
      );

      CREATE TABLE special_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        product TEXT,
        requester TEXT,
        phone TEXT,
        qty INTEGER DEFAULT 1,
        priority TEXT DEFAULT 'Normal',
        status TEXT DEFAULT 'Pending',
        notified INTEGER DEFAULT 0,
        advance_payment REAL DEFAULT 0.0,
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

      -- Seed sample store and medicines
      INSERT INTO stores (id, name, address, phone) VALUES (1, 'Central Pharmacy', '10 Market Road', '9876543210');
      INSERT INTO medicines (id, name, generic_name, strength, packaging, manufacturer, mrp, sell_price)
      VALUES 
        (1, 'TELMA 40MG TAB', 'TELMISARTAN', '40mg', '15 Tablets', 'Glenmark', 145.0, 130.0),
        (2, 'PAN 40MG TAB', 'PANTOPRAZOLE', '40mg', '15 Tablets', 'Alkem', 155.0, 140.0);
    `);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  describe('1. Store Data Standardizer & Fallback', () => {
    it('handles both wrapped { success, stores } and flat array data shapes correctly', () => {
      const wrappedPayload = { success: true, count: 1, stores: [{ id: 1, name: 'Main Store' }] };
      const flatPayload = [{ id: 1, name: 'Main Store' }];

      const unwrap = (data: any) => Array.isArray(data) ? data : (Array.isArray(data?.stores) ? data.stores : []);

      expect(unwrap(wrappedPayload)).toHaveLength(1);
      expect(unwrap(wrappedPayload)[0].name).toBe('Main Store');

      expect(unwrap(flatPayload)).toHaveLength(1);
      expect(unwrap(flatPayload)[0].name).toBe('Main Store');

      expect(unwrap(null)).toEqual([]);
      expect(unwrap({})).toEqual([]);
    });
  });

  describe('2. Website Order Placement (Pickup & Delivery)', () => {
    it('creates in-store pickup website order with customer_order_source = website', async () => {
      // 1. Create or get customer
      const custRes = await db.run(
        'INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)',
        ['RAHUL SHARMA', '9876543210', 'Website Customer']
      );
      const customerId = custRes.lastID;

      // 2. Insert order
      const notes = '[Website Order - In-Store Pickup - COUNTER_PICKUP] Notes: Call on arrival';
      const orderRes = await db.run(
        `INSERT INTO special_orders (
          store_id, customer_id, product, requester, phone, qty, priority, status, customer_order_source, delivery_status, notes
        ) VALUES (1, ?, 'TELMA 40MG TAB', 'RAHUL SHARMA', '9876543210', 2, 'Normal', 'Pending', 'website', 'counter_pickup', ?)`,
        [customerId, notes]
      );
      const orderId = orderRes.lastID;

      const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
      expect(order.customer_order_source).toBe('website');
      expect(order.delivery_status).toBe('counter_pickup');
      expect(order.status).toBe('Pending');
      expect(order.product).toBe('TELMA 40MG TAB');
      expect(order.qty).toBe(2);
      expect(order.notes).toContain('In-Store Pickup');
    });

    it('creates home delivery website order with delivery address in customer profile & notes', async () => {
      const deliveryAddress = 'Flat 402, Green Valley Apartments, MG Road';
      const custRes = await db.run(
        'INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)',
        ['PRIYA VERMA', '9123456780', deliveryAddress]
      );
      const customerId = custRes.lastID;

      const notes = `[Website Order - Home Delivery - COD] Delivery Address: ${deliveryAddress}. Notes: Leave with security`;
      const orderRes = await db.run(
        `INSERT INTO special_orders (
          store_id, customer_id, product, requester, phone, qty, priority, status, customer_order_source, delivery_status, notes
        ) VALUES (1, ?, 'PAN 40MG TAB', 'PRIYA VERMA', '9123456780', 1, 'Normal', 'Pending', 'website', 'pending_dispatch', ?)`,
        [customerId, notes]
      );
      const orderId = orderRes.lastID;

      const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
      expect(order.customer_order_source).toBe('website');
      expect(order.delivery_status).toBe('pending_dispatch');
      expect(order.notes).toContain('Home Delivery');
      expect(order.notes).toContain(deliveryAddress);

      // Verify customer address was recorded
      const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
      expect(customer.address).toBe(deliveryAddress);
    });
  });

  describe('3. Quick Assistant Partitioning & Distinction', () => {
    it('strictly partitions active website orders from local in-store special requests without cross-leakage', async () => {
      // Seed 1 website order
      await db.run(
        `INSERT INTO special_orders (store_id, product, requester, phone, qty, status, customer_order_source, notes)
         VALUES (1, 'TELMA 40MG TAB', 'Online User', '9991112222', 1, 'Pending', 'website', '[Website Order - In-Store Pickup - COUNTER_PICKUP]')`
      );

      // Seed 1 local in-store special request
      await db.run(
        `INSERT INTO special_orders (store_id, product, requester, phone, qty, status, customer_order_source, notes)
         VALUES (1, 'SPECIAL INJECTION 50MG', 'Walk-in Patient', '8882223333', 2, 'Pending', 'in_store', 'Walk-in requested advance paid')`
      );

      // Fetch all active orders
      const allOrders = await db.all(`SELECT * FROM special_orders WHERE status NOT IN ('Completed', 'Fulfilled', 'Cancelled')`);
      expect(allOrders).toHaveLength(2);

      // Partition logic matching QuickAssistSidebar implementation
      const isWebsiteOrder = (o: any) => {
        const src = o.customer_order_source || '';
        const notes = o.notes || '';
        return src === 'website' || src === 'website_refill' || notes.startsWith('[Website Order]') || notes.startsWith('[Refill Collection');
      };

      const activeWebsiteOrders = allOrders.filter(isWebsiteOrder);
      const activeLocalSpecialOrders = allOrders.filter(o => !isWebsiteOrder(o));

      expect(activeWebsiteOrders).toHaveLength(1);
      expect(activeWebsiteOrders[0].requester).toBe('Online User');
      expect(activeWebsiteOrders[0].product).toBe('TELMA 40MG TAB');

      expect(activeLocalSpecialOrders).toHaveLength(1);
      expect(activeLocalSpecialOrders[0].requester).toBe('Walk-in Patient');
      expect(activeLocalSpecialOrders[0].product).toBe('SPECIAL INJECTION 50MG');
    });

    it('returns website orders in quick assistant query', async () => {
      // Seed 2 website orders
      await db.run(
        `INSERT INTO special_orders (store_id, product, requester, phone, qty, status, customer_order_source, notes)
         VALUES (1, 'TELMA 40MG TAB', 'Online Cust 1', '9876543211', 1, 'Pending', 'website', '[Website Order - In-Store Pickup]')`
      );
      await db.run(
        `INSERT INTO special_orders (store_id, product, requester, phone, qty, status, customer_order_source, notes)
         VALUES (1, 'PAN 40MG TAB', 'Online Cust 2', '9876543212', 2, 'Pending', 'website_refill', '[Refill Collection - COUNTER_PICKUP]')`
      );

      // Query executed by GET /api/quick-assistant
      const websiteOrders = await db.all(
        `SELECT s.* FROM special_orders s
         WHERE (s.customer_order_source IN ('website', 'website_refill') OR s.notes LIKE '[Website Order%')
           AND s.status NOT IN ('Fulfilled', 'FULFILLED', 'Cancelled')
           AND s.store_id = 1
         ORDER BY s.id DESC`
      );

      expect(websiteOrders.length).toBeGreaterThanOrEqual(2);
      expect(websiteOrders.some(o => o.requester === 'Online Cust 1')).toBe(true);
      expect(websiteOrders.some(o => o.requester === 'Online Cust 2')).toBe(true);
    });
  });

  describe('4. Action Transitions (Mark Ready & POS Complete)', () => {
    it('marks website order as Ready with notification tracking', async () => {
      const res = await db.run(
        `INSERT INTO special_orders (store_id, product, requester, phone, qty, status, customer_order_source, notified)
         VALUES (1, 'TELMA 40MG TAB', 'Online Cust', '9876543210', 1, 'Pending', 'website', 0)`
      );
      const orderId = res.lastID;

      // Pharmacist clicks "Mark Ready" in Quick Assist
      await db.run(
        `UPDATE special_orders SET status = 'Ready', notified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [orderId]
      );

      const updated = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
      expect(updated.status).toBe('Ready');
      expect(updated.notified).toBe(1);
    });

    it('completes website order upon billing in POS and clears it from active queue', async () => {
      const res = await db.run(
        `INSERT INTO special_orders (store_id, product, requester, phone, qty, status, customer_order_source)
         VALUES (1, 'TELMA 40MG TAB', 'Online Cust', '9876543210', 1, 'Ready', 'website')`
      );
      const orderId = res.lastID;

      // Pharmacist clicks "Bill in POS" -> updates status to Completed
      await db.run(
        `UPDATE special_orders SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [orderId]
      );

      // Verify it is no longer in the active website orders queue
      const activeWebsiteOrders = await db.all(
        `SELECT s.* FROM special_orders s
         WHERE s.customer_order_source = 'website'
           AND s.status NOT IN ('Fulfilled', 'Completed', 'Cancelled')`
      );

      expect(activeWebsiteOrders.find(o => o.id === orderId)).toBeUndefined();
    });
  });
});
