import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const db = new Database('./data/app.db');

const rows = db.prepare(`
  SELECT 
    ci.id as image_id,
    ci.medicine_id,
    m.name as med_name,
    m.manufacturer as med_mfg,
    m.item_type,
    ci.product_name as img_product_name,
    ci.company_name as img_company_name,
    ci.image_path,
    ci.source_url,
    ci.confidence_score,
    ci.verification_status,
    ci.ocr_text
  FROM catalog_images ci
  JOIN medicines m ON ci.medicine_id = m.id
  WHERE ci.is_active = 1
`).all();

console.log('Total active images to audit:', rows.length);

function clean(s) {
  return (s || '').toUpperCase().replace(/\[.*?\]/g, '').replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function getCore(s) {
  const w = clean(s).split(' ').filter(x => x.length >= 2 && !['TAB', 'TABLET', 'TABLETS', 'CAP', 'CAPSULE', 'CAPSULES', 'SYP', 'SYRUP', 'INJ', 'INJECTION', 'STRIP', 'OF', 'BOTTLE', 'MG', 'ML', 'GM', 'MCG', 'NEW', 'PLUS', 'FORTE', 'DT'].includes(x));
  return w[0] || '';
}

function extractStrength(text) {
  if (!text) return null;
  const m = text.match(/\b(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\s*(MG|MCG|IU|%)\b/i);
  return m ? `${m[1]}${m[2].toUpperCase()}` : null;
}

function extractForm(text) {
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
  if (/\b(PAD|PADS|NAPKIN|NAPKINS|SANITARY)\b/.test(u)) return 'SANITARY_PAD';
  if (/\b(DIAPER|DIAPERS|PANTS?)\b/.test(u)) return 'DIAPER';
  if (/\b(WIPES?)\b/.test(u)) return 'WIPES';
  if (/\b(COTTON|GAUZE|BANDAGE)\b/.test(u)) return 'COTTON';
  if (/\b(SYRINGE|NEEDLE|DISPOVAN)\b/.test(u)) return 'SYRINGE';
  if (/\b(MASK)\b/.test(u)) return 'MASK';
  return null;
}

const issues = [];

for (const r of rows) {
  const medBrand = getCore(r.med_name);
  const medClean = clean(r.med_name);
  const imgClean = clean(r.img_product_name || '');
  const fileClean = clean(path.basename(r.image_path).replace(/[-_]/g, ' '));
  const mfgClean = clean(r.med_mfg || '');

  // 1. Check Brand Match
  let brandMatch = false;
  if (medBrand) {
    if (imgClean.includes(medBrand) || fileClean.includes(medBrand)) {
      brandMatch = true;
    }
    // Check known aliases
    if (mfgClean.includes('PARACHUT') && (imgClean.includes('PARACHUTE') || fileClean.includes('PARACHUTE'))) brandMatch = true;
    if (mfgClean.includes('MARICO') && (imgClean.includes('PARACHUTE') || fileClean.includes('PARACHUTE'))) brandMatch = true;
    if (mfgClean.includes('HMD') && (imgClean.includes('DISPOVAN') || fileClean.includes('DISPOVAN'))) brandMatch = true;
    if (mfgClean.includes('PANDG') && (imgClean.includes('PAMPERS') || fileClean.includes('PAMPERS') || imgClean.includes('WHISPER') || fileClean.includes('WHISPER'))) brandMatch = true;
    if (mfgClean.includes('BAIDYANATH') && (imgClean.includes('BAIDYANATH') || fileClean.includes('BAIDYANATH'))) brandMatch = true;
  }

  // 2. Form check
  const medForm = extractForm(r.med_name);
  const imgForm = extractForm(r.img_product_name) || extractForm(path.basename(r.image_path));
  let formConflict = false;
  if (medForm && imgForm && medForm !== imgForm) {
    // Check if truly incompatible
    const oralSolid = medForm === 'TABLET' || medForm === 'CAPSULE';
    const imgOralSolid = imgForm === 'TABLET' || imgForm === 'CAPSULE';
    if (!(oralSolid && imgOralSolid)) {
      formConflict = true;
    }
  }

  // 3. Strength check
  const medStr = extractStrength(r.med_name);
  const imgStr = extractStrength(r.img_product_name) || extractStrength(path.basename(r.image_path));
  let strengthConflict = false;
  if (medStr && imgStr && medStr !== imgStr) {
    strengthConflict = true;
  }

  // 4. Commodity false matches (e.g. Absorbent cotton assigned to masks, wipes, pads, diapers)
  let commodityConflict = false;
  if (medClean.includes('MASK') && (fileClean.includes('COTTON') && !fileClean.includes('MASK'))) commodityConflict = true;
  if (medClean.includes('DRY SHEET') && fileClean.includes('COTTON')) commodityConflict = true;
  if (medClean.includes('SANITARY') && fileClean.includes('COTTON') && !fileClean.includes('SANITARY')) commodityConflict = true;
  if (medClean.includes('PAD') && fileClean.includes('COTTON') && !fileClean.includes('PAD')) commodityConflict = true;
  if (medClean.includes('WHISPER') && fileClean.includes('COTTON')) commodityConflict = true;
  if (medClean.includes('PAMPERS') && fileClean.includes('ADULT')) commodityConflict = true;
  if (medClean.includes('PRO EASE') && fileClean.includes('COTTON')) commodityConflict = true;
  if (medClean.includes('WIPES') && fileClean.includes('COTTON')) commodityConflict = true;
  if (medClean.includes('DETTOL') && !fileClean.includes('DETTOL')) commodityConflict = true;
  if (mfgClean.includes('HIMALAYA') && (fileClean.includes('CALAPURE') || fileClean.includes('ABSORBENT COTTON'))) commodityConflict = true;

  if (!brandMatch || formConflict || strengthConflict || commodityConflict) {
    issues.push({
      id: r.image_id,
      med_id: r.medicine_id,
      med_name: r.med_name,
      med_mfg: r.med_mfg,
      img_name: r.img_product_name,
      image_path: r.image_path,
      brandMatch,
      formConflict,
      strengthConflict,
      commodityConflict,
      medForm,
      imgForm,
      medStr,
      imgStr
    });
  }
}

console.log(`\nAudit Complete! Found ${issues.length} potential issues across 10,852 images.\n`);
console.log('--- DETAILED BREAKDOWN OF ISSUES ---');
for (const iss of issues) {
  const flags = [
    !iss.brandMatch ? 'BRAND_MISMATCH' : '',
    iss.formConflict ? `FORM_CONFLICT (${iss.medForm} vs ${iss.imgForm})` : '',
    iss.strengthConflict ? `STRENGTH_CONFLICT (${iss.medStr} vs ${iss.imgStr})` : '',
    iss.commodityConflict ? 'COMMODITY_CONFLICT' : ''
  ].filter(Boolean).join(' | ');

  console.log(`[ID: ${iss.id}] Med: "${iss.med_name}" [${iss.med_mfg}]`);
  console.log(`   Img: "${iss.img_name}" (${iss.image_path})`);
  console.log(`   Flags: ${flags}\n`);
}
