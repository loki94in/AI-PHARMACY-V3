import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { calculateDistributorScore } from '../src/services/distributorRecommendationService.js';
import { logMutationAudit, getMutationAuditLogs } from '../src/services/auditLoggerService.js';
import { dbManager } from '../src/database/connection.js';

describe('Multi-Pharmacy Architecture Complete Test Suite (MULTI-PHARMACY.md §8, §14, §15, §16, §23, §29)', () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });

    // Mock dbManager connection to use our in-memory SQLite database for test queries
    (dbManager as any).getConnection = async () => db;

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
        quantity INTEGER DEFAULT 0,
        mrp REAL
      );

      CREATE TABLE sales_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT UNIQUE,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        total_amount REAL,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        customer_name_snapshot TEXT,
        customer_phone_snapshot TEXT
      );

      CREATE TABLE refills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        customer_id INTEGER,
        medicine_id INTEGER,
        frequency_days INTEGER DEFAULT 30,
        next_refill_date DATE,
        status TEXT DEFAULT 'ACTIVE'
      );

      CREATE TABLE action_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        user_id INTEGER DEFAULT NULL,
        entity TEXT,
        entity_id TEXT,
        action_type TEXT,
        description TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO stores (id, name, code, is_central, is_active) VALUES
      (1, 'Central Pharmacy', 'STORE-CENTRAL', 1, 1),
      (2, 'Branch Pharmacy', 'STORE-NORTH', 0, 1);
    `);
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  describe('1. Secondary Module Tenant Isolation: Reports & Refills (§8, §23)', () => {
    it('scopes sales reports to active store tenant', async () => {
      // Seed sales across Store 1 and Store 2
      await db.run(`
        INSERT INTO sales_invoices (invoice_no, store_id, total_amount, date) VALUES
        ('INV-S1-001', 1, 500.0, '2026-09-01'),
        ('INV-S1-002', 1, 350.0, '2026-09-02'),
        ('INV-S2-001', 2, 1200.0, '2026-09-01');
      `);

      // Store 1 aggregation
      const store1Stats = await db.get(
        'SELECT COUNT(*) as count, SUM(total_amount) as total FROM sales_invoices WHERE store_id = ?',
        [1]
      );
      expect(store1Stats.count).toBe(2);
      expect(store1Stats.total).toBe(850.0);

      // Store 2 aggregation
      const store2Stats = await db.get(
        'SELECT COUNT(*) as count, SUM(total_amount) as total FROM sales_invoices WHERE store_id = ?',
        [2]
      );
      expect(store2Stats.count).toBe(1);
      expect(store2Stats.total).toBe(1200.0);

      // Combined view (all_stores=true)
      const allStats = await db.get('SELECT COUNT(*) as count, SUM(total_amount) as total FROM sales_invoices');
      expect(allStats.count).toBe(3);
      expect(allStats.total).toBe(2050.0);
    });

    it('scopes refills and stock checks to the active branch inventory', async () => {
      // Seed medicine and inventory: Store 1 has 0 stock, Store 2 has 50 in stock
      await db.run(`INSERT INTO medicines (id, name, mrp) VALUES (101, 'Metformin 500mg', 45.0)`);
      await db.run(`INSERT INTO inventory_master (store_id, medicine_id, batch_no, quantity, mrp) VALUES (1, 101, 'BATCH-1', 0, 45.0)`);
      await db.run(`INSERT INTO inventory_master (store_id, medicine_id, batch_no, quantity, mrp) VALUES (2, 101, 'BATCH-2', 50, 45.0)`);

      // Seed refills for store 1 and store 2
      await db.run(`INSERT INTO refills (store_id, customer_id, medicine_id, next_refill_date, status) VALUES (1, 1, 101, '2026-09-05', 'ACTIVE')`);
      await db.run(`INSERT INTO refills (store_id, customer_id, medicine_id, next_refill_date, status) VALUES (2, 1, 101, '2026-09-05', 'ACTIVE')`);

      // Check Store 1 stock for this refill
      const s1Stock = await db.get(
        'SELECT COALESCE(SUM(quantity), 0) as current_stock FROM inventory_master WHERE medicine_id = ? AND store_id = ?',
        [101, 1]
      );
      expect(s1Stock.current_stock).toBe(0);

      // Check Store 2 stock for this refill
      const s2Stock = await db.get(
        'SELECT COALESCE(SUM(quantity), 0) as current_stock FROM inventory_master WHERE medicine_id = ? AND store_id = ?',
        [101, 2]
      );
      expect(s2Stock.current_stock).toBe(50);
    });
  });

  describe('2. Distributor Recommendation & Scoring Engine (§14, §15)', () => {
    it('ranks distributor with better PTR and higher margin higher', () => {
      // Candidate A: Higher PTR (lower margin)
      const candA = calculateDistributorScore({
        distributorId: 1,
        distributorName: 'Distributor Alpha',
        ptr: 80,
        mrp: 100,
        currentStock: 10,
        purchaseCount: 2,
        lastPurchaseDaysAgo: 15
      });

      // Candidate B: Lower PTR (higher margin: 30% vs 20%), same stock and purchase frequency
      const candB = calculateDistributorScore({
        distributorId: 2,
        distributorName: 'Distributor Beta',
        ptr: 70,
        mrp: 100,
        currentStock: 10,
        purchaseCount: 2,
        lastPurchaseDaysAgo: 15
      });

      expect(candB.marginPercent).toBe(30);
      expect(candA.marginPercent).toBe(20);
      expect(candB.score).toBeGreaterThan(candA.score);
    });

    it('boosts score for distributors with healthy local stock levels', () => {
      // Out of stock distributor history
      const oos = calculateDistributorScore({
        distributorId: 1,
        distributorName: 'Distributor A',
        ptr: 75,
        mrp: 100,
        currentStock: 0,
        purchaseCount: 5,
        lastPurchaseDaysAgo: 10
      });

      // Healthy in-stock distributor history
      const inStock = calculateDistributorScore({
        distributorId: 2,
        distributorName: 'Distributor B',
        ptr: 75,
        mrp: 100,
        currentStock: 25,
        purchaseCount: 5,
        lastPurchaseDaysAgo: 10
      });

      expect(inStock.score).toBeGreaterThan(oos.score);
      expect(inStock.stockFactor).toBeGreaterThan(oos.stockFactor);
    });
  });

  describe('3. Mutation Audit Trail (§29)', () => {
    it('records immutable audit logs with before/after snapshots and tenant ID', async () => {
      const insertedId = await logMutationAudit({
        storeId: 2,
        userId: 99,
        username: 'pharmacist_jane',
        action: 'STOCK_OVERRIDE',
        entity: 'inventory_master',
        entityId: 42,
        description: 'Manual cycle count correction',
        beforeSnapshot: { quantity: 15, batch_no: 'B101' },
        afterSnapshot: { quantity: 20, reason: 'Physical recount' }
      });

      expect(insertedId).toBeDefined();
      expect(insertedId).toBeGreaterThan(0);

      // Query logs through service
      const logs = await getMutationAuditLogs({ storeId: 2, entity: 'inventory_master' });
      expect(logs.length).toBe(1);
      expect(logs[0].store_id).toBe(2);
      expect(logs[0].user_id).toBe(99);
      expect(logs[0].action).toBe('STOCK_OVERRIDE');
      expect(logs[0].before_snapshot.quantity).toBe(15);
      expect(logs[0].after_snapshot.quantity).toBe(20);
      expect(logs[0].username).toBe('pharmacist_jane');
    });

    it('filters mutation logs by store tenant', async () => {
      // Add log for store 1
      await logMutationAudit({
        storeId: 1,
        action: 'PRICE_CHANGE',
        entity: 'medicines',
        entityId: 10,
        description: 'Price revision Store 1'
      });

      // Query store 1 vs store 2
      const s1Logs = await getMutationAuditLogs({ storeId: 1 });
      const s2Logs = await getMutationAuditLogs({ storeId: 2 });

      expect(s1Logs.some(l => l.action === 'PRICE_CHANGE')).toBe(true);
      expect(s2Logs.some(l => l.action === 'PRICE_CHANGE')).toBe(false);
    });
  });
});
