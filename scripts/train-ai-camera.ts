#!/usr/bin/env tsx

/**
 * scripts/train-ai-camera.ts
 * 
 * Trains the AI Camera system for high-accuracy medicine recognition:
 * 1. Imports the store's complete inventory catalog from CATALOG/Batch Stock.csv
 *    into the database `medicines` table so productNameFilterService can match any scanned product.
 * 2. Compiles a comprehensive custom vocabulary dictionary (`data/medicine_dict.txt`)
 *    from store medicines, salts/APIs, manufacturers, and pharma abbreviations for Tesseract.js.
 * 3. Builds regular expression patterns (`data/medicine_patterns.txt`) for dosage, form, and pack detection.
 * 4. Syncs learned OCR correction mappings into `data/ocr_corrections.json` and `ocr_corrections` table.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT_DIR = process.cwd();
const CSV_PATH = path.join(ROOT_DIR, 'CATALOG', 'Batch Stock.csv');
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const DICT_PATH = path.join(ROOT_DIR, 'data', 'medicine_dict.txt');
const PATTERNS_PATH = path.join(ROOT_DIR, 'data', 'medicine_patterns.txt');
const CORRECTIONS_PATH = path.join(ROOT_DIR, 'data', 'ocr_corrections.json');

function parseCSVLine(text: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function cleanMedicineName(raw: string): string {
  let cleaned = raw.replace(/\[.*?\]/g, ' ');
  cleaned = cleaned.replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ');
  return cleaned.replace(/\s+/g, ' ').trim();
}

async function trainAICamera() {
  console.log('='.repeat(75));
  console.log('       AI PHARMACY — AI CAMERA TRAINING & VOCABULARY COMPILATION');
  console.log('='.repeat(75));

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // --- Step 1: Read Store Inventory Catalog ---
  console.log(`\n[1/4] Reading store inventory catalog from ${CSV_PATH}...`);
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Catalog file not found: ${CSV_PATH}`);
  }

  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.split(/\r?\n/);
  
  const medicinesMap = new Map<string, {
    rawName: string;
    cleanName: string;
    pack: string;
    sch: string;
    gst: string;
    salts: string;
    mfg: string;
  }>();

  for (let i = 4; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.toLowerCase().includes('computed values') || line.toLowerCase().includes('total qty')) continue;
    const cols = parseCSVLine(line);
    if (cols.length < 2) continue;

    const rawName = (cols[0] || '').trim();
    const pack = (cols[1] || '').trim();
    const sch = (cols[2] || '').trim();
    const gst = (cols[3] || '').trim();
    const salts = (cols[4] || '').trim();
    const mfg = (cols[5] || '').trim();

    if (!rawName) continue;
    const cleanName = cleanMedicineName(rawName);
    if (!cleanName) continue;

    if (!medicinesMap.has(cleanName)) {
      medicinesMap.set(cleanName, { rawName, cleanName, pack, sch, gst, salts, mfg });
    }
  }

  console.log(`  Loaded ${medicinesMap.size} unique medicine catalog items.`);

  // --- Step 2: Seed SQLite `medicines` table ---
  console.log(`\n[2/4] Populating master medicines table in database...`);
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO medicines (
      name, api_reference, packaging, schedule_type, manufacturer, source
    ) VALUES (?, ?, ?, ?, ?, 'inventory_catalog')
  `);

  const insertMany = db.transaction((items: any[]) => {
    let inserted = 0;
    for (const item of items) {
      const res = insertStmt.run(
        item.cleanName,
        item.salts || null,
        item.pack || null,
        item.sch || null,
        item.mfg || null
      );
      if (res.changes > 0) inserted++;
    }
    return inserted;
  });

  const insertedCount = insertMany(Array.from(medicinesMap.values()));
  const totalInDb = db.prepare('SELECT count(1) as c FROM medicines').get() as { c: number };
  console.log(`  Inserted: ${insertedCount} new medicines.`);
  console.log(`  Total medicines in database now: ${totalInDb.c}`);

  // --- Step 3: Build Custom Tesseract Dictionary (`medicine_dict.txt`) ---
  console.log(`\n[3/4] Compiling AI Camera custom dictionary (${DICT_PATH})...`);
  const vocab = new Set<string>();

  // Add all words from medicine names, salts, and manufacturers
  for (const item of medicinesMap.values()) {
    const textBlobs = [item.cleanName, item.salts, item.mfg];
    for (const blob of textBlobs) {
      if (!blob) continue;
      const tokens = blob.toLowerCase().match(/[a-z0-9\+\-]+/g) || [];
      for (const t of tokens) {
        if (t.length >= 2 && !/^\d+$/.test(t)) {
          vocab.add(t);
        }
      }
    }
  }

  // Add common pharma terms and units
  const pharmaTerms = [
    'tablet', 'tablets', 'capsule', 'capsules', 'syrup', 'suspension', 'drops',
    'injection', 'infusion', 'ointment', 'cream', 'gel', 'lotion', 'solution',
    'inhaler', 'respules', 'sachet', 'powder', 'spray', 'lozenge', 'emulsion',
    'mg', 'ml', 'mcg', 'gm', 'iu', 'forte', 'plus', 'max', 'sr', 'xr', 'er', 'ds',
    'sugar-free', 'sugarfree', 'ayurvedic', 'homeopathic', 'pediatric', 'nasal',
    'ophthalmic', 'otic', 'oral', 'topical', 'mrp', 'exp', 'mfg', 'batch', 'b.no'
  ];
  pharmaTerms.forEach(t => vocab.add(t));

  // Add single characters commonly needed
  ['a', 'b', 'c', 'd', 'e', 'x', 'z', '1', '2', '3'].forEach(c => vocab.add(c));

  const sortedVocab = Array.from(vocab).sort();
  fs.writeFileSync(DICT_PATH, sortedVocab.join('\n'), 'utf-8');
  console.log(`  Compiled ${sortedVocab.length} unique terms into ${DICT_PATH}`);

  // Patterns file for Tesseract
  const patterns = [
    '\\d+\\.?\\d*\\s*mg',
    '\\d+\\.?\\d*\\s*ml',
    '\\d+\\.?\\d*\\s*gm',
    '\\d+\\.?\\d*\\s*mcg',
    '\\d+\\s*tablets?',
    '\\d+\\s*capsules?',
    '\\d+\\s*tabs?',
    '\\d+\\s*caps?',
    '\\d+\\s*ml\\s*drops?',
    '\\d+\\s*ml\\s*syrup',
    '[a-z0-9\\-]+\\s*forte',
    '[a-z0-9\\-]+\\s*plus',
    'b\\.no\\.?:?\\s*[a-z0-9\\-]+',
    'exp\\.?:?\\s*\\d{2}[\\/\\-]\\d{2,4}',
    'mrp\\s*₹?:?\\s*\\d+(?:\\.\\d{2})?'
  ];
  fs.writeFileSync(PATTERNS_PATH, patterns.join('\n'), 'utf-8');
  console.log(`  Updated regex patterns at ${PATTERNS_PATH}`);

  // --- Step 4: Seed OCR Correction Memory ---
  console.log(`\n[4/4] Updating AI Camera OCR correction memory...`);
  let existingCorrections: Array<{ ocr: string; correct: string; count: number }> = [];
  if (fs.existsSync(CORRECTIONS_PATH)) {
    try {
      existingCorrections = JSON.parse(fs.readFileSync(CORRECTIONS_PATH, 'utf-8'));
    } catch(e) {}
  }

  const correctionMap = new Map<string, { correct: string; count: number }>();
  for (const c of existingCorrections) {
    correctionMap.set(c.ocr.toLowerCase().trim(), { correct: c.correct, count: c.count });
  }

  // Add initial high-frequency learned pairs from our audit
  const learnedPairs = [
    { ocr: '28% - 4 bn 28v% 28% 20', correct: '2B 12' },
    { ocr: '2b 12 strip of 15 tablets', correct: '2B 12' },
    { ocr: 'medisuperdry adult diaper', correct: 'Adult Diaper Wetex' },
    { ocr: 'adult pull-ups', correct: 'Adult Diaper' },
    { ocr: 'ab phylline n', correct: 'AB Phylline N' },
    { ocr: 'ab flo n', correct: 'AB Flo N' },
    { ocr: 'a to z gold', correct: 'A To Z Gold' },
    { ocr: 'a to z ns', correct: 'A To Z NS' },
    { ocr: 'liveasy cotton roll', correct: 'Cotton 30 Cotton 20GM' }
  ];

  for (const p of learnedPairs) {
    const key = p.ocr.toLowerCase().trim();
    if (!correctionMap.has(key)) {
      correctionMap.set(key, { correct: p.correct, count: 5 });
    }
  }

  const finalCorrections = Array.from(correctionMap.entries()).map(([ocr, v]) => ({
    ocr,
    correct: v.correct,
    count: v.count
  }));

  fs.writeFileSync(CORRECTIONS_PATH, JSON.stringify(finalCorrections, null, 2), 'utf-8');
  
  // Also insert into SQLite ocr_corrections table
  const insertCorrection = db.prepare(`
    INSERT OR REPLACE INTO ocr_corrections (ocr, correct, count)
    VALUES (?, ?, ?)
  `);
  const insertAllCorr = db.transaction(() => {
    for (const c of finalCorrections) {
      insertCorrection.run(c.ocr, c.correct, c.count);
    }
  });
  insertAllCorr();

  console.log(`  Saved ${finalCorrections.length} OCR correction pairs to memory & database.`);

  db.close();

  console.log('\n' + '='.repeat(75));
  console.log('            AI CAMERA TRAINING COMPLETE!');
  console.log('='.repeat(75));
  console.log(`- Master Database: ${totalInDb.c} medicines searchable by Camera.`);
  console.log(`- Vocabulary:      ${sortedVocab.length} custom terms in ${DICT_PATH}.`);
  console.log(`- Pattern Rules:   ${patterns.length} regex dosage rules in ${PATTERNS_PATH}.`);
  console.log(`- Learned Pairs:   ${finalCorrections.length} correction mappings.`);
  console.log('='.repeat(75) + '\n');
}

trainAICamera().catch(err => {
  console.error('Fatal error during training:', err);
  process.exit(1);
});
