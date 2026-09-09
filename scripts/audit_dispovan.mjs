import Database from 'better-sqlite3';
import path from 'path';

const db = new Database('./data/app.db');

console.log('--- CHECKING DISPOVAN / SYRINGE ITEMS ---');
const dispovans = db.prepare(`
  SELECT ci.id, ci.medicine_id, m.name as med_name, m.strength, ci.product_name, ci.image_path, ci.confidence_score
  FROM catalog_images ci
  JOIN medicines m ON ci.medicine_id = m.id
  WHERE ci.is_active = 1 AND (m.name LIKE '%DISPOVAN%' OR m.name LIKE '%SYRINGE%')
`).all();
console.log('Found dispovan/syringe items:', dispovans.length);
dispovans.forEach(r => console.log(JSON.stringify(r)));
