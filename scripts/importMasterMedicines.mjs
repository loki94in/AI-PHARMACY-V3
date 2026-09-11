/**
 * scripts/importMasterMedicines.mjs
 *
 * High-performance bulk importer for medicines.csv into data/app.db.
 * Maps rich metadata: name, manufacturer, packaging, HSN, GST, barcodes, racks, etc.
 * Idempotent via unique legacy_id (medicine_id) index.
 *
 * Usage: node scripts/importMasterMedicines.mjs
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CSV_FILE = path.join(ROOT, 'medicines.csv');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'app.db');

function clean(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return (!t || t.toLowerCase() === 'null') ? null : t;
}

function cleanNum(v) {
  const c = clean(v);
  if (!c) return 0.0;
  const n = parseFloat(c);
  return isNaN(n) ? 0.0 : n;
}

function cleanPrice(v) {
  const c = clean(v);
  if (!c) return null;
  const n = parseFloat(c);
  return isNaN(n) ? null : n;
}

function parseCsvLine(line) {
  const result = [];
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

async function main() {
  console.log(`[ImportMaster] Target Database: ${DB_PATH}`);
  console.log(`[ImportMaster] Source CSV: ${CSV_FILE}`);

  if (!fs.existsSync(CSV_FILE)) {
    console.error(`[ImportMaster] Error: File not found: ${CSV_FILE}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 60000');
  db.pragma('synchronous = NORMAL');

  // Ensure unique index on legacy_id for fast idempotent deduplication
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_medicines_legacy_id 
    ON medicines(legacy_id) 
    WHERE legacy_id IS NOT NULL;
  `);

  const initialCount = db.prepare('SELECT COUNT(*) as c FROM medicines').get().c;
  console.log(`[ImportMaster] Current medicines count in database: ${initialCount}`);

  const insertStmt = db.prepare(`
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

  const insertBatch = db.transaction((rows) => {
    for (const row of rows) {
      insertStmt.run(...row);
    }
  });

  const fileStream = fs.createReadStream(CSV_FILE, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let header = null;
  let col = {};
  let totalRead = 0;
  let batch = [];
  const BATCH_SIZE = 5000;
  const startTime = Date.now();

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      header.forEach((c, idx) => { col[c.trim()] = idx; });
      continue;
    }
    if (!line.trim()) continue;

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

    batch.push([
      name,
      name,
      name.toLowerCase(),
      mfg,
      mkt,
      pkg,
      pkg,
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

    totalRead++;
    if (batch.length >= BATCH_SIZE) {
      insertBatch(batch);
      batch = [];
      if (totalRead % 25000 === 0) {
        console.log(`[ImportMaster] Processed ${totalRead} rows...`);
      }
    }
  }

  if (batch.length > 0) {
    insertBatch(batch);
    batch = [];
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const finalCount = db.prepare('SELECT COUNT(*) as c FROM medicines').get().c;
  const mfgCount = db.prepare('SELECT COUNT(DISTINCT manufacturer) as c FROM medicines WHERE manufacturer IS NOT NULL').get().c;

  console.log(`\n[ImportMaster] === Import Complete ===`);
  console.log(`Total scanned rows: ${totalRead}`);
  console.log(`Previous DB count:  ${initialCount}`);
  console.log(`Final DB count:     ${finalCount} (+${finalCount - initialCount})`);
  console.log(`Unique companies:   ${mfgCount}`);
  console.log(`Elapsed time:       ${durationSec} seconds`);

  // Run a quick index query test
  const tQuery = Date.now();
  const testResults = db.prepare(`
    SELECT id, name, manufacturer, packaging, hsn_code, cgst_per, sgst_per, sell_price 
    FROM medicines 
    WHERE name LIKE 'PARACETAMOL%' 
    LIMIT 5
  `).all();
  const queryDuration = Date.now() - tQuery;

  console.log(`\nPrefix search test ("PARACETAMOL%"): executed in ${queryDuration}ms (${testResults.length} matches)`);
  testResults.forEach(r => {
    console.log(` - [${r.id}] ${r.name} | Mfg: ${r.manufacturer || 'N/A'} | Pack: ${r.packaging || 'N/A'}`);
  });

  db.close();
}

main().catch((err) => {
  console.error('[ImportMaster] Fatal error during import:', err);
  process.exit(1);
});
