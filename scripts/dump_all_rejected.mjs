import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('./data/app.db');
const rejected = db.prepare(`
  SELECT DISTINCT m.id, m.name, m.manufacturer, m.generic_name, m.packaging, m.strength
  FROM medicines m
  JOIN catalog_images ci ON ci.medicine_id = m.id
  WHERE ci.verification_status = 'REJECTED'
    AND m.id NOT IN (SELECT medicine_id FROM catalog_images WHERE is_active = 1)
  ORDER BY m.id ASC
`).all();

console.log('Total rejected to resolve:', rejected.length);

fs.writeFileSync('./scripts/all_541_rejected.json', JSON.stringify(rejected, null, 2));
console.log('Saved to scripts/all_541_rejected.json');
