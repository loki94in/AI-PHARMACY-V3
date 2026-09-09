import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const db = new Database('./data/app.db');

const rows = db.prepare(`
  SELECT 
    ci.id,
    ci.medicine_id,
    m.name as med_name,
    m.manufacturer as med_mfg,
    m.item_type,
    m.strength as med_strength,
    ci.product_name as img_product_name,
    ci.company_name as img_company_name,
    ci.image_path,
    ci.source_url
  FROM catalog_images ci
  JOIN medicines m ON ci.medicine_id = m.id
  WHERE ci.is_active = 1
`).all();

// Clean strings
function cleanName(raw) {
  return (raw || '').toUpperCase().replace(/\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Extract primary active strength (e.g. 500mg, 650mg, 40mg, 10mg, 2.5mg, 50mg/5ml)
function extractPrimaryDrugStrength(text) {
  if (!text) return null;
  // Ignore packaging count (e.g. STRIP OF 10, PACK OF 30)
  const withoutPack = text.replace(/\b(?:STRIP|PACK|BOTTLE|BOX|TUBE|BLISTER)\s+(?:OF\s+)?\d+\b/gi, ' ');
  // Match e.g. 500MG, 650MG, 0.5MG, 2.5MG, 40IU, 1%, 2%
  const m = withoutPack.match(/\b(\d+(?:\.\d+)?)\s*(MG|MCG|IU|%)\b/i);
  return m ? { full: `${m[1]}${m[2].toUpperCase()}`, num: parseFloat(m[1]), unit: m[2].toUpperCase() } : null;
}

// Extract package volume or weight (e.g. 100ML, 60ML, 10ML, 2ML, 5ML, 50GM, 100GM, 20GM)
function extractLiquidOrWeightVolume(text) {
  if (!text) return null;
  // Look for standalone volume or weight: 100ML, 60ML, 10ML, 2ML, 2.5ML, 5ML, 50G, 100GM
  // Exclude per-dosage units like 50MG/5ML
  const withoutRatio = text.replace(/\b\d+(?:\.\d+)?\s*(?:MG|MCG)\s*\/\s*\d+(?:\.\d+)?\s*ML\b/gi, ' ');
  const m = withoutRatio.match(/\b(\d+(?:\.\d+)?)\s*(ML|GM|G|KG)\b/i);
  return m ? { full: `${m[1]}${m[2].toUpperCase().replace('GM', 'G')}`, num: parseFloat(m[1]), unit: m[2].toUpperCase().replace('GM', 'G') } : null;
}

// Key combination modifiers that represent distinct medical formulations
const CRITICAL_MODIFIERS = ['PLUS', 'FORTE', 'DS', 'AM', 'H', 'CT', 'D', 'M', 'OZ', 'TZ', 'SP', 'LS', 'DUO', 'TRIO'];

function getCriticalModifiers(text) {
  if (!text) return new Set();
  // Normalize "+" into "PLUS"
  const normalized = text.toUpperCase().replace(/\[.*?\]/g, ' ').replace(/\+/g, ' PLUS ').replace(/[^A-Z0-9\s]/g, ' ');
  const words = normalized.split(/\s+/);
  const found = new Set();
  for (const w of words) {
    if (CRITICAL_MODIFIERS.includes(w)) found.add(w);
  }
  return found;
}

const confirmedMismatches = [];

for (const r of rows) {
  const medName = cleanName(r.med_name);
  const candName = cleanName(r.img_product_name || '');
  const fileName = path.basename(r.image_path).replace(/[-_.]/g, ' ').toUpperCase();

  // 1. Drug Active Strength Check (e.g. 500mg vs 650mg, 10mg vs 20mg)
  const medStrength = extractPrimaryDrugStrength(medName);
  const candStrength = extractPrimaryDrugStrength(candName) || extractPrimaryDrugStrength(fileName);

  let strengthClash = null;
  if (medStrength && candStrength && medStrength.unit === candStrength.unit) {
    if (medStrength.num !== candStrength.num) {
      strengthClash = {
        med: medStrength.full,
        img: candStrength.full,
        ratio: Math.max(medStrength.num, candStrength.num) / Math.min(medStrength.num, candStrength.num)
      };
    }
  }

  // 2. Liquid Volume / Weight / Syringe size check (e.g. 10ml vs 2ml syringe, 60ml vs 100ml syrup)
  const medVol = extractLiquidOrWeightVolume(medName);
  const candVol = extractLiquidOrWeightVolume(candName) || extractLiquidOrWeightVolume(fileName);

  let volumeClash = null;
  if (medVol && candVol && medVol.unit === candVol.unit) {
    const isEquiv = (medVol.num === 450 && candVol.num === 455) || (medVol.num === 455 && candVol.num === 450) ||
                    (medVol.num === 220 && candVol.num === 227) || (medVol.num === 227 && candVol.num === 220);
    if (!isEquiv && medVol.num !== candVol.num) {
      // Check ratio
      const ratio = Math.max(medVol.num, candVol.num) / Math.min(medVol.num, candVol.num);
      // For syringes and small volumes, any mismatch (2ml vs 5ml vs 10ml) is critical!
      const isSyringe = medName.includes('SYRINGE') || medName.includes('DISPOVAN') || medName.includes('NEEDLE');
      if (isSyringe || ratio > 1.25) {
        volumeClash = {
          med: medVol.full,
          img: candVol.full,
          ratio
        };
      }
    }
  }

  // 3. Critical Modifier / Formulation Suffix Check
  const medMods = getCriticalModifiers(medName);
  const candMods = getCriticalModifiers(`${candName} ${fileName}`);

  let modifierClash = null;
  for (const m of CRITICAL_MODIFIERS) {
    const medHas = medMods.has(m);
    const candHas = candMods.has(m);
    if (medHas !== candHas) {
      // Special: if med has PLUS but cand doesn't, or vice-versa
      modifierClash = medHas
        ? `Medicine has '${m}' but image is plain/missing '${m}'`
        : `Image has '${m}' but medicine is plain/missing '${m}'`;
      break;
    }
  }

  if (strengthClash || volumeClash || modifierClash) {
    confirmedMismatches.push({
      id: r.id,
      med_id: r.medicine_id,
      med_name: r.med_name,
      med_mfg: r.med_mfg,
      img_name: r.img_product_name,
      image_path: r.image_path,
      source_url: r.source_url,
      strengthClash,
      volumeClash,
      modifierClash
    });
  }
}

console.log(`\n======================================================`);
console.log(`TOTAL CONFIRMED CLINICAL / PACKAGING MISMATCHES: ${confirmedMismatches.length}`);
console.log(`======================================================`);

const strengthCount = confirmedMismatches.filter(m => m.strengthClash).length;
const volumeCount = confirmedMismatches.filter(m => m.volumeClash).length;
const modifierCount = confirmedMismatches.filter(m => m.modifierClash).length;

console.log(`- Drug Strength Mismatches (e.g. 500mg vs 650mg, 10mg vs 20mg): ${strengthCount}`);
console.log(`- Volume/Weight Mismatches (e.g. 10ml vs 2ml syringe, 60ml vs 100ml): ${volumeCount}`);
console.log(`- Formulation Modifier Mismatches (e.g. plain vs PLUS, FORTE, AM): ${modifierCount}`);

fs.writeFileSync('./data/confirmed_clinical_mismatches.json', JSON.stringify(confirmedMismatches, null, 2));

console.log('\n--- FIRST 30 CONFIRMED MISMATCHES ---');
for (const m of confirmedMismatches.slice(0, 30)) {
  const flags = [
    m.strengthClash ? `STRENGTH: ${m.strengthClash.med} vs ${m.strengthClash.img}` : '',
    m.volumeClash ? `VOLUME: ${m.volumeClash.med} vs ${m.volumeClash.img}` : '',
    m.modifierClash ? `MODIFIER: ${m.modifierClash}` : ''
  ].filter(Boolean).join(' | ');
  console.log(`[ID ${m.id}] ${m.med_name} (${m.med_mfg})`);
  console.log(`   Img: ${m.img_name} [${path.basename(m.image_path)}]`);
  console.log(`   -> ${flags}\n`);
}
