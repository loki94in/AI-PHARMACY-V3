import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { StoreContextService } from '../src/services/storeContextService.js';

describe('Multi-Store Foundation & Isolation', () => {
  let db: Database;
  let service: StoreContextService;

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
        address TEXT,
        phone TEXT,
        email TEXT,
        is_central INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE store_settings (
        store_id INTEGER,
        key TEXT,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(store_id, key),
        FOREIGN KEY(store_id) REFERENCES stores(id)
      );

      CREATE TABLE special_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER DEFAULT 1,
        product TEXT,
        requester TEXT,
        phone TEXT,
        qty INTEGER DEFAULT 1,
        status TEXT DEFAULT 'Pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO stores (id, name, code, is_central, is_active) VALUES (1, 'Central Store', 'STORE-CENTRAL', 1, 1);
    `);

    service = new StoreContextService();
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  it('lists existing active stores', async () => {
    const stores = await service.listStores(db);
    expect(stores.length).toBe(1);
    expect(stores[0].name).toBe('Central Store');
    expect(stores[0].is_central).toBe(1);
  });

  it('creates a new branch store and fetches by ID', async () => {
    const newStore = await service.createStore(
      {
        name: 'Branch B - Downtown',
        code: 'STORE-B',
        address: '123 Market St',
        phone: '9876543210',
        email: 'branchb@pharmacy.com',
        is_central: false
      },
      db
    );

    expect(newStore.id).toBe(2);
    expect(newStore.name).toBe('Branch B - Downtown');
    expect(newStore.code).toBe('STORE-B');

    const fetched = await service.getStoreById(2, db);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe('Branch B - Downtown');
  });

  it('manages store-specific settings independently', async () => {
    await service.setStoreSetting(1, 'pharmarack_retailer_id', 'RET-STORE-1', db);
    await service.setStoreSetting(2, 'pharmarack_retailer_id', 'RET-STORE-2', db);

    const s1 = await service.getStoreSetting(1, 'pharmarack_retailer_id', '', db);
    const s2 = await service.getStoreSetting(2, 'pharmarack_retailer_id', '', db);

    expect(s1).toBe('RET-STORE-1');
    expect(s2).toBe('RET-STORE-2');
  });

  it('maintains data isolation between Store 1 and Store 2 orders', async () => {
    await db.run(
      `INSERT INTO special_orders (store_id, product, requester, qty) VALUES (1, 'Paracetamol 650mg', 'Alice', 2)`
    );
    await db.run(
      `INSERT INTO special_orders (store_id, product, requester, qty) VALUES (2, 'Amoxicillin 500mg', 'Bob', 1)`
    );

    const store1Orders = await db.all('SELECT * FROM special_orders WHERE store_id = 1');
    const store2Orders = await db.all('SELECT * FROM special_orders WHERE store_id = 2');

    expect(store1Orders.length).toBe(1);
    expect(store1Orders[0].product).toBe('Paracetamol 650mg');

    expect(store2Orders.length).toBe(1);
    expect(store2Orders[0].product).toBe('Amoxicillin 500mg');
  });
});
