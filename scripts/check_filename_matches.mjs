import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { catalogImageService } from '../src/services/catalogImageService.js';

const db = new Database('./data/app.db');
const rejected = db.prepare(`
  SELECT DISTINCT m.id, m.name, m.manufacturer, m.generic_name, m.packaging, m.strength
  FROM medicines m
  JOIN catalog_images ci ON ci.medicine_id = m.id
  WHERE ci.verification_status = 'REJECTED'
    AND m.id NOT IN (SELECT medicine_id FROM catalog_images WHERE is_active = 1)
  ORDER BY m.id ASC
`).all();

console.log(`Checking ${rejected.length} medicines by filename-derived candidate names...`);

let fileNameMatches = 0;
const matches = [];

for (const med of rejected) {
  const oldRows = db.prepare(`SELECT * FROM catalog_images WHERE medicine_id = ? ORDER BY id DESC`).all(med.id);
  let matched = false;

  for (const row of oldRows) {
    if (!row.image_path) continue;
    const fName = path.basename(row.image_path);
    const fPath = path.join('./frontend/public/products', fName);
    if (!fs.existsSync(fPath) || fs.statSync(fPath).size < 1000) continue;

    // Derive readable product name from filename: e.g. "dabur-honey-50gm-front.jpg" -> "Dabur Honey 50gm"
    const nameFromPath = fName.replace(/-front\.jpg$|-side\.jpg$|-back\.jpg$|-combo\.jpg$|\.jpg$/, '').replace(/-/g, ' ');

    const score = catalogImageService.computeConfidence(
      { name: med.name, manufacturer: med.manufacturer, strength: med.strength, packaging: med.packaging },
      { name: nameFromPath, manufacturer: med.manufacturer, imagePath: row.image_path }
    );

    if (score.verificationStatus === 'HIGH_CONFIDENCE' && score.confidenceScore >= 80) {
      fileNameMatches++;
      matches.push({ med: med.name, file: fName, score: score.confidenceScore, derived: nameFromPath });
      matched = true;
      break;
    }
  }
}

console.log(`Matches found from genuine local files by derived name: ${fileNameMatches} / ${rejected.length}`);
console.log('Sample matches:');
console.log(matches.slice(0, 15));
