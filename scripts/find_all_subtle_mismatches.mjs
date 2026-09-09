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
    ci.source_url,
    ci.ocr_text,
    ci.confidence_score
  FROM catalog_images ci
  JOIN medicines m ON ci.medicine_id = m.id
  WHERE ci.is_active = 1
`).all();

console.log('Total active images to scan:', rows.length);

// Extract strength or volume from any text
function extractStrengthTokens(text) {
  if (!text) return [];
  const matches = [];
  // Matches e.g. 500MG, 10ML, 2.5MG, 40/12.5MG, 500 MG, 10 ML, 2 ML, 2.5 ML, 100 GM, 50 G, 40IU, 0.5%
  const re = /\b(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\s*(MG|MCG|IU|%|ML|GM|G|KG)\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({
      full: `${m[1]}${m[2].toUpperCase()}`,
      num: parseFloat(m[1]),
      unit: m[2].toUpperCase()
    });
  }
  return matches;
}

// Extract combination suffixes: AM, H, CT, D, M, OZ, TZ, PLUS, FORTE, DS, SP, L, LS, DX, AX, LC, AP, SR, ER, PR, CR
function extractDrugSuffixes(text) {
  if (!text) return new Set();
  const clean = text.toUpperCase().replace(/\[.*?\]/g, ' ').replace(/[^A-Z0-9\s]/g, ' ');
  const words = clean.split(/\s+/);
  const suffixes = new Set();
  const KNOWN_COMBOS = new Set([
    'AM', 'CT', 'PLUS', 'FORTE', 'DS', 'SP', 'OZ', 'TZ', 'LS', 'DX', 'AX', 'LC', 'AP',
    'COLD', 'ACTIVE', 'ADVANCE', 'RELIEF', 'FAST', 'MAX', 'PRO'
  ]);
  for (const w of words) {
    if (KNOWN_COMBOS.has(w)) suffixes.add(w);
    // Letter-combinations like -D or -H or -M or -L
    if (['H', 'D', 'M', 'L', 'AT', 'TG', 'TRIO', 'DUO'].includes(w)) suffixes.add(w);
  }
  return suffixes;
}

function extractDosageForm(text) {
  if (!text) return null;
  const u = text.toUpperCase();
  if (/\b(TAB|TABLET|TABLETS|CAPLET)\b/.test(u)) return 'TABLET';
  if (/\b(CAP|CAPSULE|CAPSULES)\b/.test(u)) return 'CAPSULE';
  if (/\b(SYP|SYRUP|SUSP|SUSPENSION|LIQUID|SOLUTION)\b/.test(u)) return 'SYRUP';
  if (/\b(INJ|INJECTION|VIAL|AMPOULE|INFUSION)\b/.test(u)) return 'INJECTION';
  if (/\b(EYE DROP|EAR DROP|DROPS?)\b/.test(u)) return 'DROPS';
  if (/\b(CREAM|OINT|OINTMENT|GEL|LOTION)\b/.test(u)) return 'CREAM';
  if (/\b(INHALER|RESPULE|ROTACAP)\b/.test(u)) return 'INHALER';
  if (/\b(BALM|VAPORUB|RUB)\b/.test(u)) return 'BALM';
  if (/\b(SOAP|BAR|WASH)\b/.test(u)) return 'SOAP';
  if (/\b(OIL|TAIL|TAILA)\b/.test(u)) return 'OIL';
  if (/\b(POWDER)\b/.test(u)) return 'POWDER';
  if (/\b(SYRINGE|NEEDLE|DISPOVAN)\b/.test(u)) return 'SYRINGE';
  return null;
}

const mismatches = [];

for (const r of rows) {
  const medText = `${r.med_name} ${r.med_strength || ''}`;
  const imgText = `${r.img_product_name || ''} ${path.basename(r.image_path).replace(/[-_.]/g, ' ')} ${r.ocr_text || ''}`;
  
  const fileText = path.basename(r.image_path).replace(/[-_.]/g, ' ');
  const candName = r.img_product_name || '';

  // 1. Strength / Volume Mismatch Check
  const medStrs = extractStrengthTokens(medText);
  const imgStrs = extractStrengthTokens(imgText);
  const fileStrs = extractStrengthTokens(fileText);
  const candStrs = extractStrengthTokens(candName);

  let strengthMismatch = null;

  // Compare med strength against candStrs or fileStrs
  for (const ms of medStrs) {
    // Check if image mentions a conflicting strength of the same unit
    // E.g. med has 10ML, image has 2ML or 5ML
    // E.g. med has 500MG, image has 650MG or 250MG
    const relevantImgs = (candStrs.length > 0 ? candStrs : fileStrs).filter(is => is.unit === ms.unit);
    for (const is of relevantImgs) {
      if (ms.num !== is.num) {
        // Special exceptions: 450ml vs 455ml (fl oz conversion)
        if ((ms.num === 450 && is.num === 455) || (ms.num === 455 && is.num === 450)) continue;
        if ((ms.num === 220 && is.num === 227) || (ms.num === 227 && is.num === 220)) continue;
        
        strengthMismatch = {
          medStrength: ms.full,
          imgStrength: is.full,
          ratio: Math.max(ms.num, is.num) / Math.min(ms.num, is.num)
        };
        break;
      }
    }
    if (strengthMismatch) break;
  }

  // 2. Combo suffix check
  const medCombos = extractDrugSuffixes(r.med_name);
  const imgCombos = extractDrugSuffixes(`${candName} ${fileText}`);
  let comboMismatch = null;
  for (const c of medCombos) {
    if (['AM', 'CT', 'H', 'D', 'PLUS', 'FORTE', 'DS', 'SP', 'OZ', 'TZ', 'COLD'].includes(c)) {
      if (!imgCombos.has(c)) {
        comboMismatch = `Medicine has "${c}" but image lacks "${c}"`;
      }
    }
  }
  for (const c of imgCombos) {
    if (['AM', 'CT', 'H', 'D', 'PLUS', 'FORTE', 'DS', 'SP', 'OZ', 'TZ', 'COLD'].includes(c)) {
      if (!medCombos.has(c)) {
        comboMismatch = `Image has "${c}" but medicine lacks "${c}"`;
      }
    }
  }

  // 3. Form mismatch
  const medForm = extractDosageForm(r.med_name);
  const imgForm = extractDosageForm(candName) || extractDosageForm(fileText);
  let formMismatch = null;
  if (medForm && imgForm && medForm !== imgForm) {
    const oralSolid = (medForm === 'TABLET' || medForm === 'CAPSULE') && (imgForm === 'TABLET' || imgForm === 'CAPSULE');
    if (!oralSolid) {
      formMismatch = `${medForm} vs ${imgForm}`;
    }
  }

  if (strengthMismatch || comboMismatch || formMismatch) {
    mismatches.push({
      id: r.id,
      med_id: r.medicine_id,
      med_name: r.med_name,
      med_mfg: r.med_mfg,
      img_name: r.img_product_name,
      image_path: r.image_path,
      strengthMismatch,
      comboMismatch,
      formMismatch
    });
  }
}

console.log(`Scan complete! Found ${mismatches.length} potential mismatches.`);
fs.writeFileSync('./data/detailed_mismatches.json', JSON.stringify(mismatches, null, 2));

console.log('\n--- SAMPLE OF FIRST 25 DETECTED MISMATCHES ---');
for (const m of mismatches.slice(0, 25)) {
  console.log(`[ID: ${m.id}] Med: "${m.med_name}"`);
  console.log(`   Img: "${m.img_name}" (${m.image_path})`);
  if (m.strengthMismatch) console.log(`   -> STRENGTH CONFLICT: Med=${m.strengthMismatch.medStrength} vs Img=${m.strengthMismatch.imgStrength}`);
  if (m.comboMismatch) console.log(`   -> COMBO CONFLICT: ${m.comboMismatch}`);
  if (m.formMismatch) console.log(`   -> FORM CONFLICT: ${m.formMismatch}`);
  console.log('');
}
