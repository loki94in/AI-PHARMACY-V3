import Database from 'better-sqlite3';
const db = new Database('./data/app.db');

const cross = db.prepare(`
  SELECT ci.id, m.name as med_name, ci.product_name, ci.image_path, ci.is_active, ci.is_primary
  FROM catalog_images ci
  JOIN medicines m ON ci.medicine_id = m.id
  WHERE (m.name LIKE '%DYTOR 20%' AND (ci.image_path LIKE '%10mg%' OR ci.product_name LIKE '%10mg%'))
     OR (m.name LIKE '%DYTOR 10%' AND (ci.image_path LIKE '%20mg%' OR ci.product_name LIKE '%20mg%'))
`).all();

console.log('Cross-connected Dytor rows in catalog_images:');
console.log(cross);
