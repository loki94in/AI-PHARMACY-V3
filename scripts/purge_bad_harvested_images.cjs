const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const STATE_FILE = path.join(ROOT_DIR, 'data', 'top100_harvest_state.json');
const TARGET_FRONTEND = path.join(ROOT_DIR, 'frontend', 'public', 'products');
const TARGET_UPLOADS = path.join(ROOT_DIR, 'uploads', 'products');

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 30000');

function normalizeTokens(text) {
  if (!text) return '';
  return text
    .replace(/([a-zA-Z])(\d+)/g, '$1 $2')
    .replace(/(\d+)(mg|mcg|ml|gm|iu|%)\b/gi, '$1 $2');
}

const FORMULATION_MODIFIERS = new Set([
  'PLUS', 'FORTE', 'DS', 'DUO', 'COMBIKIT', 'COMBI', 'KIT', 'MAX', 'EXTRA',
  'DSR', 'D', 'DP', 'AP', 'SP', 'AM', 'AT', 'AZ', 'H', 'LS', 'DX', 'AX', 'CZ', 'CT',
  'LP', 'CV', 'KT', 'COLD', 'FLU', 'TZ', 'OZ', 'TG', 'CH', 'CL', 'AF',
  'SR', 'ER', 'CR', 'PR', 'MR', 'TR', 'XR', 'XL', 'LA',
  'DT', 'MD', 'SL', 'OD', 'F', 'RF', 'IR', 'SITA', 'CF', 'TC', 'P', 'M'
]);

function extractModifiers(name) {
  if (!name) return new Set();
  const clean = normalizeTokens(name).toUpperCase().replace(/[-_.,/()\[\]+]/g, ' ');
  const words = clean.split(/\s+/).filter(Boolean);
  const found = new Set();
  for (const w of words) {
    if (FORMULATION_MODIFIERS.has(w)) found.add(w);
  }
  return found;
}

function hasModifierConflict(name1, name2) {
  const m1 = extractModifiers(name1);
  const m2 = extractModifiers(name2);
  if (m1.size === 0 && m2.size === 0) return false;
  if (m1.size === 0 && m2.size > 0) return true;
  if (m2.size === 0 && m1.size > 0) return true;
  for (const m of m1) {
    if (!m2.has(m)) return true;
  }
  for (const m of m2) {
    if (!m1.has(m)) return true;
  }
  return false;
}

function extractStrengthTokens(name) {
  const norm = normalizeTokens(name).toUpperCase();
  const tokens = [];

  const regexUnit = /\b(\d+(?:\.\d+)?)\s*(MG|MCG|IU|%|ML|GM)\b/gi;
  let match;
  while ((match = regexUnit.exec(norm)) !== null) {
    tokens.push({ val: parseFloat(match[1]), unit: match[2].toLowerCase() });
  }

  const regexForm = /\b(\d+(?:\.\d+)?)\s*(?:TABLET|TABLETS|TAB|TABS|CAPSULE|CAPSULES|CAP|CAPS|STRIP|SUSPENSION|SYRUP|INJECTION|INJ|CREAM|GEL|OINTMENT|OINT)\b/gi;
  while ((match = regexForm.exec(norm)) !== null) {
    const val = parseFloat(match[1]);
    const prevText = norm.slice(Math.max(0, match.index - 12), match.index);
    if (!/STRIP\s+OF|PACK\s+OF|BOX\s+OF/i.test(prevText)) {
      if (!tokens.some(t => Math.abs(t.val - val) < 0.001)) {
        tokens.push({ val });
      }
    }
  }

  return tokens;
}

function hasStrengthConflict(name1, name2) {
  const s1 = extractStrengthTokens(name1);
  const s2 = extractStrengthTokens(name2);

  if (s1.length === 0 || s2.length === 0) return false;

  for (const t1 of s1) {
    const matching = s2.find(t2 => Math.abs(t2.val - t1.val) <= 0.001);
    if (!matching) return true;
    if (t1.unit && matching.unit && t1.unit !== matching.unit) return true;
  }
  return false;
}

function hasDosageConflict(q, c) {
  const qLower = q.toLowerCase();
  const cLower = c.toLowerCase();

  const isQSyrup = /\b(syp|syrup|susp|suspension)\b/.test(qLower);
  const isCTab = /\b(tab|tablet|tablets)\b/.test(cLower);
  const isQTab = /\b(tab|tablet|tablets|dt)\b/.test(qLower);
  const isCSyrup = /\b(syp|syrup|susp|suspension)\b/.test(cLower);
  const isQGel = /\b(gel)\b/.test(qLower);
  const isCSpray = /\b(spray)\b/.test(cLower);
  const isQPowder = /\b(powder|pwd)\b/.test(qLower);
  const isCGel = /\b(gel|cream|lotion)\b/.test(cLower);
  const isQCream = /\b(cream|crm)\b/.test(qLower);
  const isCOint = /\b(oint|ointment)\b/.test(cLower);

  if (isQSyrup && isCTab) return true;
  if (isQTab && isCSyrup) return true;
  if (isQGel && isCSpray) return true;
  if (isQPowder && isCGel) return true;
  if (isQCream && isCOint) return true;

  const isMedForm = /\b(tab|tablet|tablets|dt|cap|capsule|capsules|syp|syrup|susp|suspension|inj|injection|gel|cream|ointment|drops?|inhaler)\b/.test(qLower);
  const isDevice = /\b(binder|belt|brace|support|crepe|bandage|cotton|massager|vaporizer|condom|thermometer|oximeter|nebulizer|glucometer|lancet|wheelchair|walker|diaper|sanitary|pad|wipes|patch|tape|plaster|plasters|gauze|mask|gloves?|unit)\b/.test(cLower);
  if (isMedForm && isDevice) return true;

  return false;
}

function isBrandMatch(query, candidateName) {
  let cleanQ = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  let cleanCand = candidateName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  const stopWords = new Set(['strip', 'tablets', 'tablet', 'capsules', 'capsule', 'bottle', 'syrup', 'suspension', 'drops', 'pack', 'solution', 'cream', 'ointment', 'injection', 'powder', 'device', 'unit', 'units', 'mg', 'mcg', 'ml', 'gm', 'iu', 'of', 'and', 'with', 'for', 'in', 'box', 'pouch', 'jar', 'tube']);
  const qBrandWords = cleanQ.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w) && !/^\d+$/.test(w));
  if (qBrandWords.length === 0) return false;
  const candWords = cleanCand.split(/\s+/).filter(Boolean);
  const primaryBrand = qBrandWords[0];
  const brandIndex = candWords.findIndex(cw => cw === primaryBrand || cw.startsWith(primaryBrand));
  if (brandIndex === -1 || (brandIndex > 0 && !['new', 'dr', 'baby', 'the'].includes(candWords[0]))) {
    return false;
  }
  return true;
}

const rows = db.prepare(`
  SELECT ci.id, ci.medicine_id, m.name as target_name, ci.product_name as matched_name,
         ci.confidence_score, ci.image_path
  FROM catalog_images ci
  JOIN medicines m ON m.id = ci.medicine_id
`).all();

const badMedIds = new Set();
const imagesToDelete = [];

for (const r of rows) {
  const t = r.target_name;
  const m = r.matched_name || '';

  let bad = false;
  if (r.confidence_score === 75) bad = true;
  if (!bad && hasStrengthConflict(t, m)) bad = true;
  if (!bad && hasModifierConflict(t, m)) bad = true;
  if (!bad && hasDosageConflict(t, m)) bad = true;
  if (!bad && !isBrandMatch(t, m)) bad = true;

  if (bad) {
    badMedIds.add(r.medicine_id);
    imagesToDelete.push(r.image_path);
  }
}

console.log(`Found ${badMedIds.size} medicines with bad images to purge.`);
console.log(`Found ${imagesToDelete.length} images to remove from disk.`);

// 1. Delete bad records from catalog_images
const deleteStmt = db.prepare('DELETE FROM catalog_images WHERE medicine_id = ?');
const deleteHarvestStmt = db.prepare('DELETE FROM catalog_harvest_state WHERE medicine_id = ?');

const deleteMany = db.transaction((medIds) => {
  for (const id of medIds) {
    deleteStmt.run(id);
    try { deleteHarvestStmt.run(id); } catch {}
  }
});

deleteMany(Array.from(badMedIds));
console.log(`Deleted bad records from catalog_images and catalog_harvest_state.`);

// 2. Delete physical image files from disk
let unlinked = 0;
for (const imgRel of imagesToDelete) {
  if (!imgRel) continue;
  const fileName = path.basename(imgRel);
  const p1 = path.join(TARGET_FRONTEND, fileName);
  const p2 = path.join(TARGET_UPLOADS, fileName);
  try { if (fs.existsSync(p1)) { fs.unlinkSync(p1); unlinked++; } } catch {}
  try { if (fs.existsSync(p2)) { fs.unlinkSync(p2); } } catch {}
}
console.log(`Deleted ${unlinked} physical image files from disk.`);

// 3. Update top100_harvest_state.json to remove bad entries so they can be re-harvested cleanly
if (fs.existsSync(STATE_FILE)) {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    let stateCleaned = 0;
    for (const medId of badMedIds) {
      if (state.products && state.products[String(medId)]) {
        delete state.products[String(medId)];
        stateCleaned++;
      }
    }
    state.last_updated = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    console.log(`Removed ${stateCleaned} purged entries from ${STATE_FILE}.`);
  } catch (err) {
    console.error('Error updating state file:', err);
  }
}

console.log('✅ Purge complete! Database and disk are now clean.');
