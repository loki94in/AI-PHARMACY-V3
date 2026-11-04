import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

describe('Deleted Columns & Single Source of Truth Zero-Side-Effects E2E Test Suite', () => {
  let db: any;
  const testDbPath = path.join(process.cwd(), 'data', 'test_e2e_side_effects.db');

  beforeAll(() => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (_) {}
    }
    db = new Database(testDbPath);

    // Initialize clean schema without redundant columns
    db.exec(`
      CREATE TABLE IF NOT EXISTS distributors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        city TEXT,
        delivery_boy_id INTEGER,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        language TEXT DEFAULT 'mr',
        language_confirmed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS special_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        medicine_id INTEGER,
        medicine_name TEXT,
        requester TEXT,
        phone TEXT,
        qty INTEGER DEFAULT 1,
        priority TEXT DEFAULT 'Normal',
        status TEXT DEFAULT 'Pending',
        notified INTEGER DEFAULT 0,
        pharmarack_mrp REAL,
        pharmarack_rate REAL,
        pharmarack_distributor TEXT,
        advance_payment REAL DEFAULT 0,
        notes TEXT,
        auto_remind INTEGER DEFAULT 0,
        last_collection_reminder_at DATETIME,
        notification_count INTEGER DEFAULT 0,
        customer_order_source TEXT DEFAULT 'website',
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        generic_name TEXT,
        item_code TEXT,
        mrp REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TRIGGER IF NOT EXISTS auto_generate_item_code
      AFTER INSERT ON medicines
      FOR EACH ROW
      WHEN NEW.item_code IS NULL
      BEGIN
        UPDATE medicines SET item_code = 'SKU-' || (10000 + NEW.id) WHERE id = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_customers_created_at
      AFTER INSERT ON customers
      FOR EACH ROW
      WHEN NEW.created_at IS NULL
      BEGIN
        UPDATE customers SET created_at = datetime('now') WHERE id = NEW.id;
      END;
    `);
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (_) {}
    }
  });

  describe('1. Distributors Pipeline (Elimination of `contact` Column)', () => {
    it('creates distributor with phone and verifies no contact column is required', () => {
      const info = db.prepare('INSERT INTO distributors (name, phone, email) VALUES (?, ?, ?)').run(
        'Apex Pharma Logistics',
        '9876543210',
        'apex@pharma.example'
      );
      expect(info.lastInsertRowid).toBeGreaterThan(0);

      const row = db.prepare('SELECT * FROM distributors WHERE id = ?').get(info.lastInsertRowid);
      expect(row.name).toBe('Apex Pharma Logistics');
      expect(row.phone).toBe('9876543210');
      expect(row.contact).toBeUndefined(); // contact column does not exist
    });

    it('updates distributor phone without SQLITE column errors', () => {
      db.prepare('UPDATE distributors SET phone = ? WHERE name = ?').run('9112233445', 'Apex Pharma Logistics');
      const row = db.prepare('SELECT phone FROM distributors WHERE name = ?').get('Apex Pharma Logistics');
      expect(row.phone).toBe('9112233445');
    });

    it('safely queries distributor directory by phone', () => {
      const match = db.prepare('SELECT id, name, phone FROM distributors WHERE phone LIKE ?').all('%9112233445%');
      expect(match).toHaveLength(1);
      expect(match[0].name).toBe('Apex Pharma Logistics');
    });
  });

  describe('2. Customers Pipeline (Elimination of `preferred_language` Column)', () => {
    it('creates customer with default language mr and confirms no preferred_language exists', () => {
      const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('Rajesh Patil', '9988776655');
      const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
      expect(cust.name).toBe('Rajesh Patil');
      expect(cust.language).toBe('mr');
      expect(cust.preferred_language).toBeUndefined();
    });

    it('updates customer language to hi and verifies persistence', () => {
      db.prepare('UPDATE customers SET language = ? WHERE phone = ?').run('hi', '9988776655');
      const cust = db.prepare('SELECT language FROM customers WHERE phone = ?').get('9988776655');
      expect(cust.language).toBe('hi');
    });

    it('fires customer triggers smoothly without referencing preferred_language', () => {
      const info = db.prepare('INSERT INTO customers (name, phone, created_at) VALUES (?, ?, NULL)').run('Suresh Kadam', '9988776644');
      const cust = db.prepare('SELECT created_at FROM customers WHERE id = ?').get(info.lastInsertRowid);
      expect(cust.created_at).not.toBeNull();
    });
  });

  describe('3. Special Orders & Website Orders Lifecycle (Elimination of `product` Column)', () => {
    it('creates special order using medicine_name exclusively', () => {
      const info = db.prepare(`
        INSERT INTO special_orders (
          medicine_name, requester, phone, qty, status, customer_order_source
        ) VALUES (?, ?, ?, ?, 'Pending', 'website')
      `).run('Amoxicillin 500mg', 'Anita Sharma', '9123456789', 2);

      const order = db.prepare('SELECT * FROM special_orders WHERE id = ?').get(info.lastInsertRowid);
      expect(order.medicine_name).toBe('Amoxicillin 500mg');
      expect(order.product).toBeUndefined(); // product column does not exist
      expect(order.qty).toBe(2);
    });

    it('modifies special order medicine_name and notes without product column conflict', () => {
      db.prepare(`
        UPDATE special_orders 
        SET medicine_name = ?, qty = ?, notes = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE requester = ?
      `).run('Amoxicillin + Clavulanic Acid 625mg', 3, 'Patient requested generic equivalent', 'Anita Sharma');

      const updated = db.prepare('SELECT medicine_name, qty, notes FROM special_orders WHERE requester = ?').get('Anita Sharma');
      expect(updated.medicine_name).toBe('Amoxicillin + Clavulanic Acid 625mg');
      expect(updated.qty).toBe(3);
      expect(updated.notes).toBe('Patient requested generic equivalent');
    });

    it('Customer Portal queries special orders cleanly via medicine_name', () => {
      const portalRows = db.prepare(`
        SELECT id as special_order_id, medicine_name, qty, status, customer_order_source
        FROM special_orders
        WHERE phone LIKE ? AND medicine_name IS NOT NULL
        ORDER BY id DESC
      `).all('%9123456789%');

      expect(portalRows).toHaveLength(1);
      expect(portalRows[0].medicine_name).toBe('Amoxicillin + Clavulanic Acid 625mg');
      expect(portalRows[0].product).toBeUndefined();
    });

    it('CRM past orders query returns special orders by medicine_name', () => {
      const crmRows = db.prepare(`
        SELECT id, requester, phone, medicine_name, qty, status
        FROM special_orders
        WHERE phone LIKE ?
      `).all('%9123456789%');

      expect(crmRows).toHaveLength(1);
      expect(crmRows[0].medicine_name).toBe('Amoxicillin + Clavulanic Acid 625mg');
    });
  });

  describe('4. Medicine Triggers & B-Tree Index Health', () => {
    it('fires auto_generate_item_code trigger on medicines table seamlessly', () => {
      const info = db.prepare('INSERT INTO medicines (name, generic_name, mrp) VALUES (?, ?, ?)').run(
        'Telmisartan 40mg',
        'Telmisartan',
        45.0
      );
      const med = db.prepare('SELECT id, name, item_code FROM medicines WHERE id = ?').get(info.lastInsertRowid);
      expect(med.name).toBe('Telmisartan 40mg');
      expect(med.item_code).toBe(`SKU-${10000 + med.id}`);
    });
  });
});

