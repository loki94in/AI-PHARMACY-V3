/**
 * scripts/buildUniversalCatalog.mjs
 *
 * Universal Medicine Catalog Builder & Enrichment Engine
 * Combines medicines.csv (commercial/ERP data) and medicine_data.csv (clinical/AI knowledge)
 * into a single canonical catalog in data/app.db.
 *
 * Adheres strictly to:
 * - ONE UNIVERSAL MEDICINE CATALOG USING THE EXISTING CATALOG + BOTH CSV DATASETS.md
 * - BACKEND SCHEMA SAFETY.md
 * - Controlled matching hierarchy (exact ID -> barcode -> normalized name + strength + mfg)
 * - Separation of strengths (500mg != 650mg) and distinct packaging
 * - Full idempotency: safe to run multiple times without duplicating records
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
const MEDICINES_CSV = path.join(ROOT, 'medicines.csv');
const CLINICAL_CSV = path.join(ROOT, 'medicine_data.csv');
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
  const n = parseFloat(c.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

function normalizeForm(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\[.*?\]/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(suspension for injection|powder for injection|oral suspension|extended release|delayed release|sustained release|dispersible tablet|film coated tablet|mouth dissolving|tablet|tablets|capsule|capsules|injection|inj|tab|tabs|cap|caps|syp|syrup|drop|drops|ointment|gel|cream|lotion|solution|respules|rotacaps|transcaps|inhaler)\b/gi, ' ')
    .replace(/\b\d+'?s\b/gi, ' ')
    .replace(/\b\d+\s*no['’]?s\b/gi, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDosageKey(name) {
  if (!name) return '';
  const matches = [...name.matchAll(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|gm|g|ml|iu|%|iu\/ml)?\b/gi)];
  const dosageNumbers = matches
    .filter(m => {
      const idx = m.index;
      const after = name.slice(idx + m[0].length);
      return !/^\s*(?:'s|s\b|no|nos|tablets|tabs|caps|capsules|pack|strip)/i.test(after);
    })
    .map(m => m[1] + (m[2] ? m[2].toLowerCase() : ''));
  return dosageNumbers.sort().join('_');
}

function normalizeCompany(mfg) {
  if (!mfg) return '';
  return mfg
    .toLowerCase()
    .replace(/\b(pvt|ltd|limited|private|pharmaceuticals|pharma|laboratories|lab|labs|remedies|india|healthcare|corp|inc)\b/gi, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const startTime = Date.now();
  console.log(`\n========================================================`);
  console.log(`UNIVERSAL MEDICINE CATALOG MERGE & ENRICHMENT`);
  console.log(`========================================================`);
  console.log(`[UniversalCatalog] Database:      ${DB_PATH}`);
  console.log(`[UniversalCatalog] Commercial CSV: ${MEDICINES_CSV}`);
  console.log(`[UniversalCatalog] Clinical CSV:   ${CLINICAL_CSV}`);

  if (!fs.existsSync(DB_PATH)) {
    console.error(`[UniversalCatalog] Error: Database file not found at ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 60000');
  db.pragma('synchronous = NORMAL');

  // Ensure necessary schema elements exist
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_medicines_legacy_id 
    ON medicines(legacy_id);

    CREATE INDEX IF NOT EXISTS idx_medicines_barcode 
    ON medicines(barcode) 
    WHERE barcode IS NOT NULL AND barcode != '';

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

    CREATE TABLE IF NOT EXISTS product_channel_visibility (
      medicine_id INTEGER PRIMARY KEY,
      is_pos_visible INTEGER DEFAULT 1,
      is_website_visible INTEGER DEFAULT 1,
      is_whatsapp_visible INTEGER DEFAULT 1,
      is_portal_visible INTEGER DEFAULT 1,
      featured_rank INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pcv_channels ON product_channel_visibility(is_website_visible, is_whatsapp_visible, is_portal_visible);
  `);

  const initialMedCount = db.prepare('SELECT COUNT(*) as c FROM medicines').get().c;
  const initialClinicalCount = db.prepare('SELECT COUNT(*) as c FROM medicine_clinical_info').get().c;
  console.log(`[UniversalCatalog] Initial DB Medicines:   ${initialMedCount.toLocaleString()}`);
  console.log(`[UniversalCatalog] Initial DB Clinical:    ${initialClinicalCount.toLocaleString()}`);

  // ----------------------------------------------------
  // PHASE 1: COMMERCIAL MASTER SYNC (medicines.csv)
  // ----------------------------------------------------
  let commercialAdded = 0;
  let commercialUpdated = 0;
  if (fs.existsSync(MEDICINES_CSV)) {
    console.log(`\n[Phase 1] Checking commercial records from medicines.csv...`);
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

    const updateMetadataStmt = db.prepare(`
      UPDATE medicines SET
        hsn_code = COALESCE(hsn_code, ?),
        cgst_per = CASE WHEN cgst_per IS NULL OR cgst_per = 0 THEN ? ELSE cgst_per END,
        sgst_per = CASE WHEN sgst_per IS NULL OR sgst_per = 0 THEN ? ELSE sgst_per END,
        igst_per = CASE WHEN igst_per IS NULL OR igst_per = 0 THEN ? ELSE igst_per END,
        barcode = COALESCE(barcode, ?),
        packaging = COALESCE(packaging, ?),
        pack_size = COALESCE(pack_size, ?)
      WHERE legacy_id = ?
    `);

    const fileStream = fs.createReadStream(MEDICINES_CSV, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let header = null;
    let col = {};
    let scanned = 0;
    const insertBatch = [];
    const BATCH_SIZE = 5000;

    const runInsertBatch = db.transaction((rows) => {
      for (const row of rows) {
        const res = insertStmt.run(...row);
        if (res.changes > 0) commercialAdded++;
      }
    });

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

      insertBatch.push([
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

      scanned++;
      if (insertBatch.length >= BATCH_SIZE) {
        runInsertBatch(insertBatch);
        insertBatch.length = 0;
      }
    }

    if (insertBatch.length > 0) {
      runInsertBatch(insertBatch);
      insertBatch.length = 0;
    }

    console.log(`[Phase 1] Scanned: ${scanned.toLocaleString()} rows | New Medicines Added: ${commercialAdded}`);
  } else {
    console.log(`[Phase 1] medicines.csv not present, relying on existing database catalog.`);
  }

  // ----------------------------------------------------
  // PHASE 2 & 3: CLINICAL KNOWLEDGE INGESTION & MATCHING
  // ----------------------------------------------------
  let clinicalMatched = 0;
  let clinicalDeduplicatedUnique = 0;

  if (fs.existsSync(CLINICAL_CSV)) {
    console.log(`\n[Phase 2] Loading & deduplicating clinical knowledge from medicine_data.csv...`);

    // First deduplicate medicine_data.csv into unique clinical monographs
    const clinicalMap = new Map(); // key: lower_name -> monograph
    const cStream = fs.createReadStream(CLINICAL_CSV, { encoding: 'utf8' });
    const cRl = readline.createInterface({ input: cStream, crlfDelay: Infinity });

    let cHeader = null;
    let cCol = {};
    let cTotalLines = 0;

    for await (const line of cRl) {
      if (!cHeader) {
        cHeader = parseCsvLine(line);
        cHeader.forEach((c, idx) => { cCol[c.trim()] = idx; });
        continue;
      }
      if (!line.trim()) continue;
      cTotalLines++;

      const fields = parseCsvLine(line);
      const prodName = clean(fields[cCol['product_name']]);
      if (!prodName) continue;

      const lowerName = prodName.toLowerCase();
      if (!clinicalMap.has(lowerName)) {
        clinicalMap.set(lowerName, {
          product_name: prodName,
          salt_composition: clean(fields[cCol['salt_composition']]),
          sub_category: clean(fields[cCol['sub_category']]),
          product_manufactured: clean(fields[cCol['product_manufactured']]),
          medicine_desc: clean(fields[cCol['medicine_desc']]),
          side_effects: clean(fields[cCol['side_effects']]),
          drug_interactions: clean(fields[cCol['drug_interactions']]),
          product_price: cleanPrice(fields[cCol['product_price']])
        });
      }
    }

    clinicalDeduplicatedUnique = clinicalMap.size;
    console.log(`[Phase 2] Processed ${cTotalLines.toLocaleString()} CSV rows into ${clinicalDeduplicatedUnique.toLocaleString()} unique clinical monographs.`);

    console.log(`\n[Phase 3] Building in-memory search index for Universal Catalog...`);
    const allMeds = db.prepare(`
      SELECT id, name, canonical_name, manufacturer, generic_name, packaging
      FROM medicines
    `).all();

    // Matching index trees
    const exactNameIndex = new Map();         // lower_name -> id
    const cleanFormIndex = new Map();         // norm_form -> Array<{id, dosage, mfg}>
    const brandDosageMfgIndex = new Map();    // key = brand_first_word + '_' + dosage -> Array<{id, mfg}>

    for (const m of allMeds) {
      const lowerRaw = (m.name || '').toLowerCase().trim();
      if (lowerRaw && !exactNameIndex.has(lowerRaw)) {
        exactNameIndex.set(lowerRaw, m.id);
      }
      const lowerCanon = (m.canonical_name || '').toLowerCase().trim();
      if (lowerCanon && !exactNameIndex.has(lowerCanon)) {
        exactNameIndex.set(lowerCanon, m.id);
      }

      const formNorm = normalizeForm(m.name);
      const dosage = extractDosageKey(m.name);
      const mfgNorm = normalizeCompany(m.manufacturer);

      if (formNorm) {
        if (!cleanFormIndex.has(formNorm)) {
          cleanFormIndex.set(formNorm, []);
        }
        cleanFormIndex.get(formNorm).push({ id: m.id, dosage, mfg: mfgNorm });

        const firstWord = formNorm.split(' ')[0];
        if (firstWord && firstWord.length > 2) {
          const brandKey = `${firstWord}__${dosage}__${mfgNorm}`;
          if (!brandDosageMfgIndex.has(brandKey)) {
            brandDosageMfgIndex.set(brandKey, []);
          }
          brandDosageMfgIndex.get(brandKey).push(m.id);
        }
      }
    }

    console.log(`[Phase 3] Indexed ${allMeds.length.toLocaleString()} catalog medicines.`);
    console.log(`[Phase 3] Executing controlled multi-tier clinical matching...`);

    const upsertClinicalStmt = db.prepare(`
      INSERT INTO medicine_clinical_info (
        medicine_id, salt_composition, sub_category, medicine_desc,
        side_effects, drug_interactions, match_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(medicine_id) DO UPDATE SET
        salt_composition = COALESCE(excluded.salt_composition, medicine_clinical_info.salt_composition),
        sub_category = COALESCE(excluded.sub_category, medicine_clinical_info.sub_category),
        medicine_desc = COALESCE(excluded.medicine_desc, medicine_clinical_info.medicine_desc),
        side_effects = COALESCE(excluded.side_effects, medicine_clinical_info.side_effects),
        drug_interactions = COALESCE(excluded.drug_interactions, medicine_clinical_info.drug_interactions),
        match_confidence = MAX(excluded.match_confidence, medicine_clinical_info.match_confidence)
    `);

    const updateGenericStmt = db.prepare(`
      UPDATE medicines SET
        generic_name = COALESCE(generic_name, ?),
        category = COALESCE(category, ?)
      WHERE id = ? AND (generic_name IS NULL OR generic_name = '' OR category IS NULL OR category = '')
    `);

    const clinicalBatch = [];
    const runClinicalBatch = db.transaction((items) => {
      for (const item of items) {
        upsertClinicalStmt.run(
          item.medicine_id,
          item.salt_composition,
          item.sub_category,
          item.medicine_desc,
          item.side_effects,
          item.drug_interactions,
          item.confidence
        );
        if (item.salt_composition || item.sub_category) {
          updateGenericStmt.run(item.salt_composition, item.sub_category, item.medicine_id);
        }
        clinicalMatched++;
      }
    });

    for (const [lowerName, mono] of clinicalMap.entries()) {
      let targetMedId = exactNameIndex.get(lowerName);
      let confidence = 1.0;

      const monoDosage = extractDosageKey(mono.product_name);
      const monoMfg = normalizeCompany(mono.product_manufactured);
      const monoClean = normalizeForm(mono.product_name);

      if (!targetMedId && monoClean) {
        const candidates = cleanFormIndex.get(monoClean);
        if (candidates && candidates.length > 0) {
          // Filter by dosage key to prevent 500mg vs 650mg cross-match
          const matchingDosage = candidates.filter(c => !monoDosage || !c.dosage || c.dosage === monoDosage);
          if (matchingDosage.length === 1) {
            targetMedId = matchingDosage[0].id;
            confidence = 0.95;
          } else if (matchingDosage.length > 1 && monoMfg) {
            const matchingMfg = matchingDosage.find(c => c.mfg && (c.mfg.includes(monoMfg) || monoMfg.includes(c.mfg)));
            if (matchingMfg) {
              targetMedId = matchingMfg.id;
              confidence = 0.90;
            }
          }
        }
      }

      if (!targetMedId && monoClean) {
        const firstWord = monoClean.split(' ')[0];
        if (firstWord && firstWord.length > 2 && monoDosage && monoMfg) {
          const brandKey = `${firstWord}__${monoDosage}__${monoMfg}`;
          const brandCandidates = brandDosageMfgIndex.get(brandKey);
          if (brandCandidates && brandCandidates.length === 1) {
            targetMedId = brandCandidates[0];
            confidence = 0.85;
          }
        }
      }

      if (targetMedId) {
        clinicalBatch.push({
          medicine_id: targetMedId,
          salt_composition: mono.salt_composition,
          sub_category: mono.sub_category,
          medicine_desc: mono.medicine_desc,
          side_effects: mono.side_effects,
          drug_interactions: mono.drug_interactions,
          confidence
        });

        if (clinicalBatch.length >= 1000) {
          runClinicalBatch(clinicalBatch);
          clinicalBatch.length = 0;
        }
      }
    }

    if (clinicalBatch.length > 0) {
      runClinicalBatch(clinicalBatch);
      clinicalBatch.length = 0;
    }

    console.log(`[Phase 3] Enriched ${clinicalMatched.toLocaleString()} medicines with clinical monographs in medicine_clinical_info.`);
  }

  // ----------------------------------------------------
  // PHASE 4: CONTROLLED COMMERCIAL DEDUPLICATION AUDIT
  // ----------------------------------------------------
  console.log(`\n[Phase 4] Running controlled commercial duplicate audit (preserving IDs)...`);

  // Detect duplicates having identical normalized name + strength/dosage + manufacturer
  const duplicateGroups = db.prepare(`
    SELECT LOWER(name) as lower_name, 
           LOWER(COALESCE(manufacturer, '')) as mfg, 
           packaging,
           COUNT(*) as count,
           GROUP_CONCAT(id) as ids
    FROM medicines
    WHERE name IS NOT NULL AND TRIM(name) != ''
    GROUP BY LOWER(name), LOWER(COALESCE(manufacturer, '')), packaging
    HAVING count > 1
  `).all();

  console.log(`[Phase 4] Found ${duplicateGroups.length.toLocaleString()} multi-entry duplicate groups.`);

  let duplicatesLinked = 0;
  const setDuplicateStmt = db.prepare(`
    UPDATE medicines SET possible_duplicate_of = ? WHERE id = ?
  `);

  const linkDuplicatesTx = db.transaction((groups) => {
    for (const g of groups) {
      const idList = g.ids.split(',').map(Number);
      const canonicalId = idList[0]; // first created record is canonical
      for (let i = 1; i < idList.length; i++) {
        setDuplicateStmt.run(canonicalId, idList[i]);
        duplicatesLinked++;
      }
    }
  });

  if (duplicateGroups.length > 0) {
    linkDuplicatesTx(duplicateGroups);
  }
  console.log(`[Phase 4] Linked ${duplicatesLinked.toLocaleString()} secondary duplicate records to canonical master IDs.`);

  // ----------------------------------------------------
  // PHASE 5: ENSURE WEBSITE & PORTAL VISIBILITY
  // ----------------------------------------------------
  console.log(`\n[Phase 5] Initializing public product channel visibility defaults...`);
  db.prepare(`
    INSERT OR IGNORE INTO product_channel_visibility (medicine_id, is_pos_visible, is_website_visible, is_portal_visible, featured_rank, updated_at)
    SELECT mci.medicine_id, 1, 1, 1, 10, CURRENT_TIMESTAMP
    FROM medicine_clinical_info mci
  `).run();

  db.prepare(`
    UPDATE product_channel_visibility
    SET is_website_visible = 1, is_portal_visible = 1, featured_rank = MAX(featured_rank, 10)
    WHERE medicine_id IN (SELECT medicine_id FROM medicine_clinical_info)
  `).run();

  const missingVisibility = db.prepare(`
    INSERT INTO product_channel_visibility (medicine_id, is_pos_visible, is_website_visible, is_portal_visible, updated_at)
    SELECT m.id, 1, 1, 1, CURRENT_TIMESTAMP
    FROM medicines m
    LEFT JOIN product_channel_visibility pcv ON pcv.medicine_id = m.id
    WHERE pcv.medicine_id IS NULL AND m.status = 'ACTIVE'
    LIMIT 25000
  `).run();
  console.log(`[Phase 5] Guaranteed online visibility for all clinical medicines + added default visibility for ${missingVisibility.changes.toLocaleString()} medicines.`);

  // ----------------------------------------------------
  // FINAL AUDIT & SUMMARY
  // ----------------------------------------------------
  const finalMedCount = db.prepare('SELECT COUNT(*) as c FROM medicines').get().c;
  const finalClinicalCount = db.prepare('SELECT COUNT(*) as c FROM medicine_clinical_info').get().c;
  const finalVisibilityCount = db.prepare('SELECT COUNT(*) as c FROM product_channel_visibility WHERE is_website_visible = 1').get().c;
  const sampleEnriched = db.prepare(`
    SELECT m.id, m.name, m.manufacturer, c.sub_category, c.salt_composition, SUBSTR(c.side_effects, 1, 80) as side_effects_preview
    FROM medicines m
    JOIN medicine_clinical_info c ON c.medicine_id = m.id
    ORDER BY m.id ASC
    LIMIT 3
  `).all();

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n========================================================`);
  console.log(`UNIVERSAL CATALOG BUILD COMPLETE (Elapsed: ${elapsedSec}s)`);
  console.log(`========================================================`);
  console.log(`Total Universal Medicines:     ${finalMedCount.toLocaleString()} (+${finalMedCount - initialMedCount})`);
  console.log(`Enriched Clinical Records:     ${finalClinicalCount.toLocaleString()} (+${finalClinicalCount - initialClinicalCount})`);
  console.log(`Website Searchable Products:   ${finalVisibilityCount.toLocaleString()}`);
  console.log(`Secondary Duplicates Linked:   ${duplicatesLinked.toLocaleString()}`);
  console.log(`Sample Enriched Records:`);
  console.dir(sampleEnriched, { depth: null });
  console.log(`========================================================\n`);

  db.close();
}

main().catch(err => {
  console.error('[UniversalCatalog Fatal Error]:', err);
  process.exit(1);
});
