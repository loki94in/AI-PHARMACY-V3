import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Regression: enrichMasterMedicinesFromCsv() re-ran the full 120 MB CSV on every
// boot and rewrote every master row (FTS update trigger included), pegging a CPU
// core for ~2 min. It must run once per CSV version and only write real gaps.
describe('enrichMasterMedicinesFromCsv idempotence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'master-enrich-'));
  const DB_PATH = path.join(dir, 'data', 'app.db');

  beforeAll(async () => {
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data', 'reference_medicines.csv'), [
      'medicine_id,medicine_name,manufacturer_name,marketer_name,medicine_packaging,itemtype,hsn_code,cgst,sgst,igst,selling_price,barcode,rack,therapeutic,subtherapeutic,medicine_short_code,ucode',
      'L1,Alpha 10 Tab,Acme,Acme Mkt,10 Tab,TAB,3004,6,6,12,55.5,,,Cardiac,,A10,U1',
      'L2,Beta 5 Syp,Bolt Pharma,,100 ml,SYP,3004,6,6,12,40,,,,,,',
      'L3,Gamma Cap,Gama Labs,,10 Cap,CAP,3004,6,6,12,90,,,,,,'
    ].join('\n'));

    const raw = await open({ filename: DB_PATH, driver: sqlite3.Database });
    await raw.exec(`
      CREATE TABLE medicines(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, canonical_name TEXT,
        normalized_name TEXT, manufacturer TEXT, marketed_by TEXT, packaging TEXT, pack_size INT,
        item_type TEXT, hsn_code TEXT, cgst_per REAL, sgst_per REAL, igst_per REAL, sell_price REAL,
        barcode TEXT, rack TEXT, therapeutic TEXT, sub_therapeutic TEXT, short_code TEXT, ucode TEXT,
        legacy_id TEXT, source TEXT, status TEXT);
      CREATE UNIQUE INDEX idx_medicines_legacy_id ON medicines(legacy_id);
      CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE upd_count(n INT);
      INSERT INTO upd_count VALUES (0);
      CREATE TRIGGER count_upd AFTER UPDATE ON medicines BEGIN UPDATE upd_count SET n = n + 1; END;
      INSERT INTO medicines(name, legacy_id, source, manufacturer, packaging) VALUES ('Beta 5 Syp', 'L2', 'master_reference', '', '100 ml');
      INSERT INTO medicines(name, legacy_id, source, manufacturer) VALUES ('Gamma Cap', 'L3', 'user', '');
    `);
    await raw.close();
    process.env.DB_PATH = DB_PATH;
    process.env.DATA_DIR = dir;
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    delete process.env.DB_PATH;
    delete process.env.DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('fills only empty fields once, then skips unchanged CSV and never rewrites rows', async () => {
    const { enrichMasterMedicinesFromCsv } = await import('../src/services/masterMedicinesSeedService.js');
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    const updates = async () => (await db.get('SELECT n FROM upd_count')).n;

    // L1 inserted, L2's empty manufacturer filled; user-owned L3 untouched.
    expect((await enrichMasterMedicinesFromCsv()).enriched).toBe(2);
    expect(await updates()).toBe(1);

    // Same CSV: fingerprint hit, no scan.
    expect((await enrichMasterMedicinesFromCsv()).enriched).toBe(0);

    // Forced rescan of already-enriched rows writes nothing.
    await db.run("DELETE FROM app_settings WHERE key = 'master_enrich_csv_fingerprint'");
    expect((await enrichMasterMedicinesFromCsv()).enriched).toBe(0);
    expect(await updates()).toBe(1);

    const rows = await db.all('SELECT legacy_id, manufacturer, packaging FROM medicines ORDER BY legacy_id');
    expect(rows).toEqual([
      { legacy_id: 'L1', manufacturer: 'Acme', packaging: '10 Tab' },
      { legacy_id: 'L2', manufacturer: 'Bolt Pharma', packaging: '100 ml' },
      { legacy_id: 'L3', manufacturer: '', packaging: null }
    ]);
  });
});
