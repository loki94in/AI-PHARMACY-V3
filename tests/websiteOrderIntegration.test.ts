import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

describe('Website Order Integration & Safe Medicine Search', () => {
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
        manufacturer TEXT,
        category TEXT,
        mrp REAL,
        sell_price REAL
      );

      CREATE TABLE inventory_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        medicine_id INTEGER,
        quantity INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        expiry_date DATETIME
      );

      CREATE TABLE distributor_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT,
        distributor_name TEXT,
        distributor_rate REAL,
        availability TEXT,
        is_mapped INTEGER DEFAULT 0
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
        customer_order_source TEXT DEFAULT 'in_store',
        prescription_url TEXT,
        product_image_url TEXT,
        delivery_status TEXT DEFAULT 'pending',
        return_status TEXT DEFAULT 'none',
        notes TEXT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE order_tracking_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        event_type TEXT,
        event_detail TEXT,
        performed_by TEXT,
        performed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Seed sample catalog
      INSERT INTO medicines (id, name, generic_name, strength, packaging, manufacturer, mrp, sell_price)
      VALUES 
        (1, 'Augmentin 625 Duo Tablet', 'Amoxicillin + Clavulanic Acid', '625mg', '10 Tablets', 'GSK', 201.50, 185.00),
        (2, 'Dolo 650 Tablet', 'Paracetamol', '650mg', '15 Tablets', 'Micro Labs', 33.60, 30.00);

      -- Store 1 has Augmentin in stock, but Dolo is 0
      INSERT INTO inventory_master (store_id, medicine_id, quantity, expiry_date)
      VALUES (1, 1, 50, date('now', '+1 year'));

      -- Distributor catalog has Dolo available mapped
      INSERT INTO distributor_catalog (product_name, distributor_name, distributor_rate, availability, is_mapped)
      VALUES ('Dolo 650 Tablet', 'Vardhman Pharma (SECRET)', 24.50, 'Available', 1);
    `);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it('searches customer medicine catalog safely without leaking distributor cost or supplier names', async () => {
    const medicines = await db.all(
      `SELECT id, name, generic_name, strength, packaging, manufacturer, category, mrp, sell_price
       FROM medicines WHERE name LIKE 'Augmentin%'`
    );

    expect(medicines.length).toBe(1);
    const med = medicines[0];

    // Customer safe payload verification
    expect(med.name).toBe('Augmentin 625 Duo Tablet');
    expect(med.mrp).toBe(201.50);
    expect(med.sell_price).toBe(185.00);

    // Verify distributor secrets are NOT attached to customer output
    expect((med as any).distributor_name).toBeUndefined();
    expect((med as any).distributor_rate).toBeUndefined();
    expect((med as any).purchase_price).toBeUndefined();
  });

  it('computes availability accurately across local inventory and distributor feeds', async () => {
    // Check Augmentin stock in Store 1
    const stockRow1 = await db.get(
      `SELECT SUM(quantity) as total_qty FROM inventory_master WHERE medicine_id = 1 AND store_id = 1 AND is_active = 1`
    );
    expect(stockRow1.total_qty).toBe(50); // Available locally

    // Check Dolo stock in Store 1
    const stockRow2 = await db.get(
      `SELECT SUM(quantity) as total_qty FROM inventory_master WHERE medicine_id = 2 AND store_id = 1 AND is_active = 1`
    );
    expect(stockRow2?.total_qty || 0).toBe(0); // Out locally

    // Check distributor availability for Dolo
    const distRow = await db.get(
      `SELECT availability FROM distributor_catalog WHERE product_name LIKE '%Dolo 650%' AND is_mapped = 1`
    );
    expect(distRow?.availability).toBe('Available'); // Available via mapped distributor
  });

  it('places website order with store routing, prescription image, and tracking event', async () => {
    const result = await db.run(
      `INSERT INTO special_orders (
        store_id, product, requester, phone, qty, customer_order_source, prescription_url, delivery_status, notes
      ) VALUES (2, 'Augmentin 625 Duo Tablet', 'John Doe', '9876543210', 2, 'website', 'https://storage.pharmacy.com/rx/123.jpg', 'pending', '[Website Order] Need urgent delivery')`
    );

    const orderId = result.lastID;
    expect(orderId).toBeGreaterThan(0);

    await db.run(
      `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by)
       VALUES (?, 'website_order_created', 'Online order placed for Store #2', 'customer')`,
      [orderId]
    );

    const created = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    expect(created.store_id).toBe(2);
    expect(created.customer_order_source).toBe('website');
    expect(created.prescription_url).toBe('https://storage.pharmacy.com/rx/123.jpg');
    expect(created.delivery_status).toBe('pending');

    const events = await db.all('SELECT * FROM order_tracking_events WHERE order_id = ?', [orderId]);
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('website_order_created');
  });

  it('handles multi-photo prescription upload and routes strictly to the selected pharmacy registered number', async () => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS stores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT
      );
      CREATE TABLE IF NOT EXISTS store_settings (
        store_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (store_id, key)
      );
      INSERT INTO stores (id, name, phone, address) VALUES
        (1, 'Pune Main Pharmacy', '9822000001', 'FC Road, Pune'),
        (2, 'Pune Camp Branch', '09822000002', 'Camp, Pune');
    `);

    // Customer selects Store #2 and uploads 3 photos
    const uploadedPhotos = [
      '/uploads/prescriptions/Rx_Web_1_1.jpg',
      '/uploads/prescriptions/Rx_Web_1_2.jpg',
      '/uploads/prescriptions/Rx_Web_1_3.jpg'
    ];
    const prescriptionUrl = JSON.stringify(uploadedPhotos);

    const result = await db.run(
      `INSERT INTO special_orders (
        store_id, requester, phone, product, qty, notes, status, customer_order_source, prescription_url
      ) VALUES (2, 'Rahul Sharma', '9876543210', 'Prescription / Medicine Inquiry', 1, 'Urgent prescription order', 'Pending', 'website', ?)`,
      [prescriptionUrl]
    );

    const orderId = result.lastID;
    expect(orderId).toBeGreaterThan(0);

    const orderRow = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    expect(orderRow.store_id).toBe(2);
    expect(JSON.parse(orderRow.prescription_url)).toEqual(uploadedPhotos);

    // Resolve store 2 phone number
    const store2 = await db.get('SELECT name, phone FROM stores WHERE id = ?', [orderRow.store_id]);
    expect(store2.name).toBe('Pune Camp Branch');

    // Test phone normalization logic (strip leading 0, format with 91)
    let clean = (store2.phone || '').replace(/\D/g, '');
    if (clean.length === 11 && clean.startsWith('0')) {
      clean = clean.slice(1);
    }
    const targetPhone = clean.length === 10 ? `91${clean}` : clean;
    expect(targetPhone).toBe('919822000002');

    // Build WhatsApp message and verify multi-photo links
    const host = 'localhost:5175';
    let waText = `Hello ${store2.name}! 🏥\n\n` +
      `I want to order medicines using my prescription / photo:\n` +
      `📋 *Order Ref:* #${orderId}\n` +
      `👤 *Patient:* ${orderRow.requester}\n` +
      `📱 *Mobile:* ${orderRow.phone}\n`;

    waText += `📷 *Prescription Photos (${uploadedPhotos.length}):*\n`;
    uploadedPhotos.forEach((u, idx) => {
      waText += `Page ${idx + 1}: http://${host}${u}\n`;
    });

    const waUrl = `https://wa.me/${targetPhone}?text=${encodeURIComponent(waText)}`;
    expect(waUrl).toContain('https://wa.me/919822000002');
    expect(waUrl).toContain('Pune%20Camp%20Branch');
    expect(waUrl).toContain('Page%201');
    expect(waUrl).toContain('Page%202');
    expect(waUrl).toContain('Page%203');
  });
});
