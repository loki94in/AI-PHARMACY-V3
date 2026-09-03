import fs from 'fs';

const catalogPath = 'CATALOG/Batch Stock.csv';
const lines = fs.readFileSync(catalogPath, 'utf-8').split(/\r?\n/);

const seen = new Set();
const records = [];

for (let i = 4; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  let inQuotes = false;
  let cur = '';
  const parts = [];
  for (let c = 0; c < line.length; c++) {
    const ch = line[c];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur.trim());

  const rawName = parts[0]?.replace(/^"|"$/g, '').trim();
  if (!rawName || seen.has(rawName)) continue;
  seen.add(rawName);

  const pack = parts[1]?.replace(/^"|"$/g, '').trim() || '';
  const schedule = parts[2]?.replace(/^"|"$/g, '').trim() || '';
  const composition = parts[4]?.replace(/^"|"$/g, '').trim() || '';
  const manufacturer = (rawName.match(/\[(.*?)\]/) || [])[1] || parts[5]?.replace(/^"|"$/g, '').trim() || '';

  records.push({ name: rawName, pack, schedule, composition, manufacturer });
}

// 1. DIABETIC MEDICINES (Strict Anti-Diabetic Drugs)
const DIABETIC_TERMS = [
  'METFORMIN', 'GLIMEPIRIDE', 'GLICLAZIDE', 'GLIPIZIDE', 'GLIBENCLAMIDE',
  'TENELIGLIPTIN', 'VILDAGLIPTIN', 'SITAGLIPTIN', 'LINAGLIPTIN', 'ALOGLIPTIN',
  'DAPAGLIFLOZIN', 'EMPAGLIFLOZIN', 'REMOGLIFLOZIN', 'CANAGLIFLOZIN',
  'VOGLIBOSE', 'ACARBOSE', 'PIOGLITAZONE', 'REPAGLINIDE', 'INSULIN',
  'GLARGINE', 'ASPART', 'LISPRO', 'DEGLUDEC', 'GLYCOMET', 'AMARYL',
  'JANUVIA', 'GALVUS', 'JALRA', 'FORXIGA', 'JARDIANCE', 'TRAJENTA',
  'TENLIMAC', 'GEMER', 'ZORYL', 'GLUCONORM', 'DIAPRIDE', 'GLIZID',
  'VOGS', 'VOLIBO', 'DYNAGLIPT', 'TENEPURE', 'DAPAVAN', 'OXRA', 'DAONIL',
  'SEMI-DAONIL', 'GLUCOBAY', 'ISTAMET', 'JANUMET', 'GALVUS MET', 'ZOMELIS'
];

const diabeticList = records.filter(r => {
  const text = `${r.name} ${r.composition}`.toUpperCase();
  return DIABETIC_TERMS.some(t => new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`, 'i').test(text));
});

// 2. TB (TUBERCULOSIS) MEDICINES
const TB_TERMS = [
  'RIFAMPICIN', 'RIFAMPIN', 'ISONIAZID', 'PYRAZINAMIDE', 'ETHAMBUTOL',
  'STREPTOMYCIN', 'BEDAQUILINE', 'DELAMANID', 'ETHIONAMIDE', 'CYCLOSERINE',
  'AKT', 'FORECOX', 'MACOX', 'R-CINEX', 'R CINEX', 'RCINEX', 'R-CIN', 'RCIN',
  'COMBUTOL', 'PYZINA', 'CAVITER', 'TIBINEX', 'MYCOBUTOL', 'MONO-COX', 'MONOCOX'
];

const tbList = records.filter(r => {
  const text = `${r.name} ${r.composition}`.toUpperCase();
  return TB_TERMS.some(t => new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`, 'i').test(text));
});

// 3. INHALATION & ROTACAPS (Strictly Inhalers, Rotacaps, Respules, Transcaps)
const INHALATION_FORMS = ['ROTACAP', 'ROTACAPS', 'INHALER', 'RESPULE', 'RESPULES', 'TRANSCAP', 'TRANSCAPS', 'NEBULIZER', 'INHALET', 'OCTACAP'];
const INHALATION_BRANDS = ['AEROCORT', 'ASTHALIN', 'BUDECORT', 'FORACORT', 'SEROFLO', 'DUOLIN', 'TIOVA', 'LEVOLIN', 'FLOHALE', 'MAXIFLO', 'BUDAMATE', 'BECLATE', 'VENTORLIN'];

const inhalationList = records.filter(r => {
  const nameUpper = r.name.toUpperCase();
  const packUpper = r.pack.toUpperCase();
  const isFormMatch = INHALATION_FORMS.some(f => nameUpper.includes(f) || packUpper.includes(f));
  const isBrandMatch = INHALATION_BRANDS.some(b => nameUpper.includes(b));
  // Must NOT be simple syrup unless it specifies respules/inhaler
  const isSyrup = nameUpper.includes('SYP') || nameUpper.includes('SYRUP') || packUpper.includes('ML');
  if (isSyrup && !isFormMatch) return false;
  return isFormMatch || isBrandMatch;
});

// 4. CHOLESTEROL MEDICINES (Statins, Fibrates, Lipid Regulators)
const CHOLESTEROL_TERMS = [
  'ATORVASTATIN', 'ROSUVASTATIN', 'SIMVASTATIN', 'PRAVASTATIN', 'PITAVASTATIN',
  'FENOFIBRATE', 'EZETIMIBE', 'SAROGLITAZAR',
  'ATORVA', 'ROSUVAS', 'ROZAVEL', 'LIPIKIND', 'STORVAS', 'TONACT', 'ATOCOR',
  'ROSEDAY', 'ROSAVE', 'FENOLIP', 'LIPAGLYN', 'ATORLIP', 'NOVASTAT', 'STATIX',
  'TG TOR', 'TGTOR', 'FIBATOR', 'ROZUCOR', 'ATORFIT', 'ROSUFIT'
];

const cholesterolList = records.filter(r => {
  const text = `${r.name} ${r.composition}`.toUpperCase();
  return CHOLESTEROL_TERMS.some(t => new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`, 'i').test(text));
});

// 5. THYROID CARE MEDICINES
const THYROID_TERMS = [
  'THYROXINE', 'THYRONORM', 'ELTROXIN', 'THYROX', 'THYROUP', 'LEVOTHYROXINE',
  'CARBIMAZOLE', 'NEO-MERCAZOLE', 'NEO MERCAZOLE'
];
const thyroidList = records.filter(r => {
  const text = `${r.name} ${r.composition}`.toUpperCase();
  return THYROID_TERMS.some(t => new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`, 'i').test(text));
});

// 6. HYPERTENSION & CARDIAC MEDICINES (Blood Pressure / Heart Care)
const BP_CARDIAC_TERMS = [
  'TELMISARTAN', 'AMLODIPINE', 'OLMESARTAN', 'LOSARTAN', 'VALSARTAN', 'CANDESARTAN',
  'METOPROLOL', 'BISOPROLOL', 'ATENOLOL', 'NEBIVOLOL', 'CARVEDILOL', 'PROPRANOLOL',
  'RAMIPRIL', 'ENALAPRIL', 'PERINDOPRIL', 'LISINOPRIL', 'CILNIDIPINE', 'BENIDIPINE',
  'CLOPIDOGREL', 'ASPIRIN', 'ECOSPRIN', 'CLAVIX', 'BRILINTA', 'TICAGRELOR',
  'TELMA', 'TELMIKIND', 'STARPRESS', 'BETALOC', 'CORBIS', 'AMLONG', 'CILACAR',
  'STAMLO', 'CARDIVAS', 'OLMAT', 'LOSAR', 'RAMIPRES'
];
const bpCardiacList = records.filter(r => {
  const text = `${r.name} ${r.composition}`.toUpperCase();
  return BP_CARDIAC_TERMS.some(t => new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`, 'i').test(text));
});

// 7. COMPREHENSIVE REFILL MASTER LIST
const refillMaster = new Map();

function addRefill(items, category) {
  items.forEach(it => {
    if (!refillMaster.has(it.name)) {
      refillMaster.set(it.name, { ...it, category });
    }
  });
}

addRefill(diabeticList, 'Diabetes Care');
addRefill(bpCardiacList, 'BP & Cardiac Care');
addRefill(cholesterolList, 'Cholesterol Care');
addRefill(thyroidList, 'Thyroid Care');
addRefill(inhalationList, 'Asthma / Respiratory Refill');

const refillList = Array.from(refillMaster.values());

console.log('='.repeat(70));
console.log('        STORE CLINICAL & CHRONIC REFILL INVENTORY');
console.log('='.repeat(70));
console.log(`1. Diabetic Medicines:              ${diabeticList.length} items`);
console.log(`2. Tuberculosis (TB) Medicines:     ${tbList.length} items`);
console.log(`3. Inhalation / Rotacaps / Respules: ${inhalationList.length} items`);
console.log(`4. Cholesterol & Lipid Statins:     ${cholesterolList.length} items`);
console.log(`5. Thyroid Care:                    ${thyroidList.length} items`);
console.log(`6. Blood Pressure & Heart Care:     ${bpCardiacList.length} items`);
console.log(`----------------------------------------------------------------------`);
console.log(`TOTAL CHRONIC PATIENT REFILL LIST:  ${refillList.length} unique medicines`);
console.log('='.repeat(70));

// Export Refill Master CSV
const exportRows = ['Refill Category,Medicine Name,Pack Size,Schedule,Active Salt / Composition,Manufacturer'];
refillList.forEach(item => {
  const rCat = `"${item.category}"`;
  const rName = `"${item.name.replace(/"/g, '""')}"`;
  const rPack = `"${item.pack.replace(/"/g, '""')}"`;
  const rSched = `"${item.schedule.replace(/"/g, '""')}"`;
  const rComp = `"${item.composition.replace(/"/g, '""')}"`;
  const rMfr = `"${item.manufacturer.replace(/"/g, '""')}"`;
  exportRows.push(`${rCat},${rName},${rPack},${rSched},${rComp},${rMfr}`);
});

fs.writeFileSync('CATALOG/monthly_refill_master_list.csv', exportRows.join('\n'), 'utf-8');
console.log('\nGenerated: CATALOG/monthly_refill_master_list.csv');
