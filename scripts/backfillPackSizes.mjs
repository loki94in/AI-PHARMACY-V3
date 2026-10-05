/**
backfillPackSizes.mjs — fill a MISSING medicines.pack_size from the owner's own old retailer export.

Source of truth (no invented numbers):
  1. medicines.csv `divisor` (units per pack) matched by EXACT whitespace-collapsed name
     (medicine_name or medicine_name_detailed). Single-pack types (BOTTLE, TUBE, BOX, INJECTION...)
     carry divisor 1 = a real "sold as one piece" pack size. A STRIP with divisor 1 and packaging
     "0" is "unknown" in the old system and stays blank. Same name with different divisors = skipped.
  2. Names that state the size themselves: "STRIP OF 15", "45S" / "15'S".
     A bare "500 TAB" is a strength and is NOT read.

Safety: only rows whose pack_size is NULL/0 are touched (a saved size is NEVER altered); only
medicines.pack_size is written; DRY RUN by default.

Usage: node scripts/backfillPackSizes.mjs [--apply] [--db path] [--csv path]
*/
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { parse } = require('csv-parse');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const DB_PATH = arg('--db') || process.env.DB_PATH || path.join(ROOT, 'data', 'app.db');
const CSV_FILE = arg('--csv') || path.join(ROOT, 'medicines.csv');

const norm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
const SINGLE_TYPES = new Set(['BOTTLE', 'TUBE', 'BOX', 'INJECTION', 'PACKET', 'VIAL', 'SACHET', 'AMPOULE', 'JAR', 'CAN', 'PEN', 'KIT']);

/** Size stated inside the name itself, or null. */
function packSizeFromName(name) {
  const n = norm(name);
  const m = n.match(/\bSTRIP OF (\d{1,3})\b/) || n.match(/\b(\d{1,3}) ?(?:'S|S)\b/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return v >= 1 && v <= 120 ? v : null;
}

// Opt-in (--single-pack-by-name, owner rule 2026-10-05: bottles/tubes/tins are single packs).
// Only names with a non-strip product word and NO tablet/capsule/strip word qualify.
const SINGLE_BY_NAME = process.argv.includes('--single-pack-by-name');
const SINGLE_WORDS = /\b(CREAM|OIL|GEL|DROPS?|SOAP|SYRUP|SYP|SUSPENSION|EXPECTORANT|TONIC|LOTION|LOZION|OINT|SHAMPOO|TIN|BALM|OINTMENT|POWDER|SYRINGE|SYRANGE|SPRAY|FACEWASH|BOTTLE|TUBE|JAR|LIQUID|SOLUTION|CONDOM|DROP)\b/;
const STRIP_WORDS = /\b(TAB|TABS|TABLET|TABLETS|CAP|CAPS|CAPSULE|CAPSULES|STRIP|PILLS?|VATI|SOFTGEL|SACHET|SACHETS|SUPPOSITORY|SUPPOSITORIES|SUPP|RESPULE|RESPULES|INHALER|ROTACAP|ROTACAPS|PESSARY)\b/;
const isSinglePackName = (name) => { const n = norm(name); return SINGLE_WORDS.test(n) && !STRIP_WORDS.test(n); };

async function loadCsvSizes() {
  const sizes = new Map(); // key -> divisor | null (conflict / unknown)
  const parser = fs.createReadStream(CSV_FILE).pipe(parse({ columns: true, relax_quotes: true, relax_column_count: true, skip_records_with_error: true }));
  for await (const row of parser) {
    const type = norm(row.itemtype);
    const div = Number(String(row.divisor || '').trim());
    if (!Number.isInteger(div) || div < 1 || div > 500) continue;
    const packaging = String(row.medicine_packaging || '').trim();
    let size = null;
    if (type === 'STRIP') {
      if (div > 1) size = div;                           // real strip size
      else if (/^1\b/.test(packaging)) size = 1;          // explicitly 1 per pack
      else continue;                                      // divisor 1 + packaging "0" = unknown in old system
    } else if (SINGLE_TYPES.has(type)) {
      if (div !== 1) continue;
      size = 1;
    } else continue;                                      // shifted/dirty row
    for (const k of [norm(row.medicine_name), norm(row.medicine_name_detailed)]) {
      if (!k) continue;
      if (!sizes.has(k)) sizes.set(k, size);
      else if (sizes.get(k) !== size) sizes.set(k, null); // same name, different sizes -> ambiguous
    }
  }
  return sizes;
}

const csvSizes = fs.existsSync(CSV_FILE) ? await loadCsvSizes() : new Map();
console.log(`[csv] ${csvSizes.size} names with a clean pack size (${CSV_FILE})`);

const db = new Database(DB_PATH, { readonly: !APPLY, fileMustExist: true });
const rows = db.prepare(`SELECT id, name FROM medicines WHERE pack_size IS NULL OR TRIM(CAST(pack_size AS TEXT)) IN ('', '0')`).all();
const stats = { total: rows.length, fromCsv: 0, fromName: 0, singleByName: 0, stillBlank: 0 };
const updates = [];
for (const r of rows) {
  const k = norm(r.name);
  let size = csvSizes.get(k);
  if (size) stats.fromCsv++;
  else {
    size = packSizeFromName(r.name);
    if (size) stats.fromName++;
    else if (SINGLE_BY_NAME && isSinglePackName(r.name)) { size = 1; stats.singleByName++; }
  }
  if (size) updates.push([size, r.id]); else stats.stillBlank++;
}
console.log(APPLY ? '[APPLY]' : '[DRY RUN — nothing written]', DB_PATH, stats);

if (APPLY && updates.length) {
  const upd = db.prepare(`UPDATE medicines SET pack_size = ? WHERE id = ? AND (pack_size IS NULL OR TRIM(CAST(pack_size AS TEXT)) IN ('', '0'))`);
  db.transaction(() => { for (const u of updates) upd.run(u[0], u[1]); })();
  console.log(`updated ${updates.length} medicines`);
}
