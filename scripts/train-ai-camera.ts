#!/usr/bin/env tsx

/**
 * scripts/train-ai-camera.ts
 * 
 * Trains the AI Camera system for high-accuracy medicine recognition:
 * 1. Loads master medicines (286,000+ items), generic salts, and manufacturers.
 * 2. Ingests OCR-extracted packaging text and product names from verified catalog images.
 * 3. Compiles an exhaustive custom vocabulary dictionary (`data/medicine_dict.txt`) for Tesseract.js.
 * 4. Builds regular expression patterns (`data/medicine_patterns.txt`) for dosage, form, and pack detection.
 * 5. Syncs learned OCR correction mappings into `data/ocr_corrections.json` and `ocr_corrections` table.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const DICT_PATH = path.join(ROOT_DIR, 'data', 'medicine_dict.txt');
const PATTERNS_PATH = path.join(ROOT_DIR, 'data', 'medicine_patterns.txt');
const CORRECTIONS_PATH = path.join(ROOT_DIR, 'data', 'ocr_corrections.json');

async function trainAICamera() {
  console.log('='.repeat(75));
  console.log('       AI PHARMACY — AI CAMERA TRAINING & VOCABULARY COMPILATION');
  console.log('='.repeat(75));

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const vocab = new Set<string>();

  // --- Step 1: Read Master Database Medicines ---
  console.log(`\n[1/4] Reading clean master medicines from database...`);
  const masterRows = db.prepare(`
    SELECT name, generic_name, api_reference, manufacturer 
    FROM medicines
  `).all() as Array<{ name: string; generic_name: string | null; api_reference: string | null; manufacturer: string | null }>;

  console.log(`  Loaded ${masterRows.length.toLocaleString()} master medicines from database.`);

  for (const row of masterRows) {
    const textBlobs = [row.name, row.generic_name, row.api_reference, row.manufacturer];
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

  // --- Step 2: Ingest Verified Packaging Images & OCR Text ---
  console.log(`\n[2/4] Ingesting verified packaging text from catalog images...`);
  const imageRows = db.prepare(`
    SELECT product_name, ocr_text 
    FROM catalog_images 
    WHERE is_active = 1 AND verification_status IN ('APPROVED', 'HIGH_CONFIDENCE')
  `).all() as Array<{ product_name: string; ocr_text: string | null }>;

  console.log(`  Loaded ${imageRows.length.toLocaleString()} verified catalog images.`);

  for (const img of imageRows) {
    const textBlobs = [img.product_name, img.ocr_text];
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

  // --- Step 3: Add Pharma Keywords & Common Packaging Tokens ---
  console.log(`\n[3/4] Compiling AI Camera custom dictionary (${DICT_PATH})...`);
  const pharmaTerms = [
    'tablet', 'tablets', 'capsule', 'capsules', 'syrup', 'suspension', 'drops',
    'injection', 'infusion', 'ointment', 'cream', 'gel', 'lotion', 'solution',
    'inhaler', 'respules', 'sachet', 'powder', 'spray', 'lozenge', 'emulsion',
    'mg', 'ml', 'mcg', 'gm', 'iu', 'forte', 'plus', 'max', 'sr', 'xr', 'er', 'ds',
    'sugar-free', 'sugarfree', 'ayurvedic', 'homeopathic', 'pediatric', 'nasal',
    'ophthalmic', 'otic', 'oral', 'topical', 'mrp', 'exp', 'mfg', 'batch', 'b.no',
    'strip', 'blister', 'bottle', 'alul-alu', 'pvcdc', 'strip-of'
  ];
  pharmaTerms.forEach(t => vocab.add(t));

  // Add single characters commonly needed
  ['a', 'b', 'c', 'd', 'e', 'x', 'z', '1', '2', '3'].forEach(c => vocab.add(c));

  const sortedVocab = Array.from(vocab).sort();
  fs.writeFileSync(DICT_PATH, sortedVocab.join('\n'), 'utf-8');
  console.log(`  Compiled ${sortedVocab.length.toLocaleString()} unique terms into ${DICT_PATH}`);

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

  const totalInDb = db.prepare('SELECT count(1) as c FROM medicines').get() as { c: number };
  db.close();

  console.log('\n' + '='.repeat(75));
  console.log('            AI CAMERA TRAINING COMPLETE!');
  console.log('='.repeat(75));
  console.log(`- Master Database: ${totalInDb.c.toLocaleString()} medicines searchable by Camera.`);
  console.log(`- Vocabulary:      ${sortedVocab.length.toLocaleString()} custom terms in ${DICT_PATH}.`);
  console.log(`- Pattern Rules:   ${patterns.length} regex dosage rules in ${PATTERNS_PATH}.`);
  console.log(`- Learned Pairs:   ${finalCorrections.length} correction mappings.`);
  console.log('='.repeat(75) + '\n');
}

trainAICamera().catch(err => {
  console.error('Fatal error during training:', err);
  process.exit(1);
});
