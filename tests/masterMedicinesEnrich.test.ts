import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB = path.resolve(__dirname, '..', 'data', 'master_enrich_test.db');

describe('Master Medicines Partial Index Constraint Resolution Test', () => {
  let db: any;

  beforeAll(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = await open({ filename: TEST_DB, driver: sqlite3.Database });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        canonical_name TEXT,
        normalized_name TEXT,
        manufacturer TEXT,
        marketed_by TEXT,
        packaging TEXT,
        pack_size INTEGER,
        item_type TEXT,
        hsn_code TEXT,
        cgst_per REAL DEFAULT 0,
        sgst_per REAL DEFAULT 0,
        igst_per REAL DEFAULT 0,
        sell_price REAL,
        barcode TEXT,
        rack TEXT,
        therapeutic TEXT,
        sub_therapeutic TEXT,
        short_code TEXT,
        ucode TEXT,
        legacy_id TEXT,
        source TEXT DEFAULT 'manual',
        status TEXT DEFAULT 'ACTIVE'
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_medicines_legacy_id
      ON medicines(legacy_id)
      WHERE legacy_id IS NOT NULL;
    `);
  });

  afterAll(async () => {
    if (db) await db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  test('UPSERT query with WHERE legacy_id IS NOT NULL resolves without SQLITE_ERROR', async () => {
    const upsertSql = `
      INSERT INTO medicines (
        name, canonical_name, normalized_name, manufacturer, marketed_by,
        packaging, pack_size, item_type, hsn_code, cgst_per,
        sgst_per, igst_per, sell_price, barcode, rack,
        therapeutic, sub_therapeutic, short_code, ucode, legacy_id,
        source, status
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        'master_reference', 'ACTIVE'
      )
      ON CONFLICT(legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET
        packaging    = excluded.packaging,
        manufacturer = excluded.manufacturer
      WHERE medicines.source = 'master_reference'
    `;

    // 1. Initial insert
    await expect(
      db.run(upsertSql, [
        'Dolo 650', 'Dolo 650', 'dolo 650', 'Micro Labs', 'Micro Labs',
        '15 Tab', 15, 'TAB', '3004', 6,
        6, 0, 30.5, '890123', 'R1',
        'Analgesic', 'Paracetamol', 'DOLO', 'U001', 'LEGACY_DOLO_01'
      ])
    ).resolves.not.toThrow();

    // 2. Second insert with same legacy_id triggers UPDATE without constraint failure
    await expect(
      db.run(upsertSql, [
        'Dolo 650 New', 'Dolo 650', 'dolo 650', 'Micro Labs Ltd', 'Micro Labs Ltd',
        '15 Tablets Strip', 15, 'TAB', '3004', 6,
        6, 0, 30.5, '890123', 'R1',
        'Analgesic', 'Paracetamol', 'DOLO', 'U001', 'LEGACY_DOLO_01'
      ])
    ).resolves.not.toThrow();

    // 3. Verify record was enriched/updated
    const row = await db.get('SELECT * FROM medicines WHERE legacy_id = ?', ['LEGACY_DOLO_01']);
    expect(row).toBeDefined();
    expect(row.packaging).toBe('15 Tablets Strip');
    expect(row.manufacturer).toBe('Micro Labs Ltd');
  });
});
