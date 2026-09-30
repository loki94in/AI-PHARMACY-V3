import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Regression: verifyDatabaseHealth() pre-acquired the tx lock, so the write
// interceptor turned its BEGIN into a SAVEPOINT and its ROLLBACK into
// ROLLBACK TO SAVEPOINT — leaving the shared connection inside an open
// transaction that silently swallowed every later autocommit write.
describe('verifyDatabaseHealth transaction hygiene', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-health-'));
  const DB_PATH = path.join(dir, 'app.db');

  beforeAll(async () => {
    const raw = await open({ filename: DB_PATH, driver: sqlite3.Database });
    await raw.exec(`
      CREATE TABLE medicines(id INTEGER PRIMARY KEY, name TEXT);
      CREATE INDEX idx_medicines_name ON medicines(name);
      CREATE TABLE inventory_master(id INTEGER PRIMARY KEY, medicine_id INT);
      CREATE INDEX idx_inventory_master_medicine_id ON inventory_master(medicine_id);
      CREATE TABLE sales_invoices(id INTEGER PRIMARY KEY);
      CREATE TABLE sale_items(id INTEGER PRIMARY KEY);
      CREATE TABLE customers(id INTEGER PRIMARY KEY);
      CREATE TABLE doctors(id INTEGER PRIMARY KEY);
      CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE action_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER DEFAULT 1,
        user_id INTEGER, entity TEXT, entity_id TEXT, action_type TEXT, description TEXT,
        metadata TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    `);
    await raw.close();
    process.env.DB_PATH = DB_PATH;
  });

  afterAll(async () => {
    delete process.env.DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('health checks leave no open transaction and no test rows', async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const { verificationService } = await import('../src/services/verificationService.js');

    for (let i = 0; i < 3; i++) {
      const result = await verificationService.verifyDatabaseHealth();
      expect(result.success).toBe(true);
    }
    expect(dbManager.getLockStats().isTxLocked).toBe(false);

    const db = await dbManager.getConnection();
    await db.run("INSERT INTO app_settings (key, value) VALUES ('after_health_check', '1')");
    await dbManager.close(true);

    const check = await open({ filename: DB_PATH, driver: sqlite3.Database });
    const row = await check.get(
      "SELECT (SELECT COUNT(*) FROM action_logs) AS testRows, (SELECT COUNT(*) FROM app_settings) AS settingsRows"
    );
    await check.close();
    expect(row).toEqual({ testRows: 0, settingsRows: 1 });
  });
});
