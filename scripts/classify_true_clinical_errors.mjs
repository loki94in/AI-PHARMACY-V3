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

function clean(s) {
  return (s || '').toUpperCase().replace(/\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractCoreBrand(name) {
  const words = clean(name).split(/[^A-Z0-9]+/).filter(w => w.length >= 2 && !['TAB', 'TABLET', 'TABLETS', 'CAP', 'CAPSULE', 'CAPSULES', 'SYP', 'SYRUP', 'INJ', 'INJECTION', 'STRIP', 'BOTTLE', 'OF', 'MG', 'ML', 'GM', 'MCG', 'NEW', 'PLUS', 'FORTE', 'DT'].includes(w));
  return words[0] || '';
}

function extractExactStrength(text) {
  if (!text) return null;
  // Exclude pack size (e.g. 10 tablets, 15 capsules)
  const clean = text.replace(/\b(?:STRIP|PACK|BOTTLE|BOX|TUBE|BLISTER)\s+(?:OF\s+)?\d+\b/gi, ' ');
  // Concentration / strength: 500mg, 650mg, 40mg, 10mg, 2.5mg, 40iu, 0.5%
  const m = clean.match(/\b(\d+(?:\.\d+)?)\s*(MG|MCG|IU|%)\b/i);
  return m ? { full: `${m[1]}${m[2].toUpperCase()}`, val: parseFloat(m[1]), unit: m[2].toUpperCase() } : null;
}

function extractExactVolumeOrWeight(text) {
  if (!text) return null;
  // Exclude 50mg/5ml
  const clean = text.replace(/\b\d+(?:\.\d+)?\s*(?:MG|MCG)\s*\/\s*\d+(?:\.\d+)?\s*ML\b/gi, ' ');
  const m = clean.match(/\b(\d+(?:\.\d+)?)\s*(ML|GM|G|KG)\b/i);
  return m ? { full: `${m[1]}${m[2].toUpperCase().replace('GM', 'G')}`, val: parseFloat(m[1]), unit: m[2].toUpperCase().replace('GM', 'G') } : null;
}

const realErrors = [];

for (const r of rows) {
  const medName = clean(r.med_name);
  const candName = clean(r.img_product_name || '');
  const fileName = path.basename(r.image_path).replace(/[-_.]/g, ' ').toUpperCase();
  const medBrand = extractCoreBrand(medName);

  let errorReason = null;

  // 1. Shoe polish / cosmetic mapped to pharma syrup
  if (medName.includes('POLISH') && (candName.includes('SYRUP') || fileName.includes('SYRUP') || candName.includes('TUSPEL'))) {
    errorReason = `Shoe polish assigned cough syrup image (${candName})`;
  }

  // 2. Syringe size mismatch (e.g. Dispovan 10ml with 2ml image, 2.5ml with 5ml image)
  if (medName.includes('SYRINGE') || medName.includes('DISPOVAN') || medName.includes('DISPO')) {
    const medVol = extractExactVolumeOrWeight(medName);
    const candVol = extractExactVolumeOrWeight(candName) || extractExactVolumeOrWeight(fileName);
    if (medVol && candVol && medVol.val !== candVol.val) {
      errorReason = `Syringe size clash: Medicine is ${medVol.full} but image is ${candVol.full}`;
    }
  }

  // 3. Clinical Drug Strength Conflict (e.g. 500mg vs 650mg, 10mg vs 20mg, 2.5mg vs 5mg, 500mg vs 1000mg)
  if (!errorReason) {
    const medStr = extractExactStrength(medName);
    const candStr = extractExactStrength(candName);
    if (medStr && candStr && medStr.unit === candStr.unit && medStr.val !== candStr.val) {
      const ratio = Math.max(medStr.val, candStr.val) / Math.min(medStr.val, candStr.val);
      // If ratio >= 1.2, definite strength difference
      if (ratio >= 1.2) {
        errorReason = `Clinical drug strength clash: Medicine is ${medStr.full} but image is ${candStr.full}`;
      }
    }
  }

  // 4. Large Liquid Volume / Pack Weight Conflict (ratio >= 1.5, e.g. 60ml vs 125ml, 25ml vs 50ml, 30ml vs 100ml)
  if (!errorReason) {
    const medVol = extractExactVolumeOrWeight(medName);
    const candVol = extractExactVolumeOrWeight(candName) || extractExactVolumeOrWeight(fileName);
    if (medVol && candVol && medVol.unit === candVol.unit && medVol.val !== candVol.val) {
      const isEquiv = (medVol.val === 450 && candVol.val === 455) || (medVol.val === 455 && candVol.val === 450) ||
                      (medVol.val === 220 && candVol.val === 227) || (medVol.val === 227 && candVol.val === 220);
      if (!isEquiv) {
        const ratio = Math.max(medVol.val, candVol.val) / Math.min(medVol.val, candVol.val);
        if (ratio >= 1.5) {
          errorReason = `Pack volume clash: Medicine is ${medVol.full} but image is ${candVol.full}`;
        }
      }
    }
  }

  // 5. Formulation Modifier Clash (PLUS, FORTE, DS, AM, H, CT, D, M, OZ, TZ, SP, LS)
  if (!errorReason) {
    const checkModifiers = ['PLUS', 'FORTE', 'DS', 'AM', 'H', 'CT', 'D', 'M', 'OZ', 'TZ', 'SP', 'LS', 'DUO'];
    for (const mod of checkModifiers) {
      // Check whole-word boundary for modifier
      const re = new RegExp(`\\b${mod}\\b`, 'i');
      const medHas = re.test(medName.replace(/\+/g, ' PLUS '));
      const candHas = re.test(candName.replace(/\+/g, ' PLUS ')) || re.test(fileName.replace(/\+/g, ' PLUS '));

      if (medHas !== candHas) {
        // Exclude innocent cases like 3M, 1+ Years, etc.
        if (mod === 'M' && (candName.includes('3M') || fileName.includes('3M'))) continue;
        if (mod === 'PLUS' && (candName.includes('1+ YEARS') || fileName.includes('1+ YEARS'))) continue;
        if (mod === 'PLUS' && (candName.includes('SPF') || fileName.includes('SPF'))) continue; // sunscreen SPF 50+
        if (mod === 'H' && medBrand === 'TELMA' && !medName.includes('TELMA H')) {
          // Telma plain vs Telma H
          errorReason = `Formulation clash: Telma plain assigned Telma H`;
          break;
        }

        // True formulation differences:
        // Plain vs FORTE (e.g. Betnesol vs Betnesol Forte)
        // Plain vs PLUS (e.g. Bandy vs Bandy Plus, Buscogast vs Buscogast Plus, Calpol vs Calpol Plus)
        // Plain vs DS (Double Strength)
        // Plain vs AM (Amlodipine combination)
        // Plain vs CT (Chlorthalidone combination)
        // Plain vs SP (Serratiopeptidase combination)
        // Plain vs LS (Levosalbutamol)
        // Plain vs OZ / TZ (Ornidazole / Tinidazole)
        const isTruePharmaBrand = [
          'BETNESOL', 'BANDY', 'BUSCOGAST', 'CALPOL', 'TELMA', 'TELPRES', 'TELMIKIND',
          'MET', 'BILAFAV', 'ASCORIL', 'ALKOF', 'A TO Z', 'PAN', 'PANTOCID', 'RABEKIND',
          'RABLET', 'OMEE', 'OCID', 'GEMINOR', 'GLYCOMET', 'VOLINI', 'GABANEURON', 'ROSYCAP'
        ].some(b => medName.includes(b));

        if (isTruePharmaBrand) {
          if (medHas && !candHas) {
            errorReason = `Medicine is combination '${mod}' (${medName}) but image is plain (${candName})`;
          } else if (!medHas && candHas) {
            errorReason = `Medicine is plain (${medName}) but image is combination '${mod}' (${candName})`;
          }
          break;
        }
      }
    }
  }

  if (errorReason) {
    realErrors.push({
      id: r.id,
      med_id: r.medicine_id,
      med_name: r.med_name,
      med_mfg: r.med_mfg,
      img_name: r.img_product_name,
      image_path: r.image_path,
      errorReason
    });
  }
}

console.log(`\n======================================================`);
console.log(`TOTAL REAL CLINICAL / STRENGTH / FORMULATION ERRORS: ${realErrors.length}`);
console.log(`======================================================`);

fs.writeFileSync('./data/real_clinical_errors.json', JSON.stringify(realErrors, null, 2));

for (const err of realErrors) {
  console.log(`[ID ${err.id} | MedID ${err.med_id}] "${err.med_name}"`);
  console.log(`   Img: "${err.img_name}" [${path.basename(err.image_path)}]`);
  console.log(`   REASON: ${err.errorReason}\n`);
}
