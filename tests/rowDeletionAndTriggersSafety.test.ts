import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

describe('Row Deletions, Triggers & Cascades Safety E2E Test Suite', () => {
  let db: any;
  const testDbPath = path.join(process.cwd(), 'data', 'test_delete_triggers_safety.db');

  beforeAll(() => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (_) {}
    }
    db = new Database(testDbPath);
    db.pragma('foreign_keys = ON');

    // Build complete relational test schema with all triggers
    db.exec(`
      CREATE TABLE IF NOT EXISTS medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        total_stock REAL DEFAULT 0,
        total_loose_stock REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS medicines_fts USING fts5(
        name,
        content='medicines',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS medicines_ai AFTER INSERT ON medicines BEGIN
        INSERT INTO medicines_fts(rowid, name) VALUES (new.id, new.name);
      END;

      CREATE TRIGGER IF NOT EXISTS medicines_ad AFTER DELETE ON medicines BEGIN
        INSERT INTO medicines_fts(medicines_fts, rowid, name) VALUES('delete', old.id, old.name);
      END;

      CREATE TABLE IF NOT EXISTS inventory_master (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
        batch_no TEXT NOT NULL,
        quantity REAL DEFAULT 0,
        loose_quantity REAL DEFAULT 0
      );

      CREATE TRIGGER IF NOT EXISTS trg_inventory_stock_ins AFTER INSERT ON inventory_master BEGIN
        UPDATE medicines SET 
          total_stock = (SELECT COALESCE(SUM(quantity), 0) FROM inventory_master WHERE medicine_id = NEW.medicine_id),
          total_loose_stock = (SELECT COALESCE(SUM(loose_quantity), 0) FROM inventory_master WHERE medicine_id = NEW.medicine_id)
        WHERE id = NEW.medicine_id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_inventory_stock_del AFTER DELETE ON inventory_master WHEN OLD.medicine_id IS NOT NULL BEGIN
        UPDATE medicines SET 
          total_stock = (SELECT COALESCE(SUM(quantity), 0) FROM inventory_master WHERE medicine_id = OLD.medicine_id),
          total_loose_stock = (SELECT COALESCE(SUM(loose_quantity), 0) FROM inventory_master WHERE medicine_id = OLD.medicine_id)
        WHERE id = OLD.medicine_id;
      END;

      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        language TEXT DEFAULT 'mr'
      );

      CREATE TABLE IF NOT EXISTS customer_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        token TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS special_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medicine_name TEXT NOT NULL,
        requester TEXT,
        phone TEXT,
        qty INTEGER DEFAULT 1,
        status TEXT DEFAULT 'Pending'
      );

      CREATE TABLE IF NOT EXISTS distributors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT
      );
    `);
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (_) {}
    }
  });

  describe('1. Inventory Row Deletion & Stock Recalculation Trigger', () => {
    it('accurately updates medicine total_stock when an inventory batch row is deleted', () => {
      // 1. Insert medicine
      const medInfo = db.prepare('INSERT INTO medicines (name) VALUES (?)').run('Augmentin 625 Duo');
      const medId = medInfo.lastInsertRowid;

      // 2. Insert 2 inventory batches (10 + 15 = 25)
      db.prepare('INSERT INTO inventory_master (medicine_id, batch_no, quantity) VALUES (?, ?, ?)').run(medId, 'BATCH-A', 10);
      const b2 = db.prepare('INSERT INTO inventory_master (medicine_id, batch_no, quantity) VALUES (?, ?, ?)').run(medId, 'BATCH-B', 15);

      let med = db.prepare('SELECT total_stock FROM medicines WHERE id = ?').get(medId);
      expect(med.total_stock).toBe(25);

      // 3. Delete BATCH-B (15 units)
      db.prepare('DELETE FROM inventory_master WHERE id = ?').run(b2.lastInsertRowid);

      // 4. Trigger trg_inventory_stock_del must automatically recalculate stock to 10
      med = db.prepare('SELECT total_stock FROM medicines WHERE id = ?').get(medId);
      expect(med.total_stock).toBe(10);
    });
  });

  describe('2. Medicine Row Deletion & Full-Text Search (FTS) Trigger', () => {
    it('safely deletes medicine and cleans FTS index via medicines_ad trigger', () => {
      const medInfo = db.prepare('INSERT INTO medicines (name) VALUES (?)').run('Dolo 650mg Tablet');
      const medId = medInfo.lastInsertRowid;

      // Verify FTS search finds it
      let search = db.prepare('SELECT rowid FROM medicines_fts WHERE medicines_fts MATCH ?').all('Dolo*');
      expect(search.some((s: any) => s.rowid === Number(medId))).toBe(true);

      // Delete the medicine
      db.prepare('DELETE FROM medicines WHERE id = ?').run(medId);

      // Verify FTS index trigger cleaned up without throwing error
      search = db.prepare('SELECT rowid FROM medicines_fts WHERE medicines_fts MATCH ?').all('Dolo*');
      expect(search.some((s: any) => s.rowid === Number(medId))).toBe(false);
    });
  });

  describe('3. Customer Row Deletion & Cascade Clean', () => {
    it('deletes customer and cascades to customer_sessions without orphaned tokens', () => {
      const custInfo = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('Anil Shinde', '9890012345');
      const custId = custInfo.lastInsertRowid;

      db.prepare('INSERT INTO customer_sessions (customer_id, token) VALUES (?, ?)').run(custId, 'sess-token-xyz');

      let session = db.prepare('SELECT * FROM customer_sessions WHERE customer_id = ?').get(custId);
      expect(session).not.toBeUndefined();

      // Delete customer
      db.prepare('DELETE FROM customers WHERE id = ?').run(custId);

      // Cascade must delete session
      session = db.prepare('SELECT * FROM customer_sessions WHERE customer_id = ?').get(custId);
      expect(session).toBeUndefined();
    });
  });

  describe('4. Special Order & Distributor Row Deletion', () => {
    it('deletes special order row with medicine_name without any column errors', () => {
      const ordInfo = db.prepare('INSERT INTO special_orders (medicine_name, requester, phone) VALUES (?, ?, ?)').run(
        'Glycomet GP 1', 'Vijay Kumar', '9822011223'
      );
      expect(ordInfo.lastInsertRowid).toBeGreaterThan(0);

      const del = db.prepare('DELETE FROM special_orders WHERE id = ?').run(ordInfo.lastInsertRowid);
      expect(del.changes).toBe(1);

      const check = db.prepare('SELECT * FROM special_orders WHERE id = ?').get(ordInfo.lastInsertRowid);
      expect(check).toBeUndefined();
    });

    it('deletes distributor row with phone cleanly', () => {
      const distInfo = db.prepare('INSERT INTO distributors (name, phone) VALUES (?, ?)').run(
        'Suraj Medico', '9823000000'
      );
      const del = db.prepare('DELETE FROM distributors WHERE id = ?').run(distInfo.lastInsertRowid);
      expect(del.changes).toBe(1);

      const check = db.prepare('SELECT * FROM distributors WHERE id = ?').get(distInfo.lastInsertRowid);
      expect(check).toBeUndefined();
    });
  });
});

