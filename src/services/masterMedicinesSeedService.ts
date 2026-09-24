import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { dbManager } from '../database/connection.js';
import { config, getAppDataDir } from '../config/index.js';

function clean(v: any): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return (!t || t.toLowerCase() === 'null') ? null : t;
}

function cleanNum(v: any): number {
  const c = clean(v);
  if (!c) return 0.0;
  const n = parseFloat(c);
  return isNaN(n) ? 0.0 : n;
}

function cleanPrice(v: any): number | null {
  const c = clean(v);
  if (!c) return null;
  const n = parseFloat(c);
  return isNaN(n) ? null : n;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cur);
  return result;
}

/**
 * Seeds the master medicines database table from medicines.csv or reference_medicines.csv
 * if medicines count is low or after a system reset.
 */
export async function seedMasterMedicines(force = false): Promise<{ loaded: number }> {
  const db = await dbManager.getConnection();
  try {
    // Auto-heal legacy corrupted records where manufacturer was erroneously parsed as 'f'
    try {
      const corruptRow = await db.get(`
        SELECT COUNT(*) as cnt 
        FROM medicines 
        WHERE source = 'master_reference' AND manufacturer = 'f'
      `);
      if (corruptRow && corruptRow.cnt > 0) {
        console.log(`[MasterSeed] Detected ${corruptRow.cnt} legacy corrupted master_reference rows (manufacturer='f'). Auto-purging...`);
        await db.run(`
          DELETE FROM medicines 
          WHERE source = 'master_reference' 
            AND manufacturer = 'f' 
            AND (legacy_id IS NULL OR length(name) <= 8)
        `);
      }
    } catch (_) {}

    if (!force) {
      const row = await db.get("SELECT COUNT(*) as c FROM medicines WHERE (packaging IS NOT NULL AND packaging != '') OR source != 'master_reference'");
      if (row && row.c > 50) {
        return { loaded: 0 };
      }
    }

    const candidateCsvPaths = [
      path.join(getAppDataDir(), 'data', 'reference_medicines.csv'),
      path.join(getAppDataDir(), 'medicines.csv'),
      path.join(process.cwd(), 'data', 'reference_medicines.csv'),
      path.join(process.cwd(), 'medicines.csv'),
      path.join(process.cwd(), 'data', 'medicines.csv'),
      path.join(path.dirname(process.execPath), 'data', 'reference_medicines.csv'),
      path.join(path.dirname(process.execPath), 'medicines.csv'),
      path.join(path.dirname(process.execPath), '..', 'data', 'reference_medicines.csv'),
      path.join(path.dirname(process.execPath), '..', 'medicines.csv')
    ];
    const csvPath = candidateCsvPaths.find(p => fs.existsSync(p));

    if (!csvPath) {
      // Fallback: copy master catalog from template app.db if available
      const templateCandidates = [
        path.join(process.cwd(), 'data', 'app.db'),
        path.join(path.dirname(process.execPath), 'data', 'app.db'),
        path.join(path.dirname(process.execPath), '..', 'data', 'app.db')
      ];
      for (const tPath of templateCandidates) {
        if (fs.existsSync(tPath) && path.resolve(tPath) !== path.resolve(config.dbPath)) {
          try {
            const normalized = tPath.replace(/\\/g, '/');
            await db.run(`ATTACH DATABASE '${normalized}' AS templateDb`);
            const res = await db.run(`
              INSERT OR IGNORE INTO medicines (
                name, canonical_name, normalized_name, product_code, status,
                dosage_form, pack_size, barcode, api_reference, mrp,
                hsn_code, schedule_type, manufacturer, category, marketed_by,
                legacy_id, packaging, item_type, cgst_per, sgst_per,
                igst_per, rack, therapeutic, sub_therapeutic, short_code,
                ucode, source, sell_price, allow_loose_sale
              )
              SELECT 
                name, canonical_name, normalized_name, product_code, status,
                dosage_form, pack_size, barcode, api_reference, mrp,
                hsn_code, schedule_type, manufacturer, category, marketed_by,
                legacy_id, packaging, item_type, cgst_per, sgst_per,
                igst_per, rack, therapeutic, sub_therapeutic, short_code,
                ucode, source, sell_price, allow_loose_sale
              FROM templateDb.medicines
              WHERE (packaging IS NOT NULL AND packaging != '') OR source != 'master_reference'
            `);
            await db.run(`DETACH DATABASE templateDb`);
            const loaded = res?.changes || 0;
            if (loaded > 0) {
              console.log(`[MasterSeed] Successfully synced ${loaded} master medicines from template DB (${tPath}).`);
              try {
                const { ensureMedicinesFts } = await import('../database.js');
                await ensureMedicinesFts(db);
              } catch (_) {}
              return { loaded };
            }
          } catch (e: any) {
            console.warn('[MasterSeed] Template DB copy failed:', e.message);
            try { await db.run(`DETACH DATABASE templateDb`); } catch {}
          }
        }
      }
      console.warn('[MasterSeed] Reference CSV not found in any candidate path:', candidateCsvPaths);
      return { loaded: 0 };
    }

    const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    // Ensure unique legacy_id index exists for idempotent inserts
    try {
      const idxList: any[] = await db.all("PRAGMA index_list('medicines')");
      const legacyIdx = idxList.find((i: any) => i.name === 'idx_medicines_legacy_id');
      if (legacyIdx && Number(legacyIdx.partial) === 1) {
        await db.run('DROP INDEX IF EXISTS idx_medicines_legacy_id');
        await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_medicines_legacy_id ON medicines(legacy_id)');
      } else if (!legacyIdx) {
        await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_medicines_legacy_id ON medicines(legacy_id)');
      }
    } catch (_) {}

    let loaded = 0;
    let headerParsed = false;
    let isFullMedicinesCsv = false;
    const col: Record<string, number> = {};
    // Micro-batching (100 rows) prevents holding SQLite write lock for long periods
    const batchSize = 100;
    let csvBatch: any[][] = [];
    let simpleBatch: Array<[string, string | null, string | null, string]> = [];

    for await (const line of rl) {
      if (!line.trim()) continue;

      if (!headerParsed) {
        headerParsed = true;
        const headerCols = parseCsvLine(line).map(h => h.trim().replace(/^"|"$/g, ''));
        headerCols.forEach((c, idx) => { col[c] = idx; });
        if (col['medicine_name'] !== undefined) {
          isFullMedicinesCsv = true;
        }
        continue;
      }

      if (isFullMedicinesCsv) {
        const fields = parseCsvLine(line);
        const rawName = fields[col['medicine_name']];
        const name = clean(rawName);
        if (!name) continue;

        const legacyId = clean(fields[col['medicine_id']]);
        const mfg = clean(fields[col['manufacturer_name']]);
        const mkt = clean(fields[col['marketer_name']]);
        const pkg = clean(fields[col['medicine_packaging']]);
        const itemType = clean(fields[col['itemtype']]);
        const hsn = clean(fields[col['hsn_code']]);
        const cgst = cleanNum(fields[col['cgst']]);
        const sgst = cleanNum(fields[col['sgst']]);
        const igst = cleanNum(fields[col['igst']]);
        const sellPrice = cleanPrice(fields[col['selling_price']]);
        const barcode = clean(fields[col['barcode']]);
        const rack = clean(fields[col['rack']]);
        const therapeutic = clean(fields[col['therapeutic']]);
        const subTherapeutic = clean(fields[col['subtherapeutic']]);
        const shortCode = clean(fields[col['medicine_short_code']]);
        const ucode = clean(fields[col['ucode']]);

        const parsedPackSize = pkg ? (parseInt(pkg) || null) : null;

        csvBatch.push([
          name,
          name,
          name.toLowerCase(),
          mfg,
          mkt,
          pkg,
          parsedPackSize,
          itemType,
          hsn,
          cgst,
          sgst,
          igst,
          sellPrice,
          barcode,
          rack,
          therapeutic,
          subTherapeutic,
          shortCode,
          ucode,
          legacyId
        ]);

        if (csvBatch.length >= batchSize) {
          await insertMedicinesCsvBatch(db, csvBatch);
          loaded += csvBatch.length;
          csvBatch = [];
        }
      } else {
        // Fallback for simple 4-column CSV: name, comp1, comp2, manufacturer
        const parts = parseCsvLine(line);
        if (parts.length < 1) continue;

        const name = clean(parts[0]);
        if (!name) continue;

        const comp1 = clean(parts[1]);
        const comp2 = clean(parts[2]);
        const manufacturer = clean(parts[3]);

        const genericName = [comp1, comp2].filter(Boolean).join(' + ') || null;
        simpleBatch.push([name, genericName, manufacturer, 'master_reference']);

        if (simpleBatch.length >= batchSize) {
          await insertSimpleBatch(db, simpleBatch);
          loaded += simpleBatch.length;
          simpleBatch = [];
        }
      }
    }

    if (csvBatch.length > 0) {
      await insertMedicinesCsvBatch(db, csvBatch);
      loaded += csvBatch.length;
    }
    if (simpleBatch.length > 0) {
      await insertSimpleBatch(db, simpleBatch);
      loaded += simpleBatch.length;
    }

    if (loaded > 0) {
      try {
        const { ensureMedicinesFts } = await import('../database.js');
        await ensureMedicinesFts(db);
      } catch (_) {}
    }

    console.log(`[MasterSeed] Successfully seeded ${loaded} master medicines into database.`);
    return { loaded };
  } catch (err: any) {
    console.error('[MasterSeed] Error seeding master medicines:', err.message);
    throw err;
  }
}

async function insertMedicinesCsvBatch(db: any, rows: any[][]) {
  await dbManager.runWithPriority('BACKGROUND', async () => {
    await db.run('BEGIN TRANSACTION');
    try {
      const stmt = await db.prepare(`
        INSERT OR IGNORE INTO medicines (
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
      `);
      for (const row of rows) {
        await stmt.run(...row);
      }
      await stmt.finalize();
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  });
  // Cooperative yield so POS billing transactions can slip in
  await new Promise(resolve => setTimeout(resolve, 15));
}

async function insertSimpleBatch(db: any, rows: Array<[string, string | null, string | null, string]>) {
  await dbManager.runWithPriority('BACKGROUND', async () => {
    await db.run('BEGIN TRANSACTION');
    try {
      const stmt = await db.prepare(
        `INSERT OR IGNORE INTO medicines (name, generic_name, manufacturer, source, mrp, cgst_per, sgst_per)
         VALUES (?, ?, ?, ?, 0, 6, 6)`
      );
      for (const row of rows) {
        await stmt.run(row[0], row[1], row[2], row[3]);
      }
      await stmt.finalize();
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  });
  // Cooperative yield so POS billing transactions can slip in
  await new Promise(resolve => setTimeout(resolve, 15));
}

/**
 * Ensures any item saved in purchase/inventory/sale is present in the master medicines catalog
 */
export async function syncInventoryToMaster(): Promise<{ synced: number }> {
  const db = await dbManager.getConnection();
  try {
    let synced = 0;
    
    // Sync from purchase_items
    try {
      const res = await db.run(`
        INSERT OR IGNORE INTO medicines (name, manufacturer, mrp, cgst_per, sgst_per, hsn_code, source)
        SELECT DISTINCT medicine_name, manufacturer, mrp, cgst_per, sgst_per, hsn_code, 'purchase_sync'
        FROM purchase_items
        WHERE medicine_name IS NOT NULL AND TRIM(medicine_name) != ''
          AND LOWER(TRIM(medicine_name)) NOT IN (SELECT LOWER(TRIM(name)) FROM medicines WHERE name IS NOT NULL)
      `);
      synced += res.changes || 0;
    } catch (_) {}

    // Sync from sale_items
    try {
      const res = await db.run(`
        INSERT OR IGNORE INTO medicines (name, mrp, cgst_per, sgst_per, source)
        SELECT DISTINCT item_name, mrp, cgst_per, sgst_per, 'sale_sync'
        FROM sale_items
        WHERE item_name IS NOT NULL AND TRIM(item_name) != ''
          AND LOWER(TRIM(item_name)) NOT IN (SELECT LOWER(TRIM(name)) FROM medicines WHERE name IS NOT NULL)
      `);
      synced += res.changes || 0;
    } catch (_) {}

    console.log(`[MasterSeed] Synced ${synced} missing inventory items into master catalog.`);
    return { synced };
  } catch (err: any) {
    console.error('[MasterSeed] Error syncing inventory to master:', err.message);
    throw err;
  }
}

/**
 * Reads medicines.csv and enriches existing master_reference rows in the medicines table
 * by filling in empty fields (packaging, manufacturer, therapeutic, etc.) via
 * INSERT ... ON CONFLICT(legacy_id) DO UPDATE. User-edited records (source != 'master_reference')
 * and already-populated fields are never touched.
 * Safe to call on every boot — skips enrichment if CSV is absent.
 */
export async function enrichMasterMedicinesFromCsv(): Promise<{ enriched: number }> {
  const db = await dbManager.getConnection();

  // Auto-heal legacy corrupted records where manufacturer was erroneously parsed as 'f'
  try {
    const corruptRow = await db.get(`
      SELECT COUNT(*) as cnt 
      FROM medicines 
      WHERE source = 'master_reference' AND manufacturer = 'f'
    `);
    if (corruptRow && corruptRow.cnt > 0) {
      console.log(`[MasterEnrich] Purging ${corruptRow.cnt} legacy corrupted rows (manufacturer='f')...`);
      await db.run(`
        DELETE FROM medicines 
        WHERE source = 'master_reference' 
          AND manufacturer = 'f' 
          AND (legacy_id IS NULL OR length(name) <= 8)
      `);
    }
  } catch (_) {}

  const candidateCsvPaths = [
    path.join(getAppDataDir(), 'data', 'reference_medicines.csv'),
    path.join(getAppDataDir(), 'medicines.csv'),
    path.join(process.cwd(), 'medicines.csv'),
    path.join(process.cwd(), 'data', 'reference_medicines.csv'),
    path.join(process.cwd(), 'data', 'medicines.csv'),
    path.join(path.dirname(process.execPath), 'data', 'reference_medicines.csv'),
    path.join(path.dirname(process.execPath), 'medicines.csv'),
    path.join(path.dirname(process.execPath), '..', 'data', 'reference_medicines.csv'),
    path.join(path.dirname(process.execPath), '..', 'medicines.csv')
  ];
  const csvPath = candidateCsvPaths.find(p => fs.existsSync(p));

  if (!csvPath) {
    // Fallback: copy master catalog from template app.db if available
    const templateCandidates = [
      path.join(process.cwd(), 'data', 'app.db'),
      path.join(path.dirname(process.execPath), 'data', 'app.db'),
      path.join(path.dirname(process.execPath), '..', 'data', 'app.db')
    ];
    for (const tPath of templateCandidates) {
      if (fs.existsSync(tPath) && path.resolve(tPath) !== path.resolve(config.dbPath)) {
        try {
          const normalized = tPath.replace(/\\/g, '/');
          await db.run(`ATTACH DATABASE '${normalized}' AS templateDb`);
          const res = await db.run(`
            INSERT OR IGNORE INTO medicines (
              name, canonical_name, normalized_name, product_code, status,
              dosage_form, pack_size, barcode, api_reference, mrp,
              hsn_code, schedule_type, manufacturer, category, marketed_by,
              legacy_id, packaging, item_type, cgst_per, sgst_per,
              igst_per, rack, therapeutic, sub_therapeutic, short_code,
              ucode, source, sell_price, allow_loose_sale
            )
            SELECT 
              name, canonical_name, normalized_name, product_code, status,
              dosage_form, pack_size, barcode, api_reference, mrp,
              hsn_code, schedule_type, manufacturer, category, marketed_by,
              legacy_id, packaging, item_type, cgst_per, sgst_per,
              igst_per, rack, therapeutic, sub_therapeutic, short_code,
              ucode, source, sell_price, allow_loose_sale
            FROM templateDb.medicines
            WHERE (packaging IS NOT NULL AND packaging != '') OR source != 'master_reference'
          `);
          await db.run(`DETACH DATABASE templateDb`);
          const enrichedCount = res?.changes || 0;
          if (enrichedCount > 0) {
            console.log(`[MasterEnrich] Successfully enriched ${enrichedCount} medicines from template DB (${tPath}).`);
            try {
              const { ensureMedicinesFts } = await import('../database.js');
              await ensureMedicinesFts(db);
            } catch (_) {}
            return { enriched: enrichedCount };
          }
        } catch (e: any) {
          console.warn('[MasterEnrich] Template DB enrichment failed:', e.message);
          try { await db.run(`DETACH DATABASE templateDb`); } catch {}
        }
      }
    }
    console.warn('[MasterEnrich] medicines.csv not found in any candidate path — skipping enrichment.');
    return { enriched: 0 };
  }

  // Ensure legacy_id unique index exists for conflict resolution
  try {
    const idxList: any[] = await db.all("PRAGMA index_list('medicines')");
    const legacyIdx = idxList.find((i: any) => i.name === 'idx_medicines_legacy_id');
    if (legacyIdx && Number(legacyIdx.partial) === 1) {
      await db.run('DROP INDEX IF EXISTS idx_medicines_legacy_id');
      await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_medicines_legacy_id ON medicines(legacy_id)');
    } else if (!legacyIdx) {
      await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_medicines_legacy_id ON medicines(legacy_id)');
    }
  } catch (_) {}

  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let enriched = 0;
  let headerParsed = false;
  let isFullMedicinesCsv = false;
  const col: Record<string, number> = {};
  const batchSize = 500;
  let batch: any[][] = [];

  const flushBatch = async (rows: any[][]) => {
    if (rows.length === 0) return;
    await db.run('BEGIN TRANSACTION');
    try {
      const stmt = await db.prepare(`
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
          packaging      = CASE WHEN COALESCE(medicines.packaging,   '') = '' THEN excluded.packaging      ELSE medicines.packaging      END,
          manufacturer   = CASE WHEN COALESCE(medicines.manufacturer,'') = '' THEN excluded.manufacturer   ELSE medicines.manufacturer   END,
          marketed_by    = CASE WHEN COALESCE(medicines.marketed_by, '') = '' THEN excluded.marketed_by    ELSE medicines.marketed_by    END,
          item_type      = CASE WHEN COALESCE(medicines.item_type,   '') = '' THEN excluded.item_type      ELSE medicines.item_type      END,
          hsn_code       = CASE WHEN COALESCE(medicines.hsn_code,    '') = '' THEN excluded.hsn_code       ELSE medicines.hsn_code       END,
          therapeutic    = CASE WHEN COALESCE(medicines.therapeutic, '') = '' THEN excluded.therapeutic    ELSE medicines.therapeutic    END,
          sub_therapeutic= CASE WHEN COALESCE(medicines.sub_therapeutic,'') = '' THEN excluded.sub_therapeutic ELSE medicines.sub_therapeutic END,
          short_code     = CASE WHEN COALESCE(medicines.short_code,  '') = '' THEN excluded.short_code     ELSE medicines.short_code     END,
          ucode          = CASE WHEN COALESCE(medicines.ucode,       '') = '' THEN excluded.ucode          ELSE medicines.ucode          END,
          barcode        = CASE WHEN COALESCE(medicines.barcode,     '') = '' THEN excluded.barcode        ELSE medicines.barcode        END,
          rack           = CASE WHEN COALESCE(medicines.rack,        '') = '' THEN excluded.rack           ELSE medicines.rack           END,
          cgst_per       = CASE WHEN (medicines.cgst_per IS NULL OR medicines.cgst_per = 0) THEN excluded.cgst_per ELSE medicines.cgst_per END,
          sgst_per       = CASE WHEN (medicines.sgst_per IS NULL OR medicines.sgst_per = 0) THEN excluded.sgst_per ELSE medicines.sgst_per END,
          sell_price     = CASE WHEN (medicines.sell_price IS NULL OR medicines.sell_price = 0) THEN excluded.sell_price ELSE medicines.sell_price END
        WHERE medicines.source = 'master_reference'
      `);
      for (const row of rows) {
        await stmt.run(...row);
      }
      await stmt.finalize();
      await db.run('COMMIT');
      enriched += rows.length;
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  };

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      if (!headerParsed) {
        headerParsed = true;
        const headerCols = parseCsvLine(line).map(h => h.trim().replace(/^"|"$/g, ''));
        headerCols.forEach((c, idx) => { col[c] = idx; });
        isFullMedicinesCsv = col['medicine_name'] !== undefined;
        continue;
      }

      if (!isFullMedicinesCsv) continue; // Only handle the full pharmarack CSV format

      const fields = parseCsvLine(line);
      const name = clean(fields[col['medicine_name']]);
      if (!name) continue;

      const legacyId = clean(fields[col['medicine_id']]);
      if (!legacyId) continue; // Need legacy_id for conflict resolution

      const mfg = clean(fields[col['manufacturer_name']]);
      const mkt = clean(fields[col['marketer_name']]);
      const pkg = clean(fields[col['medicine_packaging']]);
      const itemType = clean(fields[col['itemtype']]);
      const hsn = clean(fields[col['hsn_code']]);
      const cgst = cleanNum(fields[col['cgst']]);
      const sgst = cleanNum(fields[col['sgst']]);
      const igst = cleanNum(fields[col['igst']]);
      const sellPrice = cleanPrice(fields[col['selling_price']]);
      const barcode = clean(fields[col['barcode']]);
      const rack = clean(fields[col['rack']]);
      const therapeutic = clean(fields[col['therapeutic']]);
      const subTherapeutic = clean(fields[col['subtherapeutic']]);
      const shortCode = clean(fields[col['medicine_short_code']]);
      const ucode = clean(fields[col['ucode']]);
      const parsedPackSize = pkg ? (parseInt(pkg) || null) : null;

      batch.push([
        name,
        name,
        name.toLowerCase(),
        mfg,
        mkt,
        pkg,
        parsedPackSize,
        itemType,
        hsn,
        cgst,
        sgst,
        igst,
        sellPrice,
        barcode,
        rack,
        therapeutic,
        subTherapeutic,
        shortCode,
        ucode,
        legacyId
      ]);

      if (batch.length >= batchSize) {
        await flushBatch(batch);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await flushBatch(batch);
    }

    if (enriched > 0) {
      try {
        const { ensureMedicinesFts } = await import('../database.js');
        await ensureMedicinesFts(db);
      } catch (_) {}
    }

    console.log(`[MasterEnrich] Enriched/upserted ${enriched} master medicines from CSV (${csvPath}).`);
    return { enriched };
  } catch (err: any) {
    console.error('[MasterEnrich] Error enriching master medicines from CSV:', err.message);
    // Don't throw — enrichment failure must not crash the app
    return { enriched };
  }
}

/**
 * Upsert a single product into master medicines table whenever created or purchased
 */
export async function upsertMasterMedicine(item: {
  name: string;
  manufacturer?: string;
  generic_name?: string;
  mrp?: number;
  rate?: number;
  cgst_per?: number;
  sgst_per?: number;
  hsn_code?: string;
  packaging?: string;
  strength?: string;
}) {
  if (!item.name || !item.name.trim()) return;
  const cleanName = item.name.trim();
  const db = await dbManager.getConnection();

  try {
    const existing = await db.get(
      'SELECT id, mrp, hsn_code, manufacturer FROM medicines WHERE LOWER(name) = LOWER(?) LIMIT 1',
      cleanName
    );

    if (!existing) {
      await db.run(
        `INSERT INTO medicines (name, manufacturer, generic_name, mrp, cgst_per, sgst_per, hsn_code, packaging, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'app_user')`,
        [
          cleanName,
          item.manufacturer || null,
          item.generic_name || null,
          item.mrp || 0,
          item.cgst_per || 0,
          item.sgst_per || 0,
          item.hsn_code || null,
          item.packaging || null
        ]
      );
    } else {
      // Update missing or non-zero fields
      await db.run(
        `UPDATE medicines SET
          mrp = CASE WHEN ? > 0 THEN ? ELSE mrp END,
          rate = CASE WHEN ? > 0 THEN ? ELSE rate END,
          manufacturer = COALESCE(?, manufacturer),
          hsn_code = COALESCE(?, hsn_code)
         WHERE id = ?`,
        [
          item.mrp || 0, item.mrp || 0,
          item.rate || 0, item.rate || 0,
          item.manufacturer || null,
          item.hsn_code || null,
          existing.id
        ]
      );
    }
  } catch (err: any) {
    console.warn('[MasterSeed] Failed to upsert master medicine:', cleanName, err.message);
  }
}
