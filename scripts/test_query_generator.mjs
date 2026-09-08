import fs from 'fs';
import { catalogImageService } from '../src/services/catalogImageService.js';

const meds = JSON.parse(fs.readFileSync('./scripts/rejected_meds_list.json', 'utf8'));

// Smart query generator for an inventory item
export function generateSearchQueries(med) {
  const queries = new Set();
  const rawName = (med.name || '').trim();
  const mfg = (med.manufacturer || '').trim();
  const pack = (med.packaging || '').trim();
  const strength = (med.strength || '').trim();

  // 1. Basic clean
  let clean = rawName
    .replace(/\[.*?\]/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  queries.add(clean);

  // 2. Expand common brand abbreviations
  let expanded = clean;
  if (/^HIM\b/i.test(expanded)) {
    expanded = expanded.replace(/^HIM\b/i, 'HIMALAYA');
  } else if (/^BAID\b/i.test(expanded)) {
    expanded = expanded.replace(/^BAID\b/i, 'BAIDYANATH');
  } else if (/^DAB\b/i.test(expanded)) {
    expanded = expanded.replace(/^DAB\b/i, 'DABUR');
  } else if (/^ZAN\b/i.test(expanded)) {
    expanded = expanded.replace(/^ZAN\b/i, 'ZANDU');
  }

  // Expand dosage/term typos
  expanded = expanded
    .replace(/\bSYP\b/gi, 'SYRUP')
    .replace(/\bTAB\b/gi, 'TABLET')
    .replace(/\bCAP\b/gi, 'CAPSULE')
    .replace(/\bBALAM\b/gi, 'BALM')
    .replace(/\bBAM\b/gi, 'BALM')
    .replace(/\bDIPER\b/gi, 'DIAPER')
    .replace(/\bCURN\b/gi, 'CHURNA')
    .replace(/\bSUNSCREEM\b/gi, 'SUNSCREEN')
    .replace(/\bALOVERA\b/gi, 'ALOE VERA');

  queries.add(expanded);

  // 3. Strip internal distributor price numbers between brand and category
  // e.g. "VICKS 115 CREAM 25ML" -> "VICKS VAPORUB 25ML" or "VICKS CREAM 25ML"
  // e.g. "BOROLINE 10 CREAM 7GM" -> "BOROLINE CREAM 7GM"
  // e.g. "HIM 95 LOTION 100ML" -> "HIMALAYA LOTION 100ML"
  // e.g. "DR ORTHO 48 OIL 30ML" -> "DR ORTHO OIL 30ML"
  let strippedPrice = expanded.replace(/^([A-Z\s]+?)\s+\d{2,3}\s+([A-Z])/i, '$1 $2');
  if (strippedPrice !== expanded) {
    queries.add(strippedPrice);
  }

  // 4. Special brand mappings for common pharmacy staples
  if (expanded.toUpperCase().includes('VICKS') && (expanded.toUpperCase().includes('CREAM') || expanded.toUpperCase().includes('BOTTLE'))) {
    const s = catalogImageService.extractStrength(clean) || '';
    queries.add(`Vicks Vaporub ${s}`.trim());
    queries.add(`Vicks Vaporub`);
  }

  if (expanded.toUpperCase().includes('DR ORTHO')) {
    const s = catalogImageService.extractStrength(clean) || '';
    const form = catalogImageService.extractDosageForm(clean) || '';
    queries.add(`Dr Ortho Ayurvedic ${form} ${s}`.trim());
    queries.add(`Dr Ortho ${form} ${s}`.trim());
  }

  if (expanded.toUpperCase().includes('BOROLINE')) {
    const s = catalogImageService.extractStrength(clean) || '';
    queries.add(`Boroline Antiseptic Cream ${s}`.trim());
  }

  if (expanded.toUpperCase().includes('CREMAFFIN')) {
    queries.add('Cremaffin Constipation Syrup 200ml');
    queries.add('Cremaffin Mint 200ml');
  }

  if (expanded.toUpperCase().includes('DISPOVAN')) {
    const s = catalogImageService.extractStrength(clean) || '';
    queries.add(`Dispovan Syringe ${s}`.trim());
  }

  if (expanded.toUpperCase().includes('ADULT DIAPER')) {
    const mfgClean = mfg.replace(/^(M\/S|LTD|LIMITED|PVT|PHARMA|PHARMACEUTICALS)\s*/gi, '').split(/\s+/)[0];
    if (mfgClean && mfgClean.length > 2 && !['NULL', 'GENTECH', 'GENCURE'].includes(mfgClean.toUpperCase())) {
      queries.add(`${mfgClean} Adult Diapers`);
    } else if (clean.toUpperCase().includes('FRIENDS')) {
      queries.add(`Friends Adult Diapers`);
    }
  }

  // 5. Manufacturer + brand core
  const coreBrand = catalogImageService.extractCoreBrand(clean);
  const form = catalogImageService.extractDosageForm(clean);
  const str = catalogImageService.extractStrength(clean) || strength;

  if (coreBrand && coreBrand.length >= 3) {
    let q = coreBrand;
    if (str) q += ` ${str}`;
    if (form && !['TABLET', 'CAPSULE'].includes(form)) q += ` ${form}`;
    queries.add(q.trim());
  }

  if (mfg && !['null', 'NULL'].includes(mfg)) {
    const cleanMfg = mfg.replace(/^(M\/S|LTD|LIMITED|PVT|PHARMA|PHARMACEUTICALS)\s*/gi, '').split(/\s+/)[0];
    if (cleanMfg && cleanMfg.length >= 4 && coreBrand && cleanMfg.toUpperCase() !== coreBrand.toUpperCase()) {
      queries.add(`${cleanMfg} ${coreBrand} ${str || ''}`.trim());
    }
  }

  return Array.from(queries).filter(q => q && q.length >= 3);
}

// Test first 10
for (const m of meds.slice(0, 10)) {
  console.log(`\nOriginal: "${m.name}" (Mfg: ${m.manufacturer})`);
  console.log('Queries:', generateSearchQueries(m));
}
