import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { catalogImageService } from '../src/services/catalogImageService.js';

const db = new Database('./data/app.db');
const rejected = JSON.parse(fs.readFileSync('./scripts/all_541_rejected.json', 'utf8'));

const publicDir = './frontend/public/products';
const allFiles = fs.readdirSync(publicDir);

console.log(`Checking 541 medicines against ${allFiles.length} existing files on disk...`);

let localMatches = 0;
let needsDownload = 0;
const localMatchList = [];
const needsDownloadList = [];

for (const med of rejected) {
  // Check the old catalog_images record for this medicine to see what file it had
  const oldRow = db.prepare(`
    SELECT image_path, product_name, company_name, ocr_text
    FROM catalog_images
    WHERE medicine_id = ? AND verification_status = 'REJECTED'
    ORDER BY id DESC LIMIT 1
  `).get(med.id);

  let verifiedLocal = false;
  if (oldRow && oldRow.image_path) {
    const fileName = path.basename(oldRow.image_path);
    const fullPath = path.join(publicDir, fileName);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 1000) {
      // Test if this existing file ACTUALLY matches this medicine under strict rules
      const score = catalogImageService.computeConfidence(
        {
          name: med.name,
          manufacturer: med.manufacturer,
          strength: med.strength,
          packaging: med.packaging
        },
        {
          name: oldRow.product_name || med.name,
          manufacturer: oldRow.company_name || med.manufacturer,
          imagePath: oldRow.image_path,
          ocrText: oldRow.ocr_text
        }
      );

      // If it failed because of old wrong image (e.g. Vicks vs Head & Shoulders), don't accept
      if (score.verificationStatus === 'HIGH_CONFIDENCE' && score.confidenceScore >= 80) {
        verifiedLocal = true;
        localMatches++;
        localMatchList.push({ med, file: oldRow.image_path, score });
      }
    }
  }

  if (!verifiedLocal) {
    needsDownload++;
    needsDownloadList.push(med);
  }
}

console.log(`Results:`);
console.log(` - Existing genuine files on disk that pass strict AI verification: ${localMatches}`);
console.log(` - Medicines needing genuine resolution/download: ${needsDownload}`);

fs.writeFileSync('./scripts/local_verified.json', JSON.stringify(localMatchList, null, 2));
fs.writeFileSync('./scripts/needs_download.json', JSON.stringify(needsDownloadList, null, 2));
