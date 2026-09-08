import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const db = new Database('./data/app.db');
const activeImages = db.prepare(`SELECT id, medicine_id, product_name, image_path, thumbnail_path, verification_status FROM catalog_images WHERE is_active = 1`).all();

console.log(`Auditing ${activeImages.length} active image records...`);

let missingFront = 0;
let missingUpload = 0;
let zeroByte = 0;
let valid = 0;

for (const img of activeImages) {
  const pFront = path.join(process.cwd(), 'frontend', 'public', img.image_path.replace(/^\//, ''));
  const pUpload = path.join(process.cwd(), 'uploads', 'products', path.basename(img.image_path));

  if (!fs.existsSync(pFront)) {
    missingFront++;
    console.error(`Missing frontend: ${img.image_path} (ID: ${img.id})`);
  } else if (fs.statSync(pFront).size === 0) {
    zeroByte++;
  } else {
    valid++;
  }

  // Ensure upload copy exists as well
  if (!fs.existsSync(pUpload)) {
    if (fs.existsSync(pFront)) {
      fs.copyFileSync(pFront, pUpload);
    } else {
      missingUpload++;
    }
  }
}

console.log('--- INTEGRITY AUDIT RESULTS ---');
console.log(`Total Active Images: ${activeImages.length}`);
console.log(`Valid On Disk:       ${valid}`);
console.log(`Missing Frontend:    ${missingFront}`);
console.log(`Zero Byte:           ${zeroByte}`);
console.log(`Missing Upload:      ${missingUpload}`);
console.log('-------------------------------');
db.close();
