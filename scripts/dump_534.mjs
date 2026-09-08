import fs from 'fs';
import Database from 'better-sqlite3';

const db = new Database('./data/app.db');
const meds = db.prepare(`
  SELECT DISTINCT m.id, m.name, m.manufacturer, m.generic_name, m.packaging, m.strength
  FROM medicines m
  JOIN catalog_images ci ON ci.medicine_id = m.id
  WHERE ci.verification_status = 'REJECTED'
    AND m.id NOT IN (SELECT medicine_id FROM catalog_images WHERE is_active = 1)
  ORDER BY m.name ASC
`).all();

fs.writeFileSync('./scripts/rejected_534.json', JSON.stringify(meds, null, 2));
console.log('Saved', meds.length, 'meds to scripts/rejected_534.json');
db.close();
