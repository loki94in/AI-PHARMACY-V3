import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const rejectedMeds = db.prepare(`
  SELECT DISTINCT m.id, m.name, m.manufacturer, m.generic_name, m.packaging, m.strength
  FROM medicines m
  JOIN catalog_images ci ON ci.medicine_id = m.id
  WHERE ci.verification_status = 'REJECTED'
    AND m.id NOT IN (SELECT medicine_id FROM catalog_images WHERE is_active = 1)
`).all();

console.log('Unique medicines with rejected images and NO active image:', rejectedMeds.length);
console.log('Sample medicines to fetch genuine images for:');
console.log(JSON.stringify(rejectedMeds.slice(0, 10), null, 2));

const allRejectedRows = db.prepare(`
  SELECT ci.id, ci.medicine_id, ci.product_name, ci.image_path, m.name as med_name
  FROM catalog_images ci
  JOIN medicines m ON m.id = ci.medicine_id
  WHERE ci.verification_status = 'REJECTED'
`).all();

console.log('Total rejected rows in catalog_images:', allRejectedRows.length);
db.close();
