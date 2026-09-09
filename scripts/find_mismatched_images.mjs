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
    ci.product_name as img_product_name,
    ci.company_name as img_company_name,
    ci.image_path,
    ci.source_url
  FROM catalog_images ci
  JOIN medicines m ON ci.medicine_id = m.id
  WHERE ci.is_active = 1
`).all();

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

const trueMismatches = [];

for (const r of rows) {
  const medBrand = getCore(r.med_name);
  const medClean = clean(r.med_name);
  const imgClean = clean(r.img_product_name || '');
  const fileClean = clean(path.basename(r.image_path).replace(/[-_]/g, ' '));
  const mfgClean = clean(r.med_mfg || '');

  // Brand Match
  let brandMatch = false;
  if (medBrand) {
    if (imgClean.includes(medBrand) || fileClean.includes(medBrand)) brandMatch = true;
    if (mfgClean.includes('PARACHUT') && (imgClean.includes('PARACHUTE') || fileClean.includes('PARACHUTE'))) brandMatch = true;
    if (mfgClean.includes('MARICO') && (imgClean.includes('PARACHUTE') || fileClean.includes('PARACHUTE'))) brandMatch = true;
    if (mfgClean.includes('HMD') && (imgClean.includes('DISPOVAN') || fileClean.includes('DISPOVAN'))) brandMatch = true;
    if (mfgClean.includes('PANDG') && (imgClean.includes('PAMPERS') || fileClean.includes('PAMPERS') || imgClean.includes('WHISPER') || fileClean.includes('WHISPER'))) brandMatch = true;
    if (mfgClean.includes('BAIDYANATH') && (imgClean.includes('BAIDYANATH') || fileClean.includes('BAIDYANATH'))) brandMatch = true;
    if (mfgClean.includes('BAJAJ') && (imgClean.includes('BAJAJ') || fileClean.includes('BAJAJ'))) brandMatch = true;
    if (mfgClean.includes('GLAXOSMITHKLINE') && medClean.includes('ORALB') && fileClean.includes('ORAL B')) brandMatch = true;
    if (medClean.includes('PD PUPPY') && fileClean.includes('PEDIGREE')) brandMatch = true;
    if (medClean.includes('METBETIC GL 1/500') && fileClean.includes('METBETIC GL')) brandMatch = true;
    if (mfgClean.includes('FDC') && (imgClean.includes('1 AL') || fileClean.includes('1 AL'))) brandMatch = true;
  }

  // Form check
  const medForm = extractForm(r.med_name);
  let imgForm = extractForm(r.img_product_name) || extractForm(path.basename(r.image_path));
  let formConflict = false;

  // Sanity check for sanitary pads named "cotton"
  const isPadBrand = medClean.includes('STAYFREE') || medClean.includes('WHISPER') || medClean.includes('SOFY') || medClean.includes('KOTEX');
  const imgIsPad = fileClean.includes('PAD') || imgClean.includes('PAD') || imgClean.includes('NAPKIN');
  if (isPadBrand && imgIsPad) {
    // Both are sanitary pads, ignore "cotton" in name
  } else if (medForm && imgForm && medForm !== imgForm) {
    const oralSolid = medForm === 'TABLET' || medForm === 'CAPSULE';
    const imgOralSolid = imgForm === 'TABLET' || imgForm === 'CAPSULE';
    const isBajajHairOil = medClean.includes('BAJAJ') && fileClean.includes('BAJAJ ALMOND DROPS');
    const isHomeoDrops = (medClean.includes('HAMAMELIS') || medClean.includes('CARBO VEG')) && (medClean.includes('LIQUID') || medClean.includes('Q'));
    const isTigerBalm = medClean.includes('TIGER BALM') && (fileClean.includes('TIGER BALM'));
    const isVicksBalm = medClean.includes('VICKS') && (medClean.includes('RUB') || medClean.includes('VAPO')) && fileClean.includes('VAPORUB');
    const isCastorOil = medClean.includes('CASTOR') && (imgClean.includes('CASTOR') || fileClean.includes('CASTOR'));

    if (!isBajajHairOil && !isHomeoDrops && !isTigerBalm && !isVicksBalm && !isCastorOil && !(oralSolid && imgOralSolid)) {
      formConflict = true;
    }
  }

  // Strength check
  const medStr = extractStrength(r.med_name);
  const imgStr = extractStrength(r.img_product_name) || extractStrength(path.basename(r.image_path));
  let strengthConflict = false;
  if (medStr && imgStr && medStr !== imgStr) {
    if (!(medClean.includes('1/500') && fileClean.includes('1MG/500MG'))) {
      strengthConflict = true;
    }
  }

  // Commodity false matches
  let commodityConflict = false;
  if (medClean.includes('MASK') && (fileClean.includes('COTTON') && !fileClean.includes('MASK'))) commodityConflict = true;
  if (medClean.includes('DRY SHEET') && fileClean.includes('COTTON')) commodityConflict = true;
  if (medClean.includes('SANITARY') && fileClean.includes('COTTON') && !fileClean.includes('SANITARY') && !fileClean.includes('PAD')) commodityConflict = true;
  if (medClean.includes('WHISPER') && fileClean.includes('COTTON') && !fileClean.includes('WHISPER') && !fileClean.includes('PAD')) commodityConflict = true;
  if (medClean.includes('PAMPERS') && fileClean.includes('ADULT')) commodityConflict = true;
  if (medClean.includes('PRO EASE') && fileClean.includes('COTTON') && !fileClean.includes('PAD') && !fileClean.includes('NAPKIN')) commodityConflict = true;
  if (medClean.includes('WIPES') && fileClean.includes('COTTON')) commodityConflict = true;
  if (medClean.includes('DETTOL') && !fileClean.includes('DETTOL')) commodityConflict = true;
  if (mfgClean.includes('HIMALAYA') && (fileClean.includes('CALAPURE') || fileClean.includes('ABSORBENT COTTON'))) commodityConflict = true;

  if (!brandMatch || formConflict || strengthConflict || commodityConflict) {
    trueMismatches.push({
      ...r,
      reasons: [
        !brandMatch ? 'Brand mismatch' : '',
        formConflict ? `Form clash (${medForm} vs ${imgForm})` : '',
        strengthConflict ? `Strength clash (${medStr} vs ${imgStr})` : '',
        commodityConflict ? 'Commodity clash' : ''
      ].filter(Boolean).join(' • ')
    });
  }
}

console.log('True Mismatches Identified:', trueMismatches.length);
fs.writeFileSync('./data/true_mismatches.json', JSON.stringify(trueMismatches, null, 2));

for (const m of trueMismatches) {
  console.log(`[Med ID: ${m.medicine_id}] "${m.med_name}" [${m.med_mfg}] -> Current: "${m.img_product_name}" (${m.image_path}) | ${m.reasons}`);
}
