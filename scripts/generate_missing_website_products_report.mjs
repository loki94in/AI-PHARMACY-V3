import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const ROOT_DIR = process.cwd();
const DB_PATH = path.join(ROOT_DIR, 'data', 'app.db');
const STATE_FILE = path.join(ROOT_DIR, 'data', 'image_download_state.json');
const CSV_NOT_FOUND = path.join(ROOT_DIR, 'CATALOG', 'images_not_found_products.csv');
const CSV_MISSING_REPORT = path.join(ROOT_DIR, 'CATALOG', 'missing_website_products.csv');

const db = new Database(DB_PATH, { readonly: true });
const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

// Query all medicines
const allMedicines = db.prepare(`
  SELECT m.id, m.name, m.packaging, m.manufacturer, m.schedule_type, m.cgst_per * 2 as gst_rate, m.therapeutic
  FROM medicines m
  ORDER BY m.name ASC
`).all();

// Query medicines that have an image
const imageRows = db.prepare(`
  SELECT DISTINCT medicine_id, product_name, image_path, verification_status, confidence_score
  FROM catalog_images
`).all();

const imageMap = new Map();
for (const r of imageRows) {
  imageMap.set(r.medicine_id, r);
}

console.log(`Total medicines in DB: ${allMedicines.length}`);
console.log(`Medicines with catalog image: ${imageMap.size}`);

const missingFromWebsite = [];
const withImages = [];

for (const med of allMedicines) {
  const img = imageMap.get(med.id);
  if (!img) {
    missingFromWebsite.push(med);
  } else {
    withImages.push({
      ...med,
      matched_image: img.image_path,
      matched_product_name: img.product_name,
      confidence_score: img.confidence_score,
      verification_status: img.verification_status
    });
  }
}

console.log(`Medicines missing images (Website text-only): ${missingFromWebsite.length}`);

// Write updated images_not_found_products.csv
const notFoundLines = ['Index,Product Name,Cleaned Query,Manufacturer,Schedule Type'];
let idx = 1;
for (const m of missingFromWebsite) {
  const cleanQ = m.name.replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
  const escapedName = `"${m.name.replace(/"/g, '""')}"`;
  const escapedClean = `"${cleanQ.replace(/"/g, '""')}"`;
  const escapedMfg = `"${(m.manufacturer || '').replace(/"/g, '""')}"`;
  notFoundLines.push(`${idx++},${escapedName},${escapedClean},${escapedMfg},"${m.schedule_type || ''}"`);
}
fs.writeFileSync(CSV_NOT_FOUND, notFoundLines.join('\n'), 'utf8');

// Write comprehensive missing_website_products.csv
const missingReportLines = [
  'Medicine ID,Product Name,Manufacturer,Packaging,Therapeutic Category,Schedule,Reason'
];
for (const m of missingFromWebsite) {
  const escapedName = `"${m.name.replace(/"/g, '""')}"`;
  const escapedMfg = `"${(m.manufacturer || '').replace(/"/g, '""')}"`;
  const escapedPack = `"${(m.packaging || '').replace(/"/g, '""')}"`;
  const escapedCategory = `"${(m.therapeutic || '').replace(/"/g, '""')}"`;
  const reason = 'No verified manufacturer packaging image found online (local/generic brand)';
  missingReportLines.push(`${m.id},${escapedName},${escapedMfg},${escapedPack},${escapedCategory},"${m.schedule_type || ''}","${reason}"`);
}
fs.writeFileSync(CSV_MISSING_REPORT, missingReportLines.join('\n'), 'utf8');

console.log(`Generated:`);
console.log(`- ${CSV_NOT_FOUND} (${missingFromWebsite.length} entries)`);
console.log(`- ${CSV_MISSING_REPORT} (${missingFromWebsite.length} entries)`);

// Category & Manufacturer breakdown of missing products
const mfgCount = {};
for (const m of missingFromWebsite) {
  const mfg = m.manufacturer || 'UNKNOWN';
  mfgCount[mfg] = (mfgCount[mfg] || 0) + 1;
}

const topMissingMfgs = Object.entries(mfgCount).sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log('\nTop 15 Manufacturers with Missing Images:');
for (const [mfg, cnt] of topMissingMfgs) {
  console.log(` - ${mfg}: ${cnt} products`);
}
