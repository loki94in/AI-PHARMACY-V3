import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';

// Utility to clean / normalize medicine names for matching
function cleanName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\[.*?\]/g, '') // remove bracketed text like [Sun Pharma]
    .replace(/\(.*?\)/g, '') // remove parenthesized text like (40IU)
    .replace(/\b(suspension for injection|powder for injection|oral suspension|extended release|delayed release|sustained release|dispersible tablet|film coated tablet|mouth dissolving|tablet|tablets|capsule|capsules|injection|inj|tab|tabs|cap|caps|syp|syrup|drop|drops|ointment|gel|cream|lotion|solution|respules|rotacaps|transcaps|inhaler)\b/gi, ' ')
    .replace(/\b\d+(\.\d+)?\s*(mg|ml|mcg|iu|gm|g|%|iu\/ml)\b/gi, ' ') // remove units/strengths
    .replace(/\b\d+'?s\b/gi, ' ') // remove 10's, 10s
    .replace(/\b\d+\s*no['’]?s\b/gi, ' ') // remove 10 no's
    .replace(/[^a-z0-9]/g, ' ') // alphanumeric only
    .replace(/\s+/g, ' ')
    .trim();
}

async function run() {
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const maxRows = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

  const dbPath = path.resolve('data/app.db');
  const csvPath = path.resolve('medicine_data.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('Error: medicine_data.csv not found at', csvPath);
    process.exit(1);
  }

  console.log('[Enrichment] Connecting to database:', dbPath);
  const db = new Database(dbPath);

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS medicine_clinical_info (
      medicine_id INTEGER PRIMARY KEY,
      salt_composition TEXT,
      sub_category TEXT,
      medicine_desc TEXT,
      side_effects TEXT,
      drug_interactions TEXT,
      match_confidence REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_clinical_salt ON medicine_clinical_info(salt_composition);
    CREATE INDEX IF NOT EXISTS idx_clinical_subcategory ON medicine_clinical_info(sub_category);
  `);

  console.log('[Enrichment] Loading local medicines into memory index...');
  const startLoad = Date.now();
  const allMeds = db.prepare('SELECT id, name, canonical_name, generic_name FROM medicines').all();
  console.log(`[Enrichment] Loaded ${allMeds.length} medicines in ${((Date.now() - startLoad) / 1000).toFixed(1)}s`);

  // Build indexes for fast lookup
  const exactNameMap = new Map(); // lowercase raw name -> medId
  const cleanNameMap = new Map(); // clean name -> medId
  const brandWordMap = new Map(); // first 2 words -> Array of medIds

  for (const m of allMeds) {
    const rawLower = (m.name || '').toLowerCase().trim();
    if (rawLower && !exactNameMap.has(rawLower)) {
      exactNameMap.set(rawLower, m.id);
    }
    const canonLower = (m.canonical_name || '').toLowerCase().trim();
    if (canonLower && !exactNameMap.has(canonLower)) {
      exactNameMap.set(canonLower, m.id);
    }

    const cleaned = cleanName(m.name);
    if (cleaned && !cleanNameMap.has(cleaned)) {
      cleanNameMap.set(cleaned, m.id);
    }
    const canonCleaned = cleanName(m.canonical_name);
    if (canonCleaned && !cleanNameMap.has(canonCleaned)) {
      cleanNameMap.set(canonCleaned, m.id);
    }

    // First two significant words
    const words = cleaned.split(' ').filter(w => w.length > 2).slice(0, 2).join(' ');
    if (words) {
      if (!brandWordMap.has(words)) brandWordMap.set(words, []);
      brandWordMap.get(words).push(m.id);
    }
  }

  console.log(`[Enrichment] Index built. Exact names: ${exactNameMap.size}, Clean names: ${cleanNameMap.size}`);
  console.log('[Enrichment] Streaming medicine_data.csv...');

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO medicine_clinical_info
    (medicine_id, salt_composition, sub_category, medicine_desc, side_effects, drug_interactions, match_confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const updateMedGenericStmt = db.prepare(`
    UPDATE medicines
    SET generic_name = ?
    WHERE id = ? AND (generic_name IS NULL OR generic_name = '')
  `);

  let processed = 0;
  let matched = 0;
  const batch = [];
  const BATCH_SIZE = 1000;

  const parser = fs.createReadStream(csvPath).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true
    })
  );

  const insertBatch = db.transaction((items) => {
    for (const item of items) {
      insertStmt.run(
        item.medicine_id,
        item.salt_composition,
        item.sub_category,
        item.medicine_desc,
        item.side_effects,
        item.drug_interactions,
        item.match_confidence
      );
      if (item.salt_composition) {
        updateMedGenericStmt.run(item.salt_composition, item.medicine_id);
      }
    }
  });

  const startTime = Date.now();

  for await (const row of parser) {
    processed++;
    if (processed > maxRows) break;

    const prodName = row.product_name || '';
    if (!prodName) continue;

    const prodLower = prodName.toLowerCase().trim();
    let targetMedId = exactNameMap.get(prodLower);
    let confidence = 1.0;

    if (!targetMedId) {
      const prodClean = cleanName(prodName);
      targetMedId = cleanNameMap.get(prodClean);
      confidence = 0.9;

      if (!targetMedId) {
        const words = prodClean.split(' ').filter(w => w.length > 2).slice(0, 2).join(' ');
        const candidates = brandWordMap.get(words);
        if (candidates && candidates.length === 1) {
          targetMedId = candidates[0];
          confidence = 0.8;
        }
      }
    }

    if (targetMedId) {
      matched++;
      batch.push({
        medicine_id: targetMedId,
        salt_composition: (row.salt_composition || '').trim(),
        sub_category: (row.sub_category || '').trim(),
        medicine_desc: (row.medicine_desc || '').trim(),
        side_effects: (row.side_effects || '').trim(),
        drug_interactions: (row.drug_interactions || '').trim(),
        match_confidence: confidence
      });

      if (batch.length >= BATCH_SIZE) {
        insertBatch(batch);
        batch.length = 0;
      }
    }

    if (processed % 25000 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Enrichment] Processed ${processed.toLocaleString()} CSV rows... Matched: ${matched.toLocaleString()} (${elapsed}s)`);
    }
  }

  // Insert remaining batch
  if (batch.length > 0) {
    insertBatch(batch);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=================================================`);
  console.log(`[Enrichment Complete]`);
  console.log(`Total CSV Rows Scanned: ${processed.toLocaleString()}`);
  console.log(`Medicines Enriched in DB: ${matched.toLocaleString()}`);
  console.log(`Time Taken: ${duration} seconds`);
  console.log(`=================================================\n`);

  // Query sample enriched record
  const sample = db.prepare(`
    SELECT m.name, c.salt_composition, c.sub_category, c.side_effects, SUBSTR(c.medicine_desc, 1, 120) as desc_preview
    FROM medicine_clinical_info c
    JOIN medicines m ON c.medicine_id = m.id
    LIMIT 3
  `).all();
  console.log('[Enrichment] Sample enriched medicines in DB:');
  console.dir(sample, { depth: null });

  db.close();
}

run().catch(err => {
  console.error('[Enrichment Failed]:', err);
  process.exit(1);
});
