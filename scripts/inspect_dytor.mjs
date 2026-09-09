import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const rows = db.prepare(`
  SELECT ci.id, ci.medicine_id, m.name as med_name, m.strength, ci.product_name, ci.image_path, ci.is_active, ci.confidence_score, ci.verification_status
  FROM catalog_images ci
  JOIN medicines m ON ci.medicine_id = m.id
  WHERE m.name LIKE '%DYTOR%'
`).all();

console.log('Dytor rows in catalog_images:');
console.log(rows);

const allDytorMeds = db.prepare(`
  SELECT id, name, manufacturer, strength, item_type
  FROM medicines
  WHERE name LIKE '%DYTOR%'
`).all();
console.log('\nAll Dytor medicines in medicines table:');
console.log(allDytorMeds);
