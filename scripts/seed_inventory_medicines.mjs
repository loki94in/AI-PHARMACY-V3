import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT_DIR = process.cwd();
const CSV_PATH = path.join(ROOT_DIR, 'CATALOG', 'Batch Stock.csv');
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');

function parseCSVLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function cleanMedicineName(raw) {
  let cleaned = raw.replace(/\[.*?\]/g, ' ');
  cleaned = cleaned.replace(/\b(STRIP OF \d+ (TABLETS?|CAPSULES?)|BOTTLE OF \d+ (TABLETS?|ML)|NO'S|\d+\s*NO'S)\b/gi, ' ');
  return cleaned.replace(/\s+/g, ' ').trim();
}

const COSMETIC_REGEX = /\b(shampoo|conditioner|hair oil|chameli oil|amla oil|badam oil|almond oil|coconut oil|jasmine oil|hair dye|hair color|hair colour|hair gel|face wash|facewash|face scrub|face pack|face cream|cleanser|toner|moisturizer|moisturiser|brightening cream|glow cream|whitening cream|fairness|fair & lovely|glow & lovely|ponds|pond's|scrub|serum|body wash|body lotion|vaseline|nivea|baby lotion|baby cream|baby powder|petroleum jelly|sunscreen|sun screen|bleach|lip balm|lipstick|kajal|mascara|eyeliner|foundation|nail polish|perfume|deodorant|deo|body spray|axe|fogg|lux|dove|lifebuoy|santoor|pears|cinthol|mysore sandal|palmolive|hamam|soap|colgate|pepsodent|close up|closeup|toothbrush|toothpaste|chocolate|chocolates|cadbury|dairy milk|5 star|perk|kitkat|biscuit|biscuits|candy|toffee|comfort|surf excel|tide|rin|vim|dishwash|floor cleaner|lizol|harpic|hit red|hit black|good knight|goodknight|all out|allout|odomos|air fresh)\b/i;

const COSMETIC_MFGS = [
  'HINDUSTAN UNILEVER', 'HINDUSTAN UNILIVER', 'LOREAL', 'L\'OREAL', 'CADBURY',
  'MARICO', 'NIVEA', 'GARNIER', 'LOTUS HERBALS', 'GODREJ CONSUMER PRODUCTS',
  'COLGATE-PALMOLIVE', 'JOHNSON & JOHNSON CONSUMER', 'RECKITT BENCKISER (INDIA)',
  'EMAMI LIMITED', 'VLCC', 'JOY PERSONAL CARE', 'RAMSONS', 'AERO CARE'
];

const MEDICATED_SALTS = [
  'KETOCONAZOLE', 'CLOTRIMAZOLE', 'PERMETHRIN', 'CHLORHEXIDINE', 'MICONAZOLE',
  'TERBINAFINE', 'SALICYLIC ACID', 'BENZOYL PEROXIDE', 'FUSIDIC', 'MUPIROCIN',
  'BETAMETHASONE', 'CLOBETASOL', 'MOMETASONE', 'POVIDONE', 'SILVER SULFADIAZINE',
  'CALAMINE'
];

async function seed() {
  console.log('Seeding medicines from Batch Stock.csv into SQLite...');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const content = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = content.split(/\r?\n/);

  const medicinesMap = new Map();

  for (let i = 4; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.toLowerCase().includes('computed values') || line.toLowerCase().includes('total qty')) continue;

    const cols = parseCSVLine(line);
    if (cols.length < 2) continue;

    const rawName = (cols[0] || '').trim();
    const pack = (cols[1] || '').trim();
    const sch = (cols[2] || '').trim().toUpperCase();
    const gst = parseFloat(cols[3] || '0') || 0;
    const salts = (cols[4] || '').trim();
    const mfg = (cols[5] || '').trim();
    const therapeutic = (cols[6] || '').trim();
    const subTherapeutic = (cols[7] || '').trim();

    if (!rawName) continue;

    // Filter cosmetics
    let isMedicine = true;
    if (sch === 'SCHEDULED H' || sch === 'SCHEDULED H1' || sch === 'NARCOTIC DRUG') {
      isMedicine = true;
    } else {
      const isMedicatedSalt = salts && MEDICATED_SALTS.some(ms => salts.toUpperCase().includes(ms));
      const hasCosmKw = COSMETIC_REGEX.test(rawName);
      const isCosmMfg = COSMETIC_MFGS.some(cm => mfg.toUpperCase().includes(cm));
      if ((hasCosmKw || isCosmMfg) && !isMedicatedSalt) {
        isMedicine = false;
      }
    }

    if (!isMedicine) continue;

    const clean = cleanMedicineName(rawName);
    if (!clean) continue;

    if (!medicinesMap.has(rawName)) {
      medicinesMap.set(rawName, {
        rawName,
        cleanName: clean,
        pack,
        sch,
        gst,
        salts,
        mfg,
        therapeutic,
        subTherapeutic
      });
    }
  }

  console.log(`Parsed ${medicinesMap.size} unique pharmaceutical products from CSV.`);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO medicines (
      name, api_reference, packaging, schedule_type, manufacturer,
      cgst_per, sgst_per, therapeutic, sub_therapeutic, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'inventory_catalog')
  `);

  const insertMany = db.transaction((items) => {
    let inserted = 0;
    for (const item of items) {
      const halfGst = item.gst / 2;
      const res = insertStmt.run(
        item.rawName,
        item.salts || null,
        item.pack || null,
        item.sch || 'None',
        item.mfg || null,
        halfGst,
        halfGst,
        item.therapeutic || null,
        item.subTherapeutic || null
      );
      if (res.changes > 0) inserted++;
    }
    return inserted;
  });

  const inserted = insertMany(Array.from(medicinesMap.values()));
  const total = db.prepare('SELECT count(*) as count FROM medicines').get();
  console.log(`Seeded ${inserted} items. Total in medicines table: ${total.count}`);
}

seed().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
